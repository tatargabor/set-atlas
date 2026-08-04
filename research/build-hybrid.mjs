// Draws the numbered regions onto the recorded screenshots — the picture half of
// the S6 hybrid arm. Its text half is `hybridText` in lib/variants.mjs, and both
// number the regions from ONE walk, so they cannot disagree.
//
//   node research/build-hybrid.mjs           # every recorded screen
//   node research/build-hybrid.mjs rendelesek
//
// ⚠ Reads the CORPUS, not the running app. The consumer's dev server does not
// have to be up, and the boxes land on exactly the pixels the other arms were
// measured against — a re-shot page would differ by a day of data.
//
// ⚠ Output goes to research/variants/hybrid/, which is gitignored like the rest
// of the corpus: these are screenshots of a production-copy database.

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { regionTreeMarked } from "./lib/variants.mjs"

const HERE = import.meta.dirname
const CORPUS = path.join(HERE, "corpus")
const OUT = path.join(HERE, "variants", "hybrid")
const CONSUMER = process.env.ATLAS_CONSUMER || path.resolve(HERE, "../../consumer-a")
const { chromium } = createRequire(path.join(CONSUMER, "package.json"))("@playwright/test")

const only = process.argv[2]
const SCREENS = fs
  .readdirSync(CORPUS)
  .filter((d) => fs.existsSync(path.join(CORPUS, d, "shot.png")) && (!only || d === only))
  .sort()

if (!SCREENS.length) {
  console.error(only ? `Nincs ilyen felvétel: ${only}` : "Üres korpusz — előbb research/capture-corpus.mjs")
  process.exit(1)
}

/**
 * Where the number goes. The badge has to be readable AND not sit on top of the
 * label a question will ask about — our own annotation must not handicap the arm
 * it is built for.
 *
 * ⚠ Measured across the 33 recorded screens, counting how many named elements a
 * badge rectangle covers: inside the top-left corner (the first version) covered
 * 325; outside on the left covered 136 but pushed 69 badges off the canvas; this
 * chain — left if there is room, else above, else inside — covers the same 136
 * with nothing lost. Bottom-left (216) and top-right (290) were both worse.
 */
const BADGE_H = 17
const badgeW = (n) => 10 + 7 * String(n).length
function badgeAt(m) {
  const w = badgeW(m.n)
  if (m.x >= w) return { bx: m.x - w, by: m.y }
  if (m.y >= BADGE_H) return { bx: m.x, by: m.y - BADGE_H }
  return { bx: m.x, by: m.y }
}

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true })

for (const slug of SCREENS) {
  const dir = path.join(CORPUS, slug)
  const nodes = JSON.parse(fs.readFileSync(path.join(dir, "nodes.json"), "utf8"))
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"))
  const vp = meta.viewport
  const { marks } = regionTreeMarked({ nodes, meta }, { numbered: true })
  const visible = marks.filter((m) => m.x < vp.w && m.y < vp.h).map((m) => ({ ...m, ...badgeAt(m) }))

  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr ?? 2 })
  const page = await context.newPage()
  const shot = fs.readFileSync(path.join(dir, "shot.png")).toString("base64")

  // The screenshot goes in at its CSS size, so a node's recorded x/y is the
  // same pixel here as it was in the live page — no rescaling anywhere.
  await page.setContent(
    `<style>html,body{margin:0;padding:0;overflow:hidden}</style>` +
      `<img src="data:image/png;base64,${shot}" style="position:absolute;left:0;top:0;width:${vp.w}px;height:${vp.h}px">`
  )

  await page.evaluate((boxes) => {
    const layer = document.createElement("div")
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none"
    for (const b of boxes) {
      // Depth decides the hue, so nesting is readable without covering anything.
      // ⚠ Deliberately NOT a background tint: a fill hides the very thing the
      // picture is here to carry, and a colour name is a far weaker handle for a
      // reader than a number it can quote back.
      const hue = (b.depth * 67) % 360
      const box = document.createElement("div")
      box.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border:2px solid hsl(${hue} 90% 45%);box-shadow:inset 0 0 0 1px #fff8`
      // The placement was decided in Node, from the same formula the measurement
      // used — a badge drawn somewhere other than where it was measured proves
      // nothing about occlusion.
      const tag = document.createElement("div")
      tag.textContent = b.n
      tag.style.cssText =
        `position:absolute;left:${b.bx}px;top:${b.by}px;height:17px;box-sizing:border-box;background:hsl(${hue} 90% 40%);` +
        `color:#fff;font:700 13px/13px monospace;padding:2px 5px;border-radius:3px`
      layer.append(box, tag)
    }
    document.body.append(layer)
  }, visible)

  await page.screenshot({ path: path.join(OUT, `${slug}.png`) })
  await context.close()

  const hidden = marks.length - visible.length
  console.log(`${slug.padEnd(28)} ${String(visible.length).padStart(3)} régió bejelölve${hidden ? `  ⚠ ${hidden} a látómezőn kívül` : ""}`)
}

await browser.close()
console.log(`\n${SCREENS.length} kép · ${OUT}`)
