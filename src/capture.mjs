// The recorder — a running app becomes one map page per screen.
//
// The source is Playwright's `page.ariaSnapshot()`: the accessibility tree as YAML.
// That is the layer screen readers and AI agents already see, which is why it
// survives CSS churn and carries MEANING rather than pixels.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { compress, estimateTokens } from "./compress.mjs"
import { renderMap, extractNodes } from "./render-map.mjs"
import { buildPointers } from "./pointers.mjs"
import { buildActions, buildNavigation } from "./crosscut.mjs"

/**
 * Where this atlas came from. Without it "is the atlas stale?" cannot be asked at
 * all — and a stale UI description is worse than none, because planning builds on
 * it silently. The commit is the consumer's HEAD: the atlas describes the app as
 * that code rendered it.
 */
function provenance(root, recordedFrom) {
  return {
    generated_at: new Date().toISOString(),
    // `recordedFrom` is the commit the RUN STARTED from. See headCommit for why
    // that, and not the commit that happens to be HEAD when the writing begins.
    generated_from_commit: recordedFrom ?? headCommit(root),
    generator_version: generatorVersion(),
  }
}

/**
 * The consumer's HEAD — the code state the atlas describes.
 *
 * ⚠ Take this BEFORE the recording starts, not when the pages are written.
 * Measured by a consumer 2026-08-06: a full run takes them ~12 minutes, the stamp
 * was taken at the end, and a commit that landed at 10:10:30 — inside a
 * 10:03→10:14:52 run — became the stamp. The atlas then claims to describe a
 * state that did not exist while it was being recorded.
 *
 * The direction of that error is what makes it worth fixing: `suspect` compares
 * from the stamp forward, so anything committed mid-run reads as "already
 * recorded" — wrong in the reassuring way. Stamping the start can only make the
 * window wider: the gate may ask about a file that was in fact captured, which
 * costs one look. Excluding `docs/atlas/` does not cover this; that hides our own
 * output, not someone else's commit landing mid-run.
 */
export function headCommit(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null
  } catch {
    // Not a git checkout, or git is absent. Say nothing rather than guess.
    return null
  }
}

/**
 * Which version of THIS tool wrote the atlas.
 *
 * ⚠ Asked for by a consumer 2026-08-06, and the reason is a measured failure of
 * ours: a change to `render-map.mjs` moved all 33 of their pages at once, and the
 * cheap gate could not see why — `suspect` watches the consumer's UI files, and
 * this was a change in the generator. `--check` saw it, but that needs a running
 * app, so it is not gate-shaped. The cheapest measurement was blind to exactly the
 * change class that moves the most pages at once.
 *
 * Their argument for why it is not cosmetic, kept because it decided the design:
 * without this field "33 pages moved" either causes a panic, or — worse — teaches
 * the reader that a large number means format noise. The second is what swallows a
 * real 33-page surface change.
 *
 * The package version alone is too coarse (it does not move commit to commit), so
 * the tool's own short SHA is appended when this is a git checkout — `0.1.0+3de116e`.
 * From npm, where there is no checkout, the version stands alone and still
 * distinguishes releases.
 */
export function generatorVersion() {
  const here = path.dirname(new URL(import.meta.url).pathname)
  let version = "unknown"
  try {
    version = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")).version ?? "unknown"
  } catch {
    // Installed in a way that hides its own manifest. Say `unknown`, not nothing:
    // a missing field reads as "an old atlas from before this existed".
  }
  return version + shaIfOwnCheckout(path.join(here, ".."))
}

/**
 * `+<sha>` when `packageRoot` really is this package's own git checkout, and an
 * empty string otherwise.
 *
 * ⚠ Measured by a consumer 2026-08-06 on the INSTALLED path — invisible from the
 * checkout we develop in. From `<consumer>/node_modules/set-atlas/src`, git walks
 * UP to the first `.git` it finds, and that is the CONSUMER's. The field would
 * then carry their SHA and move on every commit THEY make.
 *
 * Their argument for why this is a fix and not a footnote: the failure does not
 * err conspicuously, it errs AUTHORITATIVELY. A line called `generator_version`
 * holding someone else's commit is more believable than no line at all — the same
 * shape as a provenance field that draws on the source it is meant to check.
 *
 * The repository is ours only when its top level IS the package root. Anywhere
 * else the package version stands alone: coarser, and true.
 */
