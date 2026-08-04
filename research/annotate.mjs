// Set-of-Mark prototype — the picture and the text carry the SAME numbers.
//
// The region tree is already derived from rendered geometry, not from the DOM
// hierarchy. This draws those same regions back onto the screenshot, numbered, and
// prints the text map with the matching numbers. A reader can then move in both
// directions: from a box in the picture to its name, size and source file, and from
// a line of the map to where it actually sits on screen.
//
//   node research/annotate.mjs /rendelesek [outdir]
//
// ⚠ The screenshot holds live data. Output goes to research/annotated/, which is
// gitignored like the rest of the corpus.

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { regionTree, subtree, controlsIn } from "../src/regions.mjs"
import { extractNodes } from "../src/render-map.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONSUMER = process.env.ATLAS_CONSUMER || path.resolve(HERE, "../../consumer-a")
const config = (await import(path.join(CONSUMER, "atlas.config.mjs"))).default
const { chromium } = createRequire(path.join(CONSUMER, "package.json"))("@playwright/test")

const url = process.argv[2] || "/"
const outDir = process.argv[3] || path.join(HERE, "annotated")
fs.mkdirSync(outDir, { recursive: true })
const slug = url.replace(/^\//, "").replace(/[/?=]/g, "-") || "index"

const browser = await chromium.launch({ headless: true })
const page = await browser.newContext({ viewport: config.viewport ?? { width: 1600, height: 1000 } }).then(c => c.newPage())
if (config.login) await config.login(page, config.baseUrl)
await page.goto(`${config.baseUrl}${url}`, { waitUntil: "networkidle", timeout: 60000 })
await page.waitForTimeout(config.settleMs ?? 2500)

const dom = await page.evaluate(extractNodes)
const nodes = dom.nodes

// Number the regions in the order the map prints them, so the two agree by construction.
const marks = []
const walk = (t, depth) => {
  const own = controlsIn(nodes, subtree(nodes, t.node.i)).filter(
    n => !t.children.some(c => (c.members ?? [c.node.i]).some(m => subtree(nodes, m).has(n.i)))
  )
  if (own.length || t.children.length) {
    marks.push({ n: marks.length + 1, depth, node: t.node, controls: own.length, repeat: t.repeat ?? 0 })
  }
  for (const c of t.children) walk(c, depth + 1)
}
walk(regionTree(nodes), 0)

// Draw the same boxes back onto the page, then shoot it.
await page.evaluate(
  boxes => {
    const layer = document.createElement("div")
    layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none"
    for (const b of boxes) {
      const hue = (b.depth * 67) % 360
      const box = document.createElement("div")
      box.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border:2px solid hsl(${hue} 90% 45%);box-shadow:inset 0 0 0 1px #fff8`
      const tag = document.createElement("div")
      tag.textContent = b.n
      tag.style.cssText = `position:absolute;left:${b.x}px;top:${Math.max(0, b.y - 1)}px;background:hsl(${hue} 90% 40%);color:#fff;font:700 13px/1.1 monospace;padding:2px 5px;border-radius:0 0 4px 0`
      layer.append(box, tag)
    }
    document.body.append(layer)
  },
  marks.map(m => ({ n: m.n, depth: m.depth, x: m.node.x, y: m.node.y, w: m.node.w, h: m.node.h }))
)

await page.screenshot({ path: path.join(outDir, `${slug}.png`) })
await browser.close()

// The key: the same numbers, with what a picture cannot say.
const key = [
  `# ${url} — annotated regions`,
  "",
  "Each number is a box in the screenshot. The picture carries the layout; the lines",
  "below carry what no picture does — element counts, scroll depth, and the testid that",
  "leads to the source file.",
  "",
  ...marks.map(m => {
    const facts = [`${m.node.w}×${m.node.h}`]
    if (m.repeat) facts.push(`×${m.repeat} repeated`)
    if (m.controls) facts.push(`${m.controls} controls`)
    if (m.node.sh > m.node.ch + 40) facts.push(`⇅ ${m.node.sh}px in ${m.node.ch}px`)
    if (m.node.testid) facts.push(`#${m.node.testid}`)
    return `${"  ".repeat(m.depth)}- **[${m.n}]** ${facts.join(" · ")}`
  }),
  "",
].join("\n")
fs.writeFileSync(path.join(outDir, `${slug}.md`), key)

console.log(`${marks.length} regions marked → ${path.join(outDir, slug)}.png / .md`)
