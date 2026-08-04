// Corpus recorder for the "what does a screenshot carry that the aria tree does not"
// research. For each screen it records FOUR views of the SAME instant:
//
//   shot.png      the pixels — the ceiling any text format is measured against
//   aria.yaml     raw page.ariaSnapshot() — what set-atlas ships today
//   nodes.json    every element with its box, computed style and scroll state
//   meta.json     viewport, url, timing
//
// Why one instant: the manual's existing PNGs were taken on a different data
// state than docs/atlas/ was generated on (the atlas says "Összes(257)", the
// PNG says "Összes (209)"). Pairing those would measure the drift, not the format.
//
// ⚠ The output contains a production-copy database's real names and addresses.
//   research/corpus/ is gitignored and nothing from it is published verbatim.
//
//   node research/capture-corpus.mjs                 # all screens
//   node research/capture-corpus.mjs /penzugy        # one screen

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

// The consumer is a PARAMETER, never a constant. set-atlas is a public package;
// the app it happens to be measured against belongs in that app's own notes.
//   ATLAS_CONSUMER=/path/to/app node research/capture-corpus.mjs --all
const CONSUMER = process.env.ATLAS_CONSUMER
if (!CONSUMER) throw new Error("Set ATLAS_CONSUMER to the consumer app's root (it must have an atlas.config.mjs).")
const OUT = path.join(import.meta.dirname, "corpus")

// ⚠ Six archetypes were enough to CHOOSE a format; they are not enough to tune
// its vocabulary. The `panel` catch-all and the missing in-bar position only
// show their real frequency across the whole consumer app, so `--all` records
// every route the consumer's own atlas config lists.
const ALL = process.argv.includes("--all")

/**
 * A subset worth recording when you do not want all of them — layout archetypes,
 * not favourite pages. Point ATLAS_SCREENS at a JSON file of
 * `[{slug, url, title, archetype}]`; without it, `--all` is the way in.
 */
const SCREENS = process.env.ATLAS_SCREENS ? JSON.parse(fs.readFileSync(process.env.ATLAS_SCREENS, "utf8")) : []

/**
 * Runs in the page. Walks the render tree and records what a screenshot shows
 * but the accessibility tree does not: position, size, stacking, scroll, and the
 * type contrast that makes one button read as primary.
 */
function extractNodes() {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE"])
  const MAX_NODES = 30000
  const out = []

  const accName = (el) => {
    const label = el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("placeholder") || el.getAttribute("title")
    if (label) return label.trim().slice(0, 120)
    // Own text only for leaf-ish controls; a container's text is its children's.
    const tag = el.tagName
    if (tag === "BUTTON" || tag === "A" || tag === "LABEL" || /^H[1-6]$/.test(tag) || el.getAttribute("role") === "tab") {
      return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120)
    }
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return (el.value || "").slice(0, 60)
    return ""
  }

  const walk = (el, parent, depth) => {
    if (out.length >= MAX_NODES) return
    if (SKIP.has(el.tagName)) return

    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const i = out.length

    out.push({
      i,
      p: parent,
      d: depth,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      testid: el.getAttribute("data-testid") || "",
      name: accName(el),
      // Box, rounded to whole pixels — sub-pixel noise would make diffs useless.
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      // Scroll state: a 209-row list inside a 600px box is a scroll container,
      // and "how much is actually on screen" is a question the atlas cannot answer.
      sh: el.scrollHeight,
      ch: el.clientHeight,
      sw: el.scrollWidth,
      cw: el.clientWidth,
      // The layout facts. display/flex/grid is how the columns come to exist.
      dsp: cs.display,
      fd: cs.flexDirection,
      gtc: cs.gridTemplateColumns === "none" ? "" : cs.gridTemplateColumns,
      pos: cs.position,
      ovx: cs.overflowX,
      ovy: cs.overflowY,
      z: cs.zIndex === "auto" ? "" : cs.zIndex,
      // Prominence: size, weight and fill are how a human sees "this is the CTA".
      fs: parseFloat(cs.fontSize) || 0,
      fw: cs.fontWeight,
      col: cs.color,
      bg: cs.backgroundColor,
      br: cs.borderRadius,
      op: cs.opacity,
      vis: cs.visibility,
      dis: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      sel: el.getAttribute("aria-selected") === "true" || el.getAttribute("data-state") === "active",
    })

    for (const child of el.children) walk(child, i, depth + 1)
  }

  walk(document.body, -1, 0)
  return {
    nodes: out,
    truncated: out.length >= MAX_NODES,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    scroll: { h: document.documentElement.scrollHeight },
  }
}

async function main() {
  const requireFromConsumer0 = createRequire(path.join(CONSUMER, "package.json"))
  const configForList = (await import(pathToFileURL(path.join(CONSUMER, "atlas.config.mjs")).href)).default

  const only = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null
  const all = configForList.routes.map((r) => ({
    slug: (r.pattern ?? r.url).replace(/^\//, "").replace(/[/[\]#]/g, "-").replace(/-+/g, "-").replace(/-$/, "") || "index",
    url: r.url,
    title: r.title,
    archetype: "a fogyasztó teljes útvonallistájából",
  }))
  const screens = ALL ? all : only ? SCREENS.filter((s) => s.url === only || s.slug === only) : SCREENS
  if (!screens.length) throw new Error(`Nincs ilyen képernyő: ${only}`)

  const requireFromConsumer = createRequire(path.join(CONSUMER, "package.json"))
  const chromium = requireFromConsumer("@playwright/test").chromium
  const config = (await import(pathToFileURL(path.join(CONSUMER, "atlas.config.mjs")).href)).default
  const baseUrl = config.baseUrl

  const browser = await chromium.launch({ headless: true })
  // Same viewport the atlas records at, so the two describe one screen.
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await config.login(page, baseUrl)

  for (const screen of screens) {
    const dir = path.join(OUT, screen.slug)
    fs.mkdirSync(dir, { recursive: true })
    process.stdout.write(`${screen.slug} … `)
    try {
      await page.goto(`${baseUrl}${screen.url}`, { waitUntil: "networkidle", timeout: 60000 })
      await page.waitForTimeout(3000)

      await page.screenshot({ path: path.join(dir, "shot.png") })
      const aria = await page.ariaSnapshot({ timeout: 30000 })
      const dom = await page.evaluate(extractNodes)

      fs.writeFileSync(path.join(dir, "aria.yaml"), aria)
      fs.writeFileSync(path.join(dir, "nodes.json"), JSON.stringify(dom.nodes))
      fs.writeFileSync(
        path.join(dir, "meta.json"),
        JSON.stringify({ ...screen, baseUrl, viewport: dom.viewport, pageHeight: dom.scroll.h, truncated: dom.truncated, nodeCount: dom.nodes.length }, null, 2)
      )
      console.log(`ok · ${dom.nodes.length} node${dom.truncated ? " ⚠ TRUNCATED" : ""} · aria ${Math.round(aria.length / 3.3)} token`)
    } catch (error) {
      console.log(`HIBA — ${error.message}`)
      fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ ...screen, error: error.message }, null, 2))
    }
  }

  await browser.close()
}

main()
