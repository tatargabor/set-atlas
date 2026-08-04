// The contestants. Each turns ONE recorded screen into ONE text a reader gets
// instead of the screenshot.
//
// Every variant here is deterministic and generated from the same capture, so a
// difference in score is a difference in FORMAT, not in what was recorded. The
// one exception is `vision-prose`, which needs a model to look at the picture —
// it is the ceiling reference, not a shippable format, and it is marked as such
// wherever it appears.

import { regionTree, subtree, controlsIn, childrenOf, isScroller, shapeKey } from "./regions.mjs"
import { compress } from "../../src/compress.mjs"

export const estimateTokens = (text) => Math.round(text.length / 3.3)

/* ─────────────────────────── shared helpers ─────────────────────────── */

const CONTROL_TAGS = new Set(["button", "a", "input", "textarea", "select"])
const CONTROL_ROLES = new Set(["button", "link", "tab", "checkbox", "radio", "switch", "menuitem", "option", "combobox", "textbox"])
const isControl = (n) => CONTROL_TAGS.has(n.tag) || CONTROL_ROLES.has(n.role)

const kind = (n) => {
  if (n.role) return n.role
  if (n.tag === "a") return "link"
  if (n.tag === "input") return "textbox"
  if (n.tag === "select") return "combobox"
  if (n.tag === "textarea") return "textbox"
  return n.tag
}

const label = (n) => {
  const name = (n.name || "").replace(/\s+/g, " ").trim()
  return name ? `${kind(n)} "${name.slice(0, 40)}"` : n.testid ? `${kind(n)} #${n.testid}` : kind(n)
}

/**
 * What a region IS, argued from what it contains — never hand-written.
 *
 * This is the one place the variants add a word that is not in the DOM, so the
 * evidence for each label is listed beside it: a reader who distrusts the label
 * can check it against the counts printed on the same line.
 */
function roleOf(nodes, t) {
  // ⚠ Evidence must come from what the region OWNS. Judging by the whole
  // subtree labelled the root of /rendelesek "fülsor + fültartalom" — true of
  // something 4 levels down, useless as a description of the page.
  const claimed = new Set()
  for (const c of t.children) for (const member of c.members ?? [c.node.i]) for (const i of subtree(nodes, member)) claimed.add(i)
  const own = [...subtree(nodes, t.node.i)].filter((i) => !claimed.has(i)).map((i) => nodes[i])
  const n = t.node

  if (t.repeat) return `ismétlődő elem ×${t.repeat}`
  if (own.some((x) => x.role === "tablist")) return "fülsor + fültartalom"
  if (n.tag === "table" || own.filter((x) => x.tag === "tr").length > 3) return `táblázat (${own.filter((x) => x.tag === "tr").length} sor)`
  if (n.tag === "nav" || own.filter((x) => x.tag === "a").length >= 5) return "navigáció"
  if (own.filter((x) => x.tag === "input" || x.tag === "select" || x.tag === "textarea").length >= 3) return "űrlap"
  if (isScroller(n)) return "görgethető lista"
  if (n.h <= 80 && n.w > 400) return "eszköztár-sáv"
  return "panel"
}

const scrollNote = (n) => (isScroller(n) ? ` ⇅ ${n.sh}px tartalom ${n.ch}px keretben` : "")

/** Controls a region owns directly — not those its child regions own. */
function ownControls(nodes, t) {
  const childIds = new Set()
  for (const c of t.children) for (const member of c.members ?? [c.node.i]) for (const i of subtree(nodes, member)) childIds.add(i)
  return controlsIn(nodes, subtree(nodes, t.node.i)).filter((n) => !childIds.has(n.i))
}

/** Collapse identical adjacent labels — 257 order rows are one line, announced. */
function collapse(list) {
  const out = []
  for (const item of list) {
    const last = out[out.length - 1]
    if (last && last.text === item) last.count++
    else out.push({ text: item, count: 1 })
  }
  return out.map((e) => (e.count > 1 ? `${e.text}   (× ${e.count})` : e.text))
}

