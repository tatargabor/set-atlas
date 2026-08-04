// Benchmark builder — turns the recorded geometry into questions WITH answers.
//
// The point of computing the ground truth instead of judging it: if a human (or
// this agent) decides what "the same column" means per screen, the screenshot
// arm is being graded by someone who already saw the screenshot. Geometry is
// indifferent. Every answer below falls out of the boxes, so the picture is just
// another contestant.
//
// Deliberately NOT covered here: whether a control does what its label says.
// That is server-side scope, and no surface format can see it — the atlas guides,
// it does not prove.
//
//   node research/build-benchmark.mjs        # writes research/benchmark.json

import fs from "node:fs"
import path from "node:path"
import { regionTree, subtree, controlsIn, isScroller, childrenOf } from "./lib/regions.mjs"
import { isRecordName } from "../src/compress.mjs"

const CORPUS = path.join(import.meta.dirname, "corpus")
// Whatever the recorder actually captured — no app's route names live in here.
const SCREENS = fs.readdirSync(CORPUS).filter((d) => fs.existsSync(path.join(CORPUS, d, "nodes.json"))).sort()

const load = (slug) => ({
  nodes: JSON.parse(fs.readFileSync(path.join(CORPUS, slug, "nodes.json"), "utf8")),
  meta: JSON.parse(fs.readFileSync(path.join(CORPUS, slug, "meta.json"), "utf8")),
})

/** A control we can refer to in a question: it has a name a reader would recognise. */
const nameable = (n) => n.name && n.name.length >= 3 && n.name.length <= 45 && !/^\d+$/.test(n.name)

const centre = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 })

/** Columns overlap horizontally; "same column" is an x-interval question. */
const sameColumn = (a, b) => {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  return ox > 0.5 * Math.min(a.w, b.w)
}

const quadrant = (n, vp) => {
  const c = centre(n)
  return `${c.y < vp.h / 2 ? "felső" : "alsó"}-${c.x < vp.w / 2 ? "bal" : "jobb"}`
}

const inViewport = (n, vp) => n.x >= 0 && n.y >= 0 && n.x + n.w <= vp.w && n.y + n.h <= vp.h

/**
 * The visually primary action: a filled, saturated button.
 *
 * ⚠ This browser reports colours as `oklch(L C H)`, not `rgb()`. Pulling the
 * numbers out and treating them as R,G,B made the hue (260) the "max channel",
 * so every neutral surface scored a saturation near 1 — and the benchmark
 * answered "the header search button" on five screens out of six. In oklch the
 * second component IS the chroma; read it directly.
 */
