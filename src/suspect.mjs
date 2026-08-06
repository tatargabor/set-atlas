// The cheap gate: has a file that DRAWS a screen moved since the atlas was recorded?
//
// The expensive check (`--check`, `--diff`) needs the app running, a database and a
// login. Pre-commit and pre-push hooks deliberately run with none of those, so the
// real check cannot live there — it would either fall over or, worse, pass quietly.
//
// This one runs on the repository alone: the atlas states which commit it came from
// (`generated_from_commit`), git says which UI files moved since, and the atlas's own
// pointers say which SCREENS those files draw. Naming the screens is the point — "3 UI
// files changed" sends the author to look at all 33; "these two screens" is a warning
// someone acts on.
//
// ⚠ It reports SUSPICION, never a fact. Without the app it cannot know whether the
// surface actually moved — only that something which draws one did. This is the
// Doorstop "suspect link" pattern: the system makes a statement about its own
// bookkeeping, not about the world. Claiming more would be the reassuring-direction
// error this package exists to catch.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { isUiFile } from "./pointers.mjs"
import { readAtlas, selectPages } from "./context.mjs"

/** The commit the atlas was generated from, or null when it cannot be dated. */
export function atlasCommit(atlasDir) {
  return indexField(atlasDir, "generated_from_commit")
}

/** The generator that wrote it, or null for an atlas from before the field existed. */
export const atlasGeneratorVersion = (atlasDir) => indexField(atlasDir, "generator_version")

function indexField(atlasDir, key) {
  const index = path.join(atlasDir, "INDEX.md")
  if (!fs.existsSync(index)) return null
  const m = fs.readFileSync(index, "utf8").match(new RegExp(`^${key}:\\s*(\\S+)\\s*$`, "m"))
  return m && m[1] !== "null" ? m[1] : null
}

/**
 * Of the paths given, the ones that draw something.
 *
 * The atlas's own output is excluded: regenerating writes `docs/atlas/*.md`, and
 * counting those would leave the gate firing about the very run that satisfied it.
 */
export const uiFilesChanged = (files, { outDir = "docs/atlas" } = {}) =>
  files.filter((f) => isUiFile(f) && !f.startsWith(`${outDir}/`))

/**
 * Paths changed between `since` and the working tree, per git, with the deleted
 * ones kept apart.
 *
 * ⚠ The distinction is not cosmetic. Measured on the consumer 2026-08-05: two
 * routes were not modified but REMOVED — the editor moved into a tab of another
 * screen and its client file was deleted. Reported as an ordinary change, the gate
 * names the right page and says the wrong thing about it.
 */
export function changedFiles({ root, since, run = defaultRun }) {
  try {
    const rows = run(["-C", root, "diff", "--name-status", since, "--"])
      .split("\n")
      .map((l) => l.split("\t"))
      .filter((p) => p.length >= 2)
    return {
      files: rows.map((p) => p[p.length - 1].trim()).filter(Boolean),
      // Renames arrive as `R100\told\tnew`; the old path is gone from that route's
      // point of view, but the new one is right there, so it is not a deletion.
      deleted: rows.filter((p) => p[0].startsWith("D")).map((p) => p[1].trim()),
    }
  } catch {
    // An unknown commit (history rewritten, shallow clone, atlas from another
    // branch) is not "nothing changed". Say it out loud rather than return null.
    return null
  }
}

const defaultRun = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })

/** Is the atlas's own INDEX.md modified but not committed? */
export function provenanceIsUncommitted({ root, indexPath, run = defaultRun }) {
  try {
    return run(["-C", root, "status", "--porcelain", "--", indexPath]).trim().length > 0
  } catch {
    return false
  }
}

/**
 * The report. `suspect` is what a gate acts on; `text` is what a human reads.
 *
 * An atlas that cannot be dated counts as SUSPECT. A gate that answers "fine" when
 * its evidence is missing reports a check that never ran, which is the failure this
 * whole package is about.
 */
