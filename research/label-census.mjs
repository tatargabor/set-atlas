// Label census — how much of the map is the `panel` catch-all, and what is
// actually inside those panels.
//
// The point is not to invent nicer words. A label is only worth adding if the
// thing it names occurs often AND is distinguishable from evidence already in
// the recording — otherwise it is a guess wearing a vocabulary.
//
//   node research/label-census.mjs

import fs from "node:fs"
import path from "node:path"
import { regionTree, subtree, childrenOf } from "../src/regions.mjs"

const CORPUS = path.join(import.meta.dirname, "corpus")
const slugs = fs
  .readdirSync(CORPUS)
  .filter((d) => fs.existsSync(path.join(CORPUS, d, "nodes.json")))
  .sort()

const CONTROL_TAGS = new Set(["button", "a", "input", "textarea", "select"])
const CONTROL_ROLES = new Set(["button", "link", "tab", "checkbox", "radio", "switch", "menuitem", "option", "combobox", "textbox"])
const isControl = (n) => CONTROL_TAGS.has(n.tag) || CONTROL_ROLES.has(n.role)
const isScroller = (n) => (n.sh > n.ch + 8 && /auto|scroll/.test(n.ovy)) || (n.sw > n.cw + 8 && /auto|scroll/.test(n.ovx))

/** Mirrors src/render-map.mjs — kept in step by eye, not imported, so the census
 *  can ask questions the renderer does not (it wants the evidence, not the word). */
function ownNodes(nodes, t) {
  const claimed = new Set()
  for (const c of t.children) for (const m of c.members ?? [c.node.i]) for (const i of subtree(nodes, m)) claimed.add(i)
  return [...subtree(nodes, t.node.i)].filter((i) => !claimed.has(i)).map((i) => nodes[i])
}

function labelOf(t, owned) {
  const n = t.node
  if (t.repeat) return "repeated item"
  const rows = owned.filter((x) => x.tag === "tr").length
  if (n.tag === "table" || rows > 3) return "table"
  if (owned.some((x) => x.role === "tablist")) return "tab bar + panel"
  if (n.tag === "nav" || owned.filter((x) => x.tag === "a").length >= 5) return "navigation"
  if (owned.filter((x) => x.tag === "input" || x.tag === "select" || x.tag === "textarea").length >= 3) return "form"
  if (isScroller(n) || t.scroll) return "scrollable list"
  if (n.h <= 80 && n.w > 400) return "toolbar strip"
  return "panel"
}

const counts = new Map()
const panels = []
let total = 0

for (const slug of slugs) {
  const nodes = JSON.parse(fs.readFileSync(path.join(CORPUS, slug, "nodes.json"), "utf8"))
  const walk = (t, depth) => {
    total++
    const owned = ownNodes(nodes, t)
    const label = labelOf(t, owned)
    counts.set(label, (counts.get(label) ?? 0) + 1)

    if (label === "panel") {
      const n = t.node
      panels.push({
        slug,
        depth,
        w: n.w,
        h: n.h,
        controls: owned.filter(isControl).length,
        headings: owned.filter((x) => /^h[1-6]$/.test(x.tag)).length,
        headingText: owned.filter((x) => /^h[1-6]$/.test(x.tag)).map((x) => x.name)[0] ?? "",
        kids: t.children.length,
        // A card is a bordered/filled box; the app draws one per widget.
        rounded: parseFloat(n.br) >= 6,
        filled: n.bg && n.bg !== "rgba(0, 0, 0, 0)" && n.bg !== "transparent",
        tag: n.tag,
        role: n.role,
        testid: n.testid,
      })
    }
    for (const c of t.children) walk(c, depth + 1)
  }
  walk(regionTree(nodes), 0)
}

console.log(`${slugs.length} képernyő · ${total} régió\n`)
console.log("CÍMKE-ELOSZLÁS\n")
for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`${label.padEnd(18)} ${String(n).padStart(4)}  ${(((n / total) * 100) | 0).toString().padStart(3)}%  ${"█".repeat(Math.round((n / total) * 50))}`)
}