function colourfulness(css) {
  const oklch = css.match(/oklch\(\s*([\d.]+)[\s/]+([\d.]+)/i)
  if (oklch) return Number(oklch[2]) // chroma, 0 … ~0.37
  const rgba = (css.match(/[\d.]+/g) ?? []).map(Number)
  if (rgba.length < 3 || (rgba.length > 3 && rgba[3] === 0)) return 0
  const [r, g, b] = rgba
  const max = Math.max(r, g, b)
  return max === 0 ? 0 : ((max - Math.min(r, g, b)) / max) * 0.37 // scaled to the oklch range
}

const MIN_CHROMA = 0.04

function primaryAction(nodes, vp, isContent) {
  return nodes
    .filter(
      (n) =>
        n.tag === "button" && nameable(n) && isContent(n) && inViewport(n, vp) && !n.dis && n.w * n.h > 1500 && colourfulness(n.bg) > MIN_CHROMA
    )
    .sort((a, b) => b.w * b.h - a.w * a.h)[0]
}

/**
 * How many side-by-side columns the content splits into — the single fact the
 * flat aria dump cannot express at all.
 */
// ⚠ THE GROUND TRUTH WAS WRONG HERE, and the runs caught it. Any two boxes
// side by side counted as columns, so a toolbar with a title on the left and
// two buttons on the right made /penzugy "2 columns". All six arms — including
// the one looking at the screenshot — answered 1. When every independent reader
// disagrees with the key, the key is what is broken.
//
// A column runs the height of its container. A toolbar's halves do not.
// ⚠ …and "each column must fill half its container" was the wrong correction:
// /beallitasok pairs a 596px settings nav with a 1371px content panel, so the
// nav — a column by any reading, and all six arms called it one — was thrown
// out. A column is tall in ABSOLUTE terms; a toolbar's halves are 32 and 48px.
const MIN_COLUMN_H = 150
const MIN_COLUMN_CONTAINER_H = 200

function columnCount(tree) {
  let best = 1
  const walk = (t) => {
    // The question says "without the left icon rail", so the rail must not be
    // counted as a column — otherwise every single-column page answers 2.
    const kids = t.children.filter((c) => !c.overlay && !(c.node.x + c.node.w <= 70) && c.node.tag !== "header")
    const sideBySide = kids.filter((c, i) => kids.some((o, j) => j !== i && o.node.x + o.node.w <= c.node.x + 4))
    const tall = kids.every((c) => c.node.h >= MIN_COLUMN_H)
    if (sideBySide.length && tall && t.node.h >= MIN_COLUMN_CONTAINER_H) best = Math.max(best, kids.length)
    kids.forEach(walk)
  }
  walk(tree)
  return best
}

/** The screen's dominant repeated list, if it has one. */
function biggestList(nodes) {
  const tree = regionTree(nodes)
  let best = null
  const walk = (t) => {
    if (t.repeat && (!best || t.repeat > best.repeat)) best = t
    t.children.forEach(walk)
  }
  walk(tree)
  return best
}

/** The scroll container holding the most content. */
function biggestScroller(nodes) {
  return nodes
    .filter((n) => isScroller(n) && n.ch > 100)
    .sort((a, b) => b.sh - b.ch - (a.sh - a.ch))[0]
}

/** Top-level content regions, excluding the app chrome (rail, header). */
function contentRegions(nodes) {
  const tree = regionTree(nodes)
  const main = [tree, ...tree.children].find((t) => t.node.tag === "main") ?? tree
  const body = main.children.filter((c) => c.node.tag !== "header")
  // Unwrap a single page wrapper — its children are the regions a reader sees.
  return body.length === 1 && body[0].children.length ? body[0].children : body
}

function buildScreen(slug) {
  const { nodes, meta } = load(slug)
  const vp = meta.viewport
  const items = []
  const add = (id, type, question, answer, note) => items.push({ id: `${slug}:${id}`, type, question, answer, note })

  // ⚠ Every screen wears the same chrome: a 63px icon rail and a header whose
  // search button spans x=544…992. A first pass drew its question material from
  // anywhere on the page and so asked about that button on five screens out of
  // six — "which quadrant?" answered "felső-bal" every time. A benchmark whose
  // answers repeat is won by guessing. Questions come from the PAGE only.
  // The floating assistant button and the toast region are `position: fixed`
  // and sit at the same spot on every screen. Left in, they answered "which
  // quadrant?" with "alsó-jobb" six times out of six and were named the primary
  // action on two screens — furniture masquerading as page content.
  const chrome = new Set()
  for (const n of nodes) {
    const furniture = n.testid === "app-header" || (n.tag === "nav" && n.x < 80) || (n.x + n.w <= 70 && n.h > 300) || n.pos === "fixed"
    if (furniture) for (const i of subtree(nodes, n.i)) chrome.add(i)
  }
  const isContent = (n) => !chrome.has(n.i)

  const controls = controlsIn(
    nodes,
    nodes.map((n) => n.i)
  ).filter((n) => nameable(n) && isContent(n))
  const onScreen = controls.filter((n) => inViewport(n, vp))
  const tree = regionTree(nodes)

  // ── Q_A · same column? One pair that shares one, one pair that does not.
  const regions = contentRegions(nodes)
  const pick = (region) => {
    const ids = subtree(nodes, region.node.i)
    return controlsIn(nodes, ids).filter((n) => nameable(n) && isContent(n) && inViewport(n, vp))[0]
  }
  const apart = onScreen.find((n, i) => onScreen.slice(i + 1).some((m) => !sameColumn(n, m)))
  if (apart) {
    const other = onScreen.find((m) => m.i !== apart.i && !sameColumn(apart, m))
    add(
      "hasab-kulon",
      "same-column",
      `Egy függőleges hasábban van-e a(z) „${apart.name}" és a(z) „${other.name}"? Válasz: IGEN vagy NEM.`,
      "NEM",
      `x-tartomány ${apart.x}–${apart.x + apart.w} vs ${other.x}–${other.x + other.w}`
    )
  }
  const pair = onScreen.find((n, i) => onScreen.slice(i + 1).some((m) => sameColumn(n, m) && m.y - n.y > 100))
  if (pair) {
    const other = onScreen.find((m) => m.i !== pair.i && sameColumn(pair, m) && m.y - pair.y > 100)
    add(
      "hasab-azonos",
      "same-column",
      `Egy függőleges hasábban van-e a(z) „${pair.name}" és a(z) „${other.name}"? Válasz: IGEN vagy NEM.`,
      "IGEN",
      `x-tartomány ${pair.x}–${pair.x + pair.w} vs ${other.x}–${other.x + other.w}`
    )
  }

  // ── Q_B · co-visibility, in BOTH polarities. The atlas is blind to this.
  const off = controls.find((n) => !inViewport(n, vp) && n.y > vp.h)
  if (off && onScreen[0]) {
    add(
      "egyutt-nem",
      "co-visible",
      `Görgetés és kattintás nélkül egyszerre látszik-e a(z) „${onScreen[0].name}" és a(z) „${off.name}"? Válasz: IGEN vagy NEM.`,
      "NEM",
      `a második y=${off.y}, a látómező ${vp.h}px magas`
    )
  }
  const far = onScreen.find((n) => onScreen[0] && Math.abs(n.x - onScreen[0].x) > 300)
  if (far && onScreen[0]) {
    add(
      "egyutt-igen",
      "co-visible",
      `Görgetés és kattintás nélkül egyszerre látszik-e a(z) „${onScreen[0].name}" és a(z) „${far.name}"? Válasz: IGEN vagy NEM.`,
      "IGEN",
      `mindkettő a látómezőn belül: y=${onScreen[0].y} és y=${far.y}`
    )
  }

  // ── Q_C · where on the screen. Anchor on the control FURTHEST from centre,
  // so the answer is not always the quadrant the page happens to start in.
  const anchor = [...onScreen]
    .filter((n) => n.w * n.h > 1200)
    .sort((a, b) => Math.hypot(centre(b).x - vp.w / 2, centre(b).y - vp.h / 2) - Math.hypot(centre(a).x - vp.w / 2, centre(a).y - vp.h / 2))[0]
  if (anchor) {
    add(
      "negyed",
      "quadrant",
      `A képernyő melyik negyedében van a(z) „${anchor.name}"? Válasz: felső-bal, felső-jobb, alsó-bal vagy alsó-jobb.`,
      quadrant(anchor, vp),
      `középpont ${Math.round(centre(anchor).x)},${Math.round(centre(anchor).y)} · látómező ${vp.w}×${vp.h}`
    )
  }

  // ── Q_H · how many side-by-side columns. The headline structural question.
  add(
    "hasab-szam",
    "column-count",
    `Hány egymás MELLETTI függőleges hasábra oszlik a tartalomterület (a bal ikonsáv nélkül)? Egy számot adj.`,
    String(columnCount(tree)),
    `a legszélesebb vízszintes felosztás ${columnCount(tree)} elemű`
  )

  // ── Q_D · scale of the dominant list.
  const list = biggestList(nodes)
  if (list) {
    const bucket = list.repeat < 10 ? "kevesebb mint 10" : list.repeat < 50 ? "10 és 50 között" : "több mint 50"
    add(
      "lista-meret",
      "list-scale",
      `Hány elemű a képernyő legnagyobb ismétlődő listája? Válasz: „kevesebb mint 10", „10 és 50 között" vagy „több mint 50".`,
      bucket,
      `pontosan ${list.repeat} elem`
    )
  }

  // ── Q_E · the primary action.
  const primary = primaryAction(nodes, vp, isContent)
  if (primary) {
    add(
      "elsodleges",
      "primary-action",
      `Melyik a képernyő vizuálisan kiemelt, elsődleges műveleti gombja (kitöltött, márkaszínű)? A gomb feliratát add meg.`,
      primary.name,
      `háttér ${primary.bg}, ${primary.w}×${primary.h}px`
    )
  }

  // ── Q_F · how far the content overruns its frame.
  //
  // Asked as "what share is visible", four screens out of five answered
  // "töredékét" — true, but a benchmark item that is constant is not measuring
  // anything. The overrun FACTOR spreads the same fact across real buckets.
  const scroller = biggestScroller(nodes)
  if (scroller) {
    const factor = scroller.sh / scroller.ch
    const bucket = factor < 3 ? "kevesebb mint 3×" : factor < 15 ? "3× és 15× között" : "több mint 15×"
    add(
      "gorgetes",
      "scroll-overrun",
      `A képernyő legnagyobb görgethető területén hányszor annyi tartalom van, mint amennyi egyszerre látszik? Válasz: „kevesebb mint 3×", „3× és 15× között" vagy „több mint 15×".`,
      bucket,
      `${scroller.sh}px tartalom a ${scroller.ch}px keretben (${factor.toFixed(1)}×)`
    )
  }

  // ── Q_G · where a NEW element lands. Every question above asks where
  // something IS; measured 2026-08-04, the arms stood at 98% on those, so one
  // more of them measures nothing. The question a designer actually has is
  // "where does the new thing go so that it fits", and its answer has to fall
  // out of the container — otherwise the arms are being graded on taste.
  //
  // ⚠ The items above are NOT touched. A recorded run is keyed by item id, so
  // changing what an id asks would re-score answers never given to it.
  //
  // Three measurements shaped the rule:
  // (1) Requiring the anchor to be a direct-child button matched NOTHING on 33
  //     screens — buttons are wrapped. The anchor is the lone named control of
  //     a child box, which is what makes "the same group as X" unambiguous.
  // (2) On /ajanlatok/new one anchor answered BOTH ways: it qualified in a row
  //     container and in a column container one level up. The group a reader
  //     sees is the tightest one, so the smallest container wins.
  // (3) Only flex containers were considered and 8 screens yielded a balanced
  //     pair; this app stacks vertically with plain `block` (Tailwind space-y),
  //     and counting those took it to 20.
  const groups = new Map()
  // A name that occurs twice cannot anchor anything — „Vissza" is then two
  // buttons and the arms would be graded on which one they happened to pick.
  const nameCount = controls.reduce((a, c) => ((a[c.name] = (a[c.name] ?? 0) + 1), a), {})
  // A record is not interface: the shipped format redacts it, so no arm could
  // name it however good its structure is — and a question set built from a
  // production-copy database should not be quoting customer data back at anyone.
  const anchorable = (n) => nameCount[n.name] === 1 && !isRecordName(n.name)

  for (const parent of nodes) {
    if (!isContent(parent) || parent.w === 0 || parent.h === 0 || parent.vis === "hidden") continue
    const flex = parent.dsp.includes("flex")
    if (!flex && parent.dsp !== "block") continue
    const kids = childrenOf(nodes, parent.i).filter((k) => k.w * k.h > 400 && k.vis !== "hidden" && inViewport(k, vp))
    if (kids.length < 2 || kids.length > 12) continue
    const order = [...kids].sort((a, b) => a.y - b.y || a.x - b.x)
    const beside = order.every((k, i) => i === 0 || order[i - 1].x + order[i - 1].w <= k.x + 4)
    const below = order.every((k, i) => i === 0 || order[i - 1].y + order[i - 1].h <= k.y + 4)
    if (beside === below) continue // a wrapping row answers both ways — not asked
    // The boxes and the CSS have to agree. `block` stacks vertically by
    // definition; flex has to match its own direction.
    if (flex ? parent.fd.startsWith("row") !== beside : beside) continue
    for (const kid of kids) {
      const named = controlsIn(nodes, subtree(nodes, kid.i)).filter((c) => nameable(c) && isContent(c) && anchorable(c))
      if (named.length !== 1) continue
      const prev = groups.get(named[0].name)
      const area = parent.w * parent.h
      if (!prev || area < prev.area) {
        groups.set(named[0].name, { anchor: named[0], answer: beside ? "MELLÉ" : "ALÁ", siblings: kids.length, area, dsp: parent.dsp, fd: parent.fd })
      }
    }
  }
  // ⚠ Emitted only in BALANCED PAIRS. Left to itself the type ran 30 MELLÉ to
  // 11 ALÁ across the corpus, so answering "MELLÉ" to everything scored 73%.
  // Pairing per screen keeps it at 50% for ANY subset of screens a run picks.
  const widest = (want) => [...groups.values()].filter((g) => g.answer === want).sort((a, b) => b.siblings - a.siblings)[0]
  const [besideGroup, belowGroup] = [widest("MELLÉ"), widest("ALÁ")]
  if (besideGroup && belowGroup) {
    for (const g of [besideGroup, belowGroup]) {
      add(
        g.answer === "MELLÉ" ? "uj-elem-melle" : "uj-elem-ala",
        "stack-direction",
        `Ha a(z) „${g.anchor.name}" mellé egy új, hasonló elemet tennénk ugyanabba a csoportba, az a(z) „${g.anchor.name}" MELLÉ (vízszintesen, ugyanabba a sorba) vagy ALÁ (függőlegesen, új sorba) kerülne? Válasz: MELLÉ vagy ALÁ.`,
        g.answer,
        `${g.siblings} testvér egy ${g.dsp}${g.dsp.includes("flex") ? `/${g.fd}` : ""} tárolóban`
      )
    }
  }

  return { slug, title: meta.title, url: meta.url, archetype: meta.archetype, viewport: vp, items }
}

const screens = SCREENS.map(buildScreen)
const out = { generated: "geometriából számolva", screens }
fs.writeFileSync(path.join(import.meta.dirname, "benchmark.json"), JSON.stringify(out, null, 2))

for (const s of screens) {
  console.log(`\n${s.slug} — ${s.items.length} kérdés`)
  for (const it of s.items) console.log(`  ${it.type.padEnd(14)} → ${String(it.answer).slice(0, 40).padEnd(40)} (${it.note})`)
}
console.log(`\nÖsszesen ${screens.reduce((a, s) => a + s.items.length, 0)} kérdés · research/benchmark.json`)