/* ───────────────────────────── S0 · aria-flat ───────────────────────── */
// What set-atlas ships today: the raw accessibility tree, compressed.

export function ariaFlat({ aria }) {
  return "```yaml\n" + compress(aria).text + "\n```"
}

/* ───────────────────────────── S1 · geo-tree ────────────────────────── */
// The same tree, with a box on every line. Tests whether raw numbers are
// enough — whether a reader can assemble a layout from coordinates alone.

const MAX_DEPTH = 16

export function geoTree({ nodes, meta }) {
  const lines = [`# ${meta.title} — ${meta.url}`, `látómező ${meta.viewport.w}×${meta.viewport.h}, oldalmagasság ${meta.pageHeight}`, ""]
  let truncated = 0
  const walk = (i, depth) => {
    // ⚠ A silent depth cap of 8 cut the ENTIRE partner dropdown out of
    // /ajanlatok/new — 331 controls, the whole point of that screen — and the
    // file looked complete at 48 lines. Announce what the cap eats.
    if (depth > MAX_DEPTH) {
      truncated++
      return
    }
    const n = nodes[i]
    if (n.w === 0 || n.h === 0 || n.vis === "hidden") return
    const interesting = isControl(n) || n.role || n.w * n.h >= 12000
    if (interesting) lines.push(`${"  ".repeat(depth)}${label(n)} [${n.x},${n.y} ${n.w}×${n.h}]${scrollNote(n)}`)
    const next = interesting ? depth + 1 : depth
    // Emit one representative per repeated shape, with its count. Without this
    // the variant printed all 331 partner rows and all 124 ledger rows and cost
    // 42.7k tokens against the others' 4.5k — which would have measured how much
    // DATA each arm carries, not how well each encodes STRUCTURE.
    const seen = new Map()
    for (const c of childrenOf(nodes, i)) {
      const key = shapeKey(nodes, c)
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    const done = new Set()
    for (const c of childrenOf(nodes, i)) {
      const key = shapeKey(nodes, c)
      const count = seen.get(key)
      if (count >= 3) {
        if (done.has(key)) continue
        done.add(key)
        const before = lines.length
        walk(c.i, next)
        if (lines.length > before) lines[before] += `   (× ${count} ilyen)`
        continue
      }
      walk(c.i, next)
    }
  }
  walk(0, 0)
  if (truncated) lines.push(`⚠ ${truncated} részfa levágva a ${MAX_DEPTH}. szint alatt`)
  // Repeated siblings would make this the longest variant by far; collapse them
  // the same way every other variant does, so the comparison is about structure.
  return lines.slice(0, 3).concat(collapse(lines.slice(3))).join("\n")
}

/* ──────────────────────────── S2 · wireframe ────────────────────────── */
// A drawn box diagram — the most direct attempt at "make the model see it".

const GRID_W = 78
const GRID_H = 30

export function wireframe(capture) {
  const { nodes, meta } = capture
  const tree = regionTree(nodes)
  const vp = meta.viewport
  const pageH = Math.max(meta.pageHeight, vp.h)

  const grid = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(" "))
  const put = (x, y, ch) => {
    if (y >= 0 && y < GRID_H && x >= 0 && x < GRID_W) grid[y][x] = ch
  }

  const boxes = []
  const draw = (t, depth) => {
    // ⚠ A cap of 3 stopped exactly one level above the three columns of
    // /rendelesek — the wireframe's whole reason to exist drew as one empty box.
    if (depth > 5) return
    const n = t.node
    const x0 = Math.round((n.x / vp.w) * GRID_W)
    const x1 = Math.max(x0 + 2, Math.round(((n.x + n.w) / vp.w) * GRID_W) - 1)
    const y0 = Math.round((n.y / pageH) * GRID_H)
    const y1 = Math.max(y0 + 1, Math.round(((n.y + n.h) / pageH) * GRID_H) - 1)

    for (let x = x0; x <= x1; x++) {
      put(x, y0, "─")
      put(x, y1, "─")
    }
    for (let y = y0; y <= y1; y++) {
      put(x0, y, "│")
      put(x1, y, "│")
    }
    put(x0, y0, "┌")
    put(x1, y0, "┐")
    put(x0, y1, "└")
    put(x1, y1, "┘")

    if (x1 - x0 < 2 || y1 - y0 < 1) return
    const tag = `${boxes.length + 1}`
    boxes.push({ tag, t, depth })
    for (let k = 0; k < tag.length && x0 + 1 + k < x1; k++) put(x0 + 1 + k, y0, tag[k])

    t.children.forEach((c) => draw(c, depth + 1))
  }
  draw(tree, 0)

  const legend = boxes.map(({ tag, t, depth }) => {
    const n = t.node
    const controls = ownControls(nodes, t)
    return (
      `${"  ".repeat(depth)}[${tag}] ${roleOf(nodes, t)} — ${n.w}×${n.h} @ ${n.x},${n.y}` +
      `${t.overlay ? " ⬒ a többi fölé rajzolva" : ""}${scrollNote(n)}` +
      (controls.length ? "\n" + collapse(controls.map((c) => `${"  ".repeat(depth)}    · ${label(c)}`)).join("\n") : "")
    )
  })

  return [
    `# ${meta.title} — ${meta.url}`,
    `A rajz a ${vp.w}×${vp.h} látómezőt mutatja${pageH > vp.h ? `, a ${pageH}px teljes oldalmagasságra arányosítva` : ""}.`,
    "",
    "```",
    grid.map((row) => row.join("").trimEnd()).join("\n"),
    "```",
    "",
    "## A dobozok",
    "",
    ...legend,
  ].join("\n")
}

