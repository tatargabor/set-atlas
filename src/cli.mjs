#!/usr/bin/env node
// set-atlas — turn a running app's UI into a compact, generated map.
//
//   npx set-atlas                     # reads atlas.config.mjs from the repo root
//   npx set-atlas --config path.mjs
//   npx set-atlas --check             # writes nothing; exits 1 if the atlas is stale

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createRequire } from "node:module"
import { capture, writeScreens, withoutProvenance } from "./capture.mjs"

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

const checkOnly = args.includes("--check")
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
  const stale = fs.readdirSync(tmp).filter((f) => {
    const current = path.join(dir, f)
    // Compare what the UI produced, not when it was recorded — see
    // `withoutProvenance`.
    return (
      !fs.existsSync(current) ||
      withoutProvenance(fs.readFileSync(current, "utf-8")) !== withoutProvenance(fs.readFileSync(path.join(tmp, f), "utf-8"))
    )
  })
  fs.rmSync(tmp, { recursive: true, force: true })

  if (stale.length) {
    console.error(`\n⚠ The UI changed — ${stale.length} page(s) are stale:\n  ${stale.join("\n  ")}`)
    console.error("\nRegenerate with `npx set-atlas`, then review whether the intent layer needs updating.")
    process.exit(1)
  }
  console.log("\n✓ Atlas is up to date.")
}

if (failed.length) {
  console.error(`\n⚠ ${failed.length} screen(s) could not be recorded — see the list above.`)
  process.exit(2)
}