export function shaIfOwnCheckout(packageRoot, run = gitTopLevel) {
  try {
    const top = run(packageRoot)
    if (!top || path.resolve(top.trim()) !== path.resolve(packageRoot)) return ""
    const sha = execFileSync("git", ["-C", packageRoot, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    return sha ? `+${sha}` : ""
  } catch {
    // Not a checkout at all — the version alone is the honest answer.
    return ""
  }
}

const gitTopLevel = (dir) => execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })

/**
 * ⚠ `--check` compares file CONTENT, so the timestamp alone would mark the index
 * stale on every run — and a gate that always fires is a gate nobody keeps. These
 * lines, and only these, are excluded from that comparison.
 *
 * `stale_since` is here for the same reason and no other: a screen that fails to
 * record fails again on the next run, so its timestamp moves every time while
 * nothing about the UI has changed. `stale_reason` is NOT excluded — a page that
 * becomes stale, or becomes stale for a different reason, is a real change and
 * has to fire the gate once.
 */
// `generator_version` is here for the same reason as the timestamp, and it was
// caught by a consumer reading the code rather than waiting for the symptom: the
// field carries this tool's own short SHA, so it moves on EVERY commit to it —
// four went in on the morning it was added. Left in the comparison, `--check`
// would call the atlas stale after each of them with every page byte-identical.
//
// ⚠ What settles it: if a tool change really did alter the format, the PAGES say
// so and the gate fires on those. So this line is either redundant or it is the
// only thing firing — and the second is a false alarm. It stays out of the
// comparison and stays in the file, where `suspect` reads it to say "a format
// change moved these pages, not the UI".
const PROVENANCE_LINE = /^(generated_at|generated_from_commit|generator_version|stale_since):/
export const withoutProvenance = (text) =>
  text.split("\n").filter((l) => !PROVENANCE_LINE.test(l)).join("\n")

const slugForPattern = (pattern) =>
  pattern.replace(/^\//, "").replace(/[/[\]#]/g, "-").replace(/-+/g, "-").replace(/-$/, "") || "index"

/**
 * A route may declare a `state:` — a named variant of the same pattern, reached
 * by a query parameter or a setup step. To the framework these are one route; to
 * someone designing on the screen they are two, and they can differ completely.
 */
export const slugFor = (screen) =>
  screen.state ? `${slugForPattern(screen.pattern)}--${screen.state}` : slugForPattern(screen.pattern)

/** Written by writeScreens on every run, so never an orphan. */
const CROSS_SECTION = ["INDEX.md", "ACTIONS.md", "NAVIGATION.md"]

/**
 * Pages on disk that THIS run did not produce — a route deleted from the app, or
 * dropped from the atlas config.
 *
 * ⚠ Nothing here deletes. Removing the page would be the wrong repair for the same
 * reason markStale states: from outside, a deleted page and a screen that never
 * existed look identical. The judgement — gone for good, or a route to restore —
 * belongs to a person; this only makes sure a person is ASKED.
 *
 * ⚠ WHY BOTH PATHS CALL THIS. It was reachable only under `--check`, the mode that
 * writes nothing. The recording path — the one you actually run to refresh the atlas
 * — never looked, so a page whose route left the config stayed on disk, byte for
 * byte, with no stale marker and no mention. Measured in a consumer repo 2026-08-06:
 * three `/ajanlatok*` pages survived the route's removal and had to be deleted BY
 * HAND, noticed only because someone read the config diff. That inverts the tool's
 * own rule — the mode that could act did not look, the mode that looked could not
 * act — and it is exactly the "a stale map is worse than none" failure the atlas
 * exists to prevent, since a page describing a screen that is gone is not missing
 * information, it is false information.
 *
 * A screen that FAILED to record is NOT an orphan: it keeps its page on purpose,
 * already marked stale, and it is passed in with the rest of `screens`.
 */
export function orphanPages({ dir, screens }) {
  if (!fs.existsSync(dir)) return []
  const known = new Set([...screens.map((s) => `${slugFor(s)}.md`), ...CROSS_SECTION])
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !known.has(f))
    // Only a recorded screen page can be orphaned. A hand-written note that happens
    // to live in the atlas directory is not this tool's to comment on.
    .filter((f) => fs.readFileSync(path.join(dir, f), "utf-8").includes("route:"))
}