/* ─────────────────────────── S3 · region-tree ───────────────────────── */
// The region hierarchy in words, with NO coordinates: does a reader need the
// numbers, or only the containment and the order?

export function regionTreeText(capture) {
  return regionTreeMarked(capture).text
}

/**
 * The same tree, optionally numbered — and the boxes those numbers refer to.
 *
 * The numbers exist so a picture can carry the SAME ones (`build-hybrid.mjs`
 * draws them onto the screenshot). Emitting both from one walk is the point: a
 * key whose numbering is computed twice is a key that can disagree with itself.
 */
export function regionTreeMarked(capture, { numbered = false } = {}) {
  const { nodes, meta } = capture
  const tree = regionTree(nodes)
  const lines = [`# ${meta.title} — ${meta.url}`, ""]
  const marks = []

  const walk = (t, depth) => {
    const n = t.node
    const side = depth === 0 ? "" : ` [${n.w}×${n.h}]`
    marks.push({ n: marks.length + 1, depth, x: n.x, y: n.y, w: n.w, h: n.h })
    const tag = numbered ? `[${marks.length}] ` : ""
    lines.push(
      `${"  ".repeat(depth)}▸ ${tag}${roleOf(nodes, t)}${side}` +
        `${t.overlay ? " — a mögötte lévő tartalom fölé nyílik" : ""}` +
        `${t.inset ? ` — ${t.inset.inner}px széles sáv a ${t.inset.outer}px területen, középre` : ""}` +
        `${scrollNote(n)}` +
        `${t.escaped ? ` — ⚠ további ${t.escaped} kontroll ezen a kereten kívül` : ""}`
    )
    for (const line of collapse(ownControls(nodes, t).map((c) => `${"  ".repeat(depth)}  · ${label(c)}`))) lines.push(line)
    t.children.forEach((c) => walk(c, depth + 1))
  }
  walk(tree, 0)
  return { text: lines.join("\n"), marks }
}

/* ──────────────────────────── S6 · hybrid ───────────────────────────── */
// The picture and the text, carrying the same numbers.
//
// Its text is S3 with `[n]` on every region, so the contrast against S3 is
// exactly ONE thing: the annotated screenshot. The image itself is written by
// `build-hybrid.mjs`; this side only has to number the regions identically.
//
// ⚠ The picture does not replace the text and is not allowed to: it is neither
// greppable nor diffable, so `--check`, the cross-section and the change
// promise all stay textual. It is measured as an ADDITION, never a substitute.