console.log(`\nA ${panels.length} NÉVTELEN PANEL — mi van bennük\n`)
const bucket = (p) => {
  if (p.headings > 0) return `címzett kártya ("${p.headingText.slice(0, 30)}")`
  if (p.controls === 0) return "nulla kontroll — tisztán megjelenítő"
  if (p.kids === 0 && p.controls <= 3) return "1–3 kontroll, nincs gyereke — csoport"
  if (p.kids >= 2) return `${p.kids} gyerek-régiót fog össze — konténer`
  return "egyéb"
}
const groups = new Map()
for (const p of panels) {
  const k = bucket(p).replace(/\(".*"\)/, "(címmel)")
  groups.set(k, (groups.get(k) ?? 0) + 1)
}
for (const [k, n] of [...groups].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(4)}  ${((n / panels.length) * 100) | 0}%  ${k}`)
}

console.log(`\nJELÖLTEK — mennyi panelt nevezne meg egy-egy új szabály\n`)
const withHeading = panels.filter((p) => p.headings > 0)
const cards = panels.filter((p) => p.rounded && p.filled && p.headings === 0)
const inert = panels.filter((p) => p.controls === 0 && p.headings === 0)
console.log(`címzett kártya (van benne heading) ........ ${withHeading.length}  (${((withHeading.length / panels.length) * 100) | 0}%)`)
console.log(`keretezett kártya (lekerekített + kitöltött, cím nélkül) . ${cards.length}`)
console.log(`inert régió (0 kontroll, 0 heading) ...... ${inert.length}`)

console.log(`\nPélda címek, amiket ma eldobunk:`)
for (const p of withHeading.slice(0, 12)) console.log(`  ${p.slug.padEnd(24)} "${p.headingText.slice(0, 45)}"`)

// ── Second pass: is a control-less region structure, or is it noise?
const empty = panels.filter((p) => p.controls === 0 && p.headings === 0)
const leafEmpty = empty.filter((p) => p.kids === 0)
console.log(`\nA KONTROLL NÉLKÜLI PANELEK — szerkezet vagy zaj?\n`)
console.log(`kontroll és cím nélkül, GYEREK NÉLKÜL (tiszta zaj) ... ${leafEmpty.length}`)
console.log(`kontroll nélkül, de gyereket fog össze (szerkezet) ... ${empty.length - leafEmpty.length}`)
console.log(`\nEz a ${leafEmpty.length} régió a 590-ből ${((leafEmpty.length / total) * 100) | 0}% — soronként kb. 1 sor, tisztán fizetett zaj.`)

// ── Is `toolbar strip` firing honestly at 33%?
const strips = []
for (const slug of slugs) {
  const nodes = JSON.parse(fs.readFileSync(path.join(CORPUS, slug, "nodes.json"), "utf8"))
  const walk = (t) => {
    const owned = ownNodes(nodes, t)
    if (labelOf(t, owned) === "toolbar strip") {
      strips.push({ slug, w: t.node.w, h: t.node.h, controls: owned.filter(isControl).length, kids: t.children.length })
    }
    t.children.forEach(walk)
  }
  walk(regionTree(nodes))
}
const stripNoControls = strips.filter((s) => s.controls === 0)
console.log(`\nA ${strips.length} "toolbar strip"-ből ${stripNoControls.length} (${((stripNoControls.length / strips.length) * 100) | 0}%) NEM tartalmaz kontrollt`)
console.log(`— vagyis nem eszköztár, csak egy alacsony, széles doboz. A szabály (h≤80 && w>400) túl tág.`)

// ── Do the mislabelled strips carry a heading? If so, one rule fixes both.
const stripsWithHeading = []
const allHeadings = new Map()
for (const slug of slugs) {
  const nodes = JSON.parse(fs.readFileSync(path.join(CORPUS, slug, "nodes.json"), "utf8"))
  const walk = (t) => {
    const owned = ownNodes(nodes, t)
    const label = labelOf(t, owned)
    const heads = owned.filter((x) => /^h[1-6]$/.test(x.tag) && x.name)
    if (heads.length) allHeadings.set(label, (allHeadings.get(label) ?? 0) + 1)
    if (label === "toolbar strip" && owned.filter(isControl).length === 0 && heads.length) {
      stripsWithHeading.push({ slug, text: heads[0].name })
    }
    t.children.forEach(walk)
  }
  walk(regionTree(nodes))
}
console.log(`\nA 80 kontroll nélküli "toolbar strip"-ből ${stripsWithHeading.length} tartalmaz CÍMET:`)
for (const s of stripsWithHeading.slice(0, 10)) console.log(`  ${s.slug.padEnd(22)} "${s.text.slice(0, 45)}"`)

console.log(`\nCÍMET TARTALMAZÓ RÉGIÓK címkénként (ma mind eldobja a címet):`)
for (const [label, n] of [...allHeadings].sort((a, b) => b[1] - a[1])) console.log(`  ${label.padEnd(18)} ${n}`)
const totalTitled = [...allHeadings.values()].reduce((a, b) => a + b, 0)
console.log(`\nÖsszesen ${totalTitled} régió (${((totalTitled / total) * 100) | 0}%) hordoz saját címet, amit ma nem írunk ki.`)