/**
 * A screen that could not be recorded keeps the page from its last good run —
 * and stops claiming to be current.
 *
 * ⚠ Deleting it is the wrong repair, and the consumer's argument (2026-08-04) is
 * why: from outside, a deleted page and a screen that never existed look exactly
 * the same. The run already prints `✗` and INDEX.md lists the failure, but a
 * reader who opens the one file sees neither.
 *
 * The mark REPLACES itself rather than stacking: the same screen fails again on
 * every run until someone fixes it.
 */
const unmarkStale = (text) =>
  text.replace(/^stale_(since|reason): .*\n/gm, "").replace(/^> ⚠ \*\*STALE\*\*.*\n(?:>.*\n)*\n/gm, "")

function markStale(text, error) {
  const clean = unmarkStale(text)
  const end = clean.indexOf("\n---\n", 4)
  // Not a page this tool wrote — leave it exactly as it is rather than guess.
  if (!clean.startsWith("---\n") || end < 0) return null
  return [
    "---",
    clean.slice(4, end),
    `stale_since: ${new Date().toISOString()}`,
    `stale_reason: ${error}`,
    "---",
    "",
    // The message often ends in a full stop of its own — `exceeded..` reads as a typo
    // in the one line that has to be believed.
    `> ⚠ **STALE** — this screen could not be re-recorded: ${String(error).replace(/\.$/, "")}.`,
    "> What follows is the previous recording, and the screen may have changed since.",
    "",
    clean.slice(end + 5).replace(/^\n+/, ""),
  ].join("\n")
}

/**
 * Runs in the page: resolves once the DOM has stopped changing for `quietMs`,
 * or when `maxMs` runs out. Returns how long it waited and whether it went quiet.
 *
 * ⚠ This replaces "wait a fixed 2500ms and hope". Measured on the consumer
 * 2026-08-04, nine recordings of ONE page at 2500ms: three came out with 32
 * regions and six with 35 — a communication panel arrives late, and a third of
 * the recordings missed it. At 6000ms, nine out of nine agreed. But a bigger
 * constant is still a guess: it is 3.5 seconds wasted on the 32 screens that
 * were ready, and still too short for whatever loads slower tomorrow.
 *
 * ⚠ And "sample twice, accept when they match" is NOT the fix either, which is
 * the trap worth writing down: if the content lands at 4s, samples taken at 2.5s
 * and 3.5s agree perfectly — and both are wrong. Two matching signals are not a
 * confirmation when they share a blind spot. Watching for the mutation itself
 * has no such blind spot: late content resets the timer by arriving.
 */
function quietDom({ quietMs, maxMs }) {
  return new Promise((resolve) => {
    const started = Date.now()
    let timer
    const done = (quiet) => {
      clearTimeout(timer)
      observer.disconnect()
      clearTimeout(cap)
      resolve({ quiet, waitedMs: Date.now() - started })
    }
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => done(true), quietMs)
    }
    const observer = new MutationObserver(arm)
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
    const cap = setTimeout(() => done(false), maxMs)
    arm()
  })
}

function frontmatter(fields) {
  const lines = []
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || (Array.isArray(value) && !value.length)) continue
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) lines.push(`  - ${item}`)
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  return `---\n${lines.join("\n")}\n---`
}