export function hybridText(capture) {
  const { text, marks } = regionTreeMarked(capture, { numbered: true })
  const vp = capture.meta.viewport
  // The corpus screenshot is viewport-only (`page.screenshot()` with no
  // fullPage), so a region that starts below the fold has a number in this list
  // and no box in the picture. Saying which ones is not optional — a reader who
  // cannot find [23] must know it is missing, not assume they misread the image.
  const offscreen = marks.filter((m) => m.y >= vp.h || m.x >= vp.w)
  const head = [
    text.split("\n")[0],
    "",
    `A számok a mellékelt annotált képernyőképen bekeretezett dobozokat jelölik — ugyanaz a szám, ugyanaz a doboz.`,
    offscreen.length
      ? `⚠ A kép a ${vp.w}×${vp.h} látómezőt mutatja, ezért ${offscreen.length} régió (${offscreen.map((m) => `[${m.n}]`).join(", ")}) nem látszik rajta; azokról csak ez a lista szól.`
      : `A kép a teljes ${vp.w}×${vp.h} látómezőt mutatja, minden felsorolt régió szerepel rajta.`,
  ].join("\n")
  return [head, ...text.split("\n").slice(1)].join("\n")
}

/* ───────────────────────────── S5 · jsx-dsl ─────────────────────────── */
// The user's question: does a code-shaped description help, or does a model
// pattern-match on JSX it has seen and hallucinate the rest?

export function jsxDsl(capture) {
  const { nodes, meta } = capture
  const tree = regionTree(nodes)

  const emit = (t, depth) => {
    const pad = "  ".repeat(depth)
    const n = t.node
    const props = [`w={${n.w}} h={${n.h}}`]
    if (n.dsp.includes("flex")) props.push(`layout="${n.fd === "row" ? "sorban" : "oszlopban"}"`)
    else if (n.dsp === "grid") props.push(`layout="rács"`)
    if (isScroller(n)) props.push(`scroll={{ látszik: ${n.ch}, tartalom: ${n.sh} }}`)
    if (t.overlay) props.push("overlay")
    if (t.repeat) props.push(`ismétlődik={${t.repeat}}`)

    const name = roleOf(nodes, t)
      .replace(/[^\p{L}\d]+(.)?/gu, (_, c) => (c ? c.toUpperCase() : ""))
      .replace(/^./, (c) => c.toUpperCase())
    const controls = collapse(ownControls(nodes, t).map((c) => `${pad}  <${kind(c)}>${(c.name || c.testid || "").slice(0, 40)}</${kind(c)}>`))
    const kids = t.children.map((c) => emit(c, depth + 1))
    const body = [...controls, ...kids].join("\n")
    return body ? `${pad}<${name} ${props.join(" ")}>\n${body}\n${pad}</${name}>` : `${pad}<${name} ${props.join(" ")} />`
  }

  return [`// ${meta.title} — ${meta.url}`, `// látómező ${meta.viewport.w}×${meta.viewport.h}`, "", "```jsx", emit(tree, 0), "```"].join("\n")
}

export const VARIANTS = {
  "aria-flat": { label: "S0 · mai lapos aria-dump (kontroll)", build: ariaFlat, deterministic: true },
  "geo-tree": { label: "S1 · geometria-annotált fa", build: geoTree, deterministic: true },
  wireframe: { label: "S2 · ASCII wireframe + régiónkénti lista", build: wireframe, deterministic: true },
  "region-tree": { label: "S3 · régió-fa szerepcímkékkel, koordináták nélkül", build: regionTreeText, deterministic: true },
  "jsx-dsl": { label: "S5 · JSX-szerű layout-DSL", build: jsxDsl, deterministic: true },
  hybrid: { label: "S6 · számozott régió-fa + annotált képernyőkép", build: hybridText, deterministic: true, image: true },
}
