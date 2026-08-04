// The recorder — a running app becomes one map page per screen.
//
// The source is Playwright's `page.ariaSnapshot()`: the accessibility tree as YAML.
// That is the layer screen readers and AI agents already see, which is why it
// survives CSS churn and carries MEANING rather than pixels.

import fs from "node:fs"
import path from "node:path"
import { compress, estimateTokens } from "./compress.mjs"
import { renderMap, extractNodes } from "./render-map.mjs"
import { buildPointers } from "./pointers.mjs"
import { buildActions, buildNavigation } from "./crosscut.mjs"

const slugForPattern = (pattern) =>
  pattern.replace(/^\//, "").replace(/[/[\]#]/g, "-").replace(/-+/g, "-").replace(/-$/, "") || "index"

/**
 * A route may declare a `state:` — a named variant of the same pattern, reached
 * by a query parameter or a setup step. To the framework these are one route; to
 * someone designing on the screen they are two, and they can differ completely.
 */
const slugFor = (screen) =>
  screen.state ? `${slugForPattern(screen.pattern)}--${screen.state}` : slugForPattern(screen.pattern)

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
 */
export async function capture(config, { chromium, onProgress = () => {} }) {
  const { baseUrl, routes, root, outDir, viewport = { width: 1600, height: 1000 }, settleMs = 2500, dataPatterns = [] } = config

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()

  if (config.login) await config.login(page, baseUrl)

  const screens = []
  for (const route of routes) {
    try {
      await page.goto(`${baseUrl}${route.url}`, { waitUntil: "networkidle", timeout: route.timeout ?? 45000 })
      await page.waitForTimeout(route.settleMs ?? settleMs)

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
        pointers: buildPointers(route, config),
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

  if (outDir) writeScreens(screens, { root, outDir })
  return screens
}

/** One markdown page per screen, so the diff stays readable. */
export function writeScreens(screens, { root, outDir }) {
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
  const index = [
    frontmatter({
      generator: "set-atlas",
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