/**
 * @param {object} config  see atlas.config.example.mjs
 * @param {object} opts    { chromium } — the caller supplies the Playwright instance
 *                         so set-atlas never pins a browser version on you.
 *                         { recordedFrom } — the commit the recording STARTED from, stamped
 *                         onto every page. Taken by the caller before the run, never here:
 *                         a full recording takes minutes, so a commit landing mid-run would
 *                         otherwise become the stamp and the atlas would claim to describe a
 *                         state it never saw.
 *
 * ⚠ `recordedFrom` MUST stay in this destructure. It was passed by the CLI but not accepted
 * here, so the write step threw `ReferenceError: recordedFrom is not defined` — AFTER every
 * screen had been visited. The run looked like a success for its whole length (33 green
 * ticks) and wrote nothing, which is the worst shape a failure can take: expensive, and
 * indistinguishable from a completed recording until you look for the files.
 */
export async function capture(config, { chromium, recordedFrom = null, onProgress = () => {} }) {
  const {
    baseUrl,
    routes,
    root,
    outDir,
    viewport = { width: 1600, height: 1000 },
    settleMs = 2500,
    // How long the DOM has to hold still before the map is taken, and how long
    // to keep waiting for that. Measured: the late panel that made one page flap
    // arrives well inside 6s, so 800ms of stillness with an 8s ceiling covers it
    // without spending 3.5s on the screens that were ready at 2500ms.
    quietMs = 800,
    maxQuietMs = 8000,
    dataPatterns = [],
  } = config

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()

  if (config.login) await config.login(page, baseUrl)

  const screens = []
  for (const route of routes) {
    try {
      await page.goto(`${baseUrl}${route.url}`, { waitUntil: "networkidle", timeout: route.timeout ?? 45000 })
      await page.waitForTimeout(route.settleMs ?? settleMs)
      // …and then wait for the page to actually stop moving, rather than trusting
      // that number. A screen that never goes quiet (a poll, a running animation)
      // is recorded anyway at the cap — and SAYS SO, because a map taken from a
      // moving page is exactly the one nobody should read as settled.
      const stillness = await page.evaluate(quietDom, { quietMs: route.quietMs ?? quietMs, maxMs: route.maxQuietMs ?? maxQuietMs })
      if (!stillness.quiet) {
        onProgress({ warn: true, route: route.url, error: `never stopped changing — recorded after ${stillness.waitedMs}ms anyway` })
      }

      // Where the browser actually ended up. Compared on PATH only: a framework
      // that appends its own query string to the same page is not a redirect,
      // and calling it one would put a `redirected_to:` line on half the atlas.
      const landed = new URL(page.url())
      const asked = new URL(`${baseUrl}${route.url}`)
      const redirectedTo = landed.pathname === asked.pathname ? null : landed.pathname + landed.search

      // Setup steps — dialogs and tabs that only exist after interaction.
      for (const step of route.actions ?? []) {
        if (step.click) await page.locator(step.click).first().click()
        else if (step.press) await page.keyboard.press(step.press)
        else if (step.wait) await page.waitForTimeout(step.wait)
      }

      // `ariaSnapshot` waits for the tree to settle, so a page with a running
      // animation or a poll can hang it. Measured 2026-08-04: one such page timed
      // out and — because every route shares this one `page` object — took the
      // 32 routes after it down with it. The log then said "32 screens failed",
      // pointing at everything except the one that broke. Recover explicitly.
      let raw
      try {
        raw = await page.ariaSnapshot({ timeout: route.snapshotTimeout ?? 20000 })
      } catch (snapshotError) {
        await page.goto("about:blank").catch(() => {})
        await page.goto(`${baseUrl}${route.url}`, { waitUntil: "domcontentloaded", timeout: 30000 })
        await page.waitForTimeout(1500)
        raw = await page.ariaSnapshot({ timeout: 30000 }).catch(() => {
          throw new Error(`ariaSnapshot did not settle after a retry — ${snapshotError.message}`)
        })
      }
      // The region map needs geometry, which `ariaSnapshot` does not carry — a
      // column has no ARIA role, because it means nothing to a screen reader and
      // everything to someone designing on the screen.
      //
      // If the page will not give up its boxes, fall back to the flat aria map
      // rather than failing the screen: a worse map beats a missing one, and the
      // frontmatter says which was used so nobody has to guess.
      const flat = compress(raw, { dataPatterns })
      let map
      let mapKind = "regions"
      let regions = 0
      let rendered
      try {
        const dom = await page.evaluate(extractNodes)
        if (dom.truncated) throw new Error(`element tree hit the 30,000-node cap`)
        rendered = renderMap(dom.nodes, { dataPatterns })
        if (!rendered.text) throw new Error("no regions could be reconstructed")
        map = rendered.text
        regions = rendered.regions
      } catch (geometryError) {
        map = flat.text
        mapKind = "aria-flat"
        onProgress({ warn: true, route: route.url, error: `geometry unavailable, using the flat aria map — ${geometryError.message}` })
      }

      screens.push({
        url: route.url,
        pattern: route.pattern ?? route.url,
        state: route.state,
        title: route.title,
        map,
        mapKind,
        regions,
        controlList: rendered?.controlList ?? [],
        // What the recorder DID. A page reached by navigation alone shows only what
        // exists before any interaction — measured twice on 2026-08-04: the consumer
        // read a screen as "this region does not exist here" when the truth was "no
        // row was selected". Same rule as `⚠ N more controls outside this frame`,
        // on the time axis instead of the space axis.
        steps: (route.actions ?? []).map(s => (s.click ? `clicked ${s.click}` : s.press ? `pressed ${s.press}` : null)).filter(Boolean),
        redirectedTo,
        unsettled: stillness.quiet ? null : stillness.waitedMs,
        pointers: buildPointers({ ...route, redirectedTo }, config),
        stats: { rawTokens: estimateTokens(raw), mapTokens: estimateTokens(map), droppedDataLines: flat.droppedDataLines },
      })
      onProgress({ ok: true, route: route.url })
    } catch (error) {
      screens.push({ url: route.url, pattern: route.pattern ?? route.url, state: route.state, error: error.message })
      onProgress({ ok: false, route: route.url, error: error.message })
      // Leave a clean slate for the next route, whatever state this one left behind
      // (open dialog, pending navigation) — otherwise one failure cascades.
      await page.goto("about:blank").catch(() => {})
    }
  }

  await browser.close()

  if (outDir) writeScreens(screens, { root, outDir, recordedFrom })
  return screens
}