export function suspectReport({ atlasDir, commit, files, deleted = [], provenanceUncommitted = false, generatorVersion = null, top = 8 }) {
  const lines = []
  const ui = uiFilesChanged(files ?? [])
  const gone = uiFilesChanged(deleted ?? [])

  // A tool-side format change moves every page that carries the feature, and this
  // gate is otherwise blind to it: it watches the CONSUMER's files. Measured on a
  // consumer 2026-08-06 — one of our commits moved all 33 of their pages while
  // `suspect` said "clean" and `--check` said "33 stale", both correctly.
  //
  // ⚠ Absent is NOT different. Every atlas written before this field existed lacks
  // it; reporting those as a generator change would fire the gate once for every
  // consumer on the same day, for something they cannot act on beyond a
  // regeneration they would do anyway.
  const wroteWith = atlasGeneratorVersion(atlasDir)
  if (generatorVersion && wroteWith && wroteWith !== generatorVersion) {
    lines.push(`⚠ The atlas was written by a DIFFERENT generator: \`${wroteWith}\` — this one is \`${generatorVersion}\`.`)
    lines.push("  Pages may differ from a fresh run for a reason that has nothing to do with the UI.")
    lines.push("  A format change moves every page carrying the feature; that is not surface movement.")
    lines.push("")
  }

  // ⚠ The stamp is read from the working tree, which is the right default — the
  // question is "is the map behind the code in front of me". But when that stamp
  // is uncommitted, the answer is about a state nobody else can see: CI, a
  // reviewer, or the next clone would all read a different one. Measured on a
  // consumer 2026-08-06: their commit said `ea855349`, their working tree said
  // `0d5bbd9a`, and this gate reported green against the second without saying
  // which. The measurement was right; the silence made it look like more.
  if (provenanceUncommitted) {
    lines.push("⚠ The atlas's provenance is UNCOMMITTED — this reports on your working tree.")
    lines.push("  A reviewer, CI, or a fresh clone would read a different `generated_from_commit`.")
    lines.push("")
  }

  if (!commit) {
    lines.push("⚠ The atlas cannot be dated — its INDEX.md carries no `generated_from_commit`.")
    lines.push("  Nothing can be said about whether it is behind the UI. Regenerate it once, and")
    lines.push("  the next run of this gate becomes meaningful.")
    return { suspect: true, text: lines.join("\n"), screens: [], files: ui }
  }

  if (files === null) {
    lines.push(`⚠ git could not compare against \`${commit}\` — unknown commit, shallow clone, or a rewritten history.`)
    lines.push("  Treated as suspect: an unanswerable question is not a clean answer.")
    return { suspect: true, text: lines.join("\n"), screens: [], files: [] }
  }

  if (!ui.length) {
    lines.push(`✓ No file that draws a screen has moved since the atlas was recorded (\`${commit}\`).`)
    lines.push(`  ${(files ?? []).length} file(s) changed in total; none of them render.`)
    return { suspect: false, text: lines.join("\n"), screens: [], files: [] }
  }

  // Which screens those files draw. The atlas's own `source:` and `components:`
  // fields already answer this — the same matching the `context --files` form uses.
  const pages = fs.existsSync(atlasDir) ? readAtlas(atlasDir) : []
  const ranked = selectPages(pages, ui.join("\n")).slice(0, top)

  lines.push(`⚠ SUSPECT — ${ui.length} file(s) that draw a screen have moved since the atlas was recorded (\`${commit}\`).`)
  lines.push("")
  for (const f of ui.slice(0, 12)) lines.push(`    ${f}`)
  if (ui.length > 12) lines.push(`    … and ${ui.length - 12} more`)
  lines.push("")

  if (ranked.length) {
    // ⚠ `route` and `file` are what readAtlas actually returns. An earlier version
    // read `url` and `slug`, and printed `undefined → undefined.md` for every
    // screen — while its unit test stayed green, because the fixture happened to
    // carry `url` and the assertion was matching the file list above.
    const all = selectPages(pages, ui.join("\n"))
    // A page whose drawing file was DELETED is not a page to re-read — it may
    // describe a screen that no longer exists, and the atlas keeps such a page on
    // purpose (from outside, a deleted and a never-existing screen look alike).
    // Saying which is which is the gate's job; the page cannot say it itself.
    const removed = gone.length ? selectPages(pages, gone.join("\n")) : []
    const removedFiles = new Set(removed.map((p) => p.file))

    lines.push("  Screens these files draw — check these, not all of them:")
    for (const p of ranked) {
      const mark = removedFiles.has(p.file) ? "   ⚠ its drawing file was DELETED — this page may describe a screen that is gone" : p.stale ? "   ⚠ stale" : ""
      lines.push(`    ${(p.route ?? p.url ?? "?").padEnd(28)} →  ${p.file}${mark}`)
    }
    if (all.length > ranked.length) lines.push(`    ⚠ ${all.length - ranked.length} more matched and were not listed (--top).`)
    if (removed.length) {
      lines.push("")
      lines.push(`  ${removed.length} of them lost a file that drew them. A regeneration will DROP those pages,`)
      lines.push("  not update them — and until it runs, the atlas describes screens that may not exist.")
    }
  } else {
    // ⚠ Worth saying, not swallowing: a UI file that maps to no screen is either a
    // new screen the atlas has never recorded, or a component the pointers missed.
    // Both are things the author should know about.
    lines.push("  ⚠ None of these files maps to a screen in the atlas. Either they draw a")
    lines.push("    screen that was never recorded, or the pointers do not reach them.")
  }

  lines.push("")
  lines.push("  This is SUSPICION, not proof. This check runs without the app, so it cannot tell")
  lines.push("  whether the surface actually moved — only that something which draws one did.")
  lines.push("  To settle it:  node <path-to>/set-atlas/src/cli.mjs --diff   (needs the app running)")

  return { suspect: true, text: lines.join("\n"), screens: ranked, files: ui }
}
