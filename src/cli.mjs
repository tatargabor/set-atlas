#!/usr/bin/env node
// set-atlas — turn a running app's UI into a compact, generated map.
//
//   npx set-atlas                     # reads atlas.config.mjs from the repo root
//   npx set-atlas --config path.mjs
//   npx set-atlas --check             # writes nothing; exits 1 if the atlas is stale
//   npx set-atlas --diff              # same gate, but prints WHICH lines moved

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createRequire } from "node:module"
import { capture, writeScreens, withoutProvenance, slugFor } from "./capture.mjs"
import { formatDiff } from "./diff.mjs"

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : (args[i + 1] ?? true)
}

const configPath = path.resolve(flag("--config") || "atlas.config.mjs")
if (!fs.existsSync(configPath)) {
  console.error(`No config found at ${configPath}\nStart from atlas.config.example.mjs`)
  process.exit(1)
}

const config = (await import(pathToFileURL(configPath).href)).default
config.root ??= path.dirname(configPath)

// Resolve Playwright from the CONSUMING project, not from set-atlas's own folder.
// Without this, `npx set-atlas` looks inside its own (empty) node_modules and
// reports "not installed" for a package that is installed.
const requireFromProject = createRequire(path.join(config.root, "package.json"))
let chromium
const reasons = []
for (const pkg of ["playwright", "@playwright/test"]) {
  try {
    const mod = await import(pathToFileURL(requireFromProject.resolve(pkg)).href)
    // `@playwright/test` is CommonJS: under ESM import the named exports stay
    // empty and the real API sits on `default`. Destructuring silently yielded
    // undefined, which an earlier catch-all read as "not installed".
    chromium = mod.chromium ?? mod.default?.chromium
    if (chromium) break
    reasons.push(`${pkg}: loaded, but exports no \`chromium\``)
  } catch (e) {
    reasons.push(`${pkg}: ${e.code === "MODULE_NOT_FOUND" ? "not installed" : e.message}`)
  }
}
if (!chromium) {
  console.error(`Playwright is not available in ${config.root}:\n  ${reasons.join("\n  ")}`)
  console.error("Install it with: pnpm add -D playwright")
  process.exit(1)
}

// `--diff` is the same gate as `--check` — it writes nothing and exits 1 on a
// change — and prints the lines. A hook wants the exit code; a person or an agent
// asking "did the change I just made reach the UI, and where?" wants the lines,
// and today nothing answers that: the tests measure behaviour, the spec states
// intent, and the gap between them is where a feature ships unreachable.
const showDiff = args.includes("--diff")
const checkOnly = args.includes("--check") || showDiff
const screens = await capture(
  { ...config, outDir: checkOnly ? null : config.outDir },
  {
    chromium,
    // A degraded screen is neither a pass nor a failure, and printing it as
    // either hides it — `✓` would claim a layout map that isn't there.
    onProgress: ({ ok, warn, route, error }) =>
      console.log(warn ? `⚠ ${route}: ${error}` : ok ? `✓ ${route}` : `✗ ${route}: ${error}`),
  }
)

const ok = screens.filter((s) => !s.error)
const failed = screens.filter((s) => s.error)
// The whole page is what a reader pays for — map plus pointers, not the map alone.
const tokens = ok.reduce((a, s) => a + (s.stats.pageTokens ?? s.stats.mapTokens), 0)
const raw = ok.reduce((a, s) => a + s.stats.rawTokens, 0)

console.log(
  `\n${ok.length} screens · ~${(tokens / 1000).toFixed(1)}k tokens on disk ` +
    `(raw aria ~${(raw / 1000).toFixed(1)}k — ${(100 - (tokens / raw) * 100).toFixed(0)}% smaller)`
)

if (checkOnly) {
  // Staleness check: compare the freshly recorded pages against what's on disk.
  // Nothing is written — the caller (a git hook, CI) decides from the exit code.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "set-atlas-"))
  writeScreens(screens, { root: tmp, outDir: "." })
  const dir = path.join(config.root, config.outDir)
  const read = (file) => (fs.existsSync(file) ? withoutProvenance(fs.readFileSync(file, "utf-8")) : null)
  const produced = fs.readdirSync(tmp)
  const stale = produced.filter((f) => read(path.join(dir, f)) !== read(path.join(tmp, f)))

  // ⚠ Pages on disk that this run did NOT produce — a route deleted from the app
  // or dropped from the config. Comparing only what was just recorded made those
  // invisible, so the atlas kept describing a screen that no longer exists and
  // `--check` said it was up to date. That is precisely "a stale map is worse
  // than none", inside the gate meant to prevent it.
  //
  // ⚠ A screen that FAILED to record is not orphaned — it is a known failure,
  // already printed as `✗` and already marked stale on its own page. It produces
  // no file this run, so without this it would be reported as a deleted route
  // every single time (measured: `/leltar/[id]` fails on every run).
  const known = new Set([...produced, ...failed.map((s) => `${slugFor(s)}.md`)])
  const orphaned = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !known.has(f))
    .filter((f) => (read(path.join(dir, f)) ?? "").includes("route:") || ["INDEX.md", "ACTIONS.md", "NAVIGATION.md"].includes(f))

  if (showDiff) {
    for (const f of stale) {
      const before = read(path.join(dir, f))
      console.error(`\n${path.join(config.outDir, f)}${before === null ? "   (new)" : ""}`)
      for (const line of formatDiff(before ?? "", read(path.join(tmp, f)))) console.error(line)
    }
    for (const f of orphaned) console.error(`\n${path.join(config.outDir, f)}   ⚠ on disk, but this run did not produce it — the route may be gone`)
  }
  fs.rmSync(tmp, { recursive: true, force: true })

  if (stale.length || orphaned.length) {
    if (stale.length) console.error(`\n⚠ The UI changed — ${stale.length} page(s) are stale:\n  ${stale.join("\n  ")}`)
    if (orphaned.length) console.error(`\n⚠ ${orphaned.length} page(s) on disk were not produced by this run:\n  ${orphaned.join("\n  ")}`)
    console.error(
      showDiff
        ? "\nRegenerate with `npx set-atlas`, then review whether the intent layer needs updating."
        : "\nRegenerate with `npx set-atlas` (or `--diff` to see which lines moved), then review whether the intent layer needs updating."
    )
    process.exit(1)
  }
  console.log("\n✓ Atlas is up to date.")
}

if (failed.length) {
  console.error(`\n⚠ ${failed.length} screen(s) could not be recorded — see the list above.`)
  process.exit(2)
}