/** One markdown page per screen, so the diff stays readable. */
export function writeScreens(screens, { root, outDir, recordedFrom = null }) {
  const dir = path.join(root, outDir)

  // Refuse BEFORE writing anything. The filename comes from the pattern, so two
  // routes sharing one would overwrite each other and INDEX.md would point both
  // rows at the surviving page — while the run still reports every screen as
  // recorded. Reported 2026-08-04 by the atlas's first consumer: the obvious way
  // to record a `?param=` view is to reuse the pattern, and doing so would have
  // deleted a page that was already in the atlas. A half-written directory is
  // worse than a refusal, because `--check` would then report drift that the UI
  // never had.
  const seen = new Map()
  for (const screen of screens) {
    if (screen.error) continue
    const slug = slugFor(screen)
    if (seen.has(slug))
      throw new Error(
        `Two routes would both be written to ${slug}.md — \`${seen.get(slug)}\` and \`${screen.url}\`. ` +
          `Give one of them a distinct \`state:\` in the config.`
      )
    seen.set(slug, screen.url)
  }

  fs.mkdirSync(dir, { recursive: true })

  for (const screen of screens) {
    if (screen.error) continue
    const body = [
      frontmatter({
        route: screen.pattern,
        state: screen.state,
        // Only a variant carries its URL: for a parameterized route the URL holds
        // a concrete record id, which is exactly what the map anonymizes away.
        url: screen.state ? screen.url : null,
        title: screen.title,
        // ⚠ Following a redirect is right — that IS the screen a user lands on —
        // but doing it silently makes two different things look identical: a
        // route with its own UI, and a doorway to someone else's. Reported by
        // the consumer 2026-08-04, where `source:` named a four-line stub.
        redirected_to: screen.redirectedTo,
        // A page that never held still is a map of a moving target. Saying so is
        // the difference between a reader trusting it and a reader checking it.
        recorded_while_changing: screen.unsettled ? `${screen.unsettled}ms` : null,
        ...screen.pointers,
        // Which renderer produced the block below. A reader who sees
        // `aria-flat` knows the layout facts (columns, scroll depth) are absent
        // from THIS page — not that the screen has none.
        map_kind: screen.mapKind,
        regions: screen.regions || null,
        map_tokens: screen.stats.mapTokens,
      }),
      "",
      `# ${screen.title ?? screen.pattern}`,
      "",
      "```yaml",
      // ⚠ Says what the RECORDING was, never what the screen contains. A map made by
      // navigation alone holds no selection-dependent region — no detail pane, no
      // action bar, no search result — and two such maps compared side by side show a
      // structural difference that is not one. Measured 2026-08-04: the consumer read
      // exactly that difference as a finding, twice.
      screen.steps?.length
        ? `# ⚠ capture: after interaction — ${screen.steps.join(", ")}`
        : "# ⚠ capture: navigation only — regions that appear after interaction (detail panes, action bars, search results, menus) are not in this map",
      screen.map,
      "```",
      "",
    ].join("\n")
    fs.writeFileSync(path.join(dir, `${slugFor(screen)}.md`), body)
    // What a reader actually pays for is the WHOLE page, pointers included.
    // Reporting only the compressed map understated the real cost by ~26%
    // (measured 2026-08-04: 23.8k reported vs 30k on disk) — and that number
    // was the basis for "it fits in a design context". Measure what's paid.
    screen.stats.pageTokens = estimateTokens(body)
  }

  const ok = screens.filter((s) => !s.error)
  const failed = screens.filter((s) => s.error)

  // The page left behind by the last good run says so on itself, not only in the
  // index — see markStale.
  for (const screen of failed) {
    const file = path.join(dir, `${slugFor(screen)}.md`)
    if (!fs.existsSync(file)) continue
    const marked = markStale(fs.readFileSync(file, "utf8"), screen.error)
    if (marked) fs.writeFileSync(file, marked)
  }

  const index = [
    frontmatter({
      generator: "set-atlas",
      ...provenance(root, recordedFrom),
      screens: ok.length,
      total_tokens: ok.reduce((a, s) => a + (s.stats.pageTokens ?? s.stats.mapTokens), 0),
    }),
    "",
    "# Surface atlas",
    "",
    "> GENERATED — do not edit. Regenerate with `npx set-atlas`.",
    "",
    // Named before the screen list on purpose: the two questions these answer are the
    // ones a reader would otherwise try to answer by opening every screen page in turn
    // — which is the reading nobody actually does.
    "**Across all screens:** [ACTIONS.md](./ACTIONS.md) — is this action offered somewhere already? ·",
    "[NAVIGATION.md](./NAVIGATION.md) — what reaches this screen, and what nothing reaches.",
    "",
    "| screen | source | tokens |",
    "|---|---|---|",
    // A variant row shows the URL that reaches it — two rows both reading
    // "/rendelesek" would tell a reader nothing about which view is which.
    ...ok.map(
      (s) =>
        `| [${s.state ? s.url : s.pattern}](./${slugFor(s)}.md) | \`${s.pointers.source ?? "—"}\` | ${s.stats.pageTokens ?? s.stats.mapTokens} |`
    ),
    "",
    // Failures are listed, never swallowed: a silently missing screen looks
    // exactly like a screen that doesn't exist.
    ...(failed.length ? ["## Could not be recorded", "", ...failed.map((s) => `- \`${s.url}\` — ${s.error}`), ""] : []),
  ].join("\n")
  fs.writeFileSync(path.join(dir, "INDEX.md"), index)

  // Same recording, no extra capture — the questions that point across screens
  // rather than down into one.
  fs.writeFileSync(path.join(dir, "ACTIONS.md"), buildActions(screens))
  fs.writeFileSync(path.join(dir, "NAVIGATION.md"), buildNavigation(screens))
}
