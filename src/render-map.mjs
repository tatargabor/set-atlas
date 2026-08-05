// The map renderer — a recorded screen becomes the text an agent designs on.
//
// Measured 2026-08-04 against five other shapes on six layout archetypes, blind
// (docs/kutatas/2026-08-04-vizualis-megertes.md): 44/46 on 4,480 tokens, versus
// 40/46 on 9,081 for the flat aria dump, and 43/46 for the screenshot itself.
//
// Two results decided this format:
//
//   Coordinates are NOISE. An arm that printed `[x,y w×h]` on every element
//   scored WORSE (42/46) and cost 51% more. What a reader uses is containment
//   and size; the absolute position of a button adds nothing it can act on.
//
//   Scroll depth is the fact nothing else carries. a measured screen held 18,866px
//   of list in a 318px frame. The aria dump cannot say it, and the screenshot
//   cannot show it — the picture guessed "3–15×" against a real 59×.

import { regionTree, subtree, controlsIn, isScroller } from "./regions.mjs"
import { isRecordName, redactName, RECORD_PLACEHOLDER } from "./compress.mjs"

const CONTROL_TAGS = new Set(["button", "a", "input", "textarea", "select"])
const CONTROL_ROLES = new Set(["button", "link", "tab", "checkbox", "radio", "switch", "menuitem", "option", "combobox", "textbox"])

const kindOf = (n) => {
  if (n.role) return n.role
  if (n.tag === "a") return "link"
  if (n.tag === "select") return "combobox"
  if (n.tag === "input" || n.tag === "textarea") return "textbox"
  return n.tag
}

/**
 * ⚠ Runs every DOM-sourced name through the SAME redaction the aria path uses.
 * The research harness skipped this and its output held 300+ lines of live
 * customer names — the very leak the rule was written for, reintroduced by a
 * second renderer that forgot about it.
 */
function labelFor(node, place = "", dataPatterns = []) {
  const name = (node.name || "").replace(/\s+/g, " ").trim()
  const kind = kindOf(node)
  const flags = [place, node.dis ? "disabled" : "", node.sel ? "selected" : ""].filter(Boolean)
  const suffix = flags.length ? ` [${flags.join("] [")}]` : ""
  if (!name) return (node.testid ? `${kind} #${node.testid}` : kind) + suffix
  const shown = redactName(name, dataPatterns).slice(0, 60)
  return `${kind} "${shown}"${suffix}`
}

/**
 * Where each control sits ACROSS its region — the one thing every format missed.
 *
 * ⚠ Measured: on one screen all six formats, the screenshot included, answered
 * "top-left" for a search box that sits at x=1392 in a full-width filter bar.
 * Reading order says nothing about which end of a bar something is on, and
 * "actions are on the right" is how the placement decision actually gets made.
 *
 * Left is the default and carries no marker, so a plain vertical column costs
 * nothing. Only a bar whose controls genuinely span it gets annotated.
 */
function placements(region, controls) {
  const blank = new Map()
  if (controls.length < 2) return blank
  const left = Math.min(...controls.map((c) => c.x))
  const right = Math.max(...controls.map((c) => c.x + c.w))
  // Controls clustered in one place are not "spread across" anything.
  if (right - left < 0.5 * region.w) return blank

  const out = new Map()
  for (const c of controls) {
    const share = (c.x + c.w / 2 - left) / (right - left)
    out.set(c.i, share > 0.66 ? "right" : share > 0.33 ? "centre" : "")
  }
  return out
}

/**
 * Which way the region lays its contents out.
 *
 * The boxes already say WHERE things are; this says what will happen to them —
 * a row pushes its next child sideways, a column pushes it down. It is one word
 * and it is the difference between "add a button here" landing beside the others
 * or under them.
 */
function flowFor(node, childCount) {
  if (childCount < 2) return ""
  if (node.dsp === "grid" || node.dsp === "inline-grid") return "grid"
  if (node.dsp.includes("flex")) return node.fd === "column" || node.fd === "column-reverse" ? "column" : "row"
  return "" // block flow is the default everyone already assumes: stacked
}

/**
 * What a region IS, argued only from what it directly owns.
 *
 * ⚠ Judging by the whole subtree labelled a page root "tab bar" —
 * true of something four levels down, useless as a description of the page.
 */
function roleFor(nodes, tree, owned) {
  const node = tree.node
  if (tree.repeat) return `repeated item ×${tree.repeat}`
  // A header row is a column legend, not a row of data. `rowsBelow` never counted
  // it — a header does not join a repeated run — so on a big table the field meant
  // data rows, while here it meant every `tr` and came out one too high.
  const ownRows = owned.filter((n) => n.tag === "tr" && !inHeader(nodes, n)).length
  const isTable = node.tag === "table" || node.role === "table" || node.role === "grid"
  // A table's rows usually become repeated child regions, which puts them OUTSIDE
  // what the region directly owns — so counting only `owned` reported zero over a
  // full table. Fall back to the repeated run below it, which is measured to be
  // exact (257, 25, 25 and 6 rows on four real screens). Restricted to elements
  // that are actually tables: any container with four repeated children would
  // otherwise start calling itself one.
  const rows = ownRows || (isTable ? rowsBelow(tree) : 0)
  // No number beats a wrong number. A stated `0 rows` cannot be told apart from a
  // genuinely empty table, and it is the field a reader is most likely to trust.
  if (isTable || rows > 3) return rows ? `table (${rows} rows)` : "table"
  if (owned.some((n) => n.role === "tablist")) return "tab bar + panel"
  if (node.tag === "nav" || owned.filter((n) => n.tag === "a").length >= 5) return "navigation"
  if (owned.filter((n) => n.tag === "input" || n.tag === "select" || n.tag === "textarea").length >= 3) return "form"
  if (isScroller(node) || tree.scroll) return "scrollable list"
  // ⚠ `h ≤ 80 && w > 400` alone called any short wide box a toolbar. Censused
  // across 33 real screens: 80 of 198 "toolbar strip" regions (40%) held no
  // control at all. A toolbar is defined by having tools.
  if (node.h <= 80 && node.w > 400 && owned.some(isControl)) return "toolbar strip"
  return "panel"
}

const isControl = (n) => CONTROL_TAGS.has(n.tag) || CONTROL_ROLES.has(n.role)

/** Walks up to the owning `table` to see whether this row sits in its header. */
function inHeader(nodes, row) {
  for (let p = row.p; p >= 0; p = nodes[p].p) {
    if (nodes[p].tag === "thead") return true
    if (nodes[p].tag === "table") return false
  }
  return false
}

/**
 * How many rows sit below this region, counted from the repeated runs.
 *
 * ⚠ Rows do NOT arrive as one run. Measured on a real bug tracker: 58 table rows split into
 * runs of 11, 44 and 3, because rows that differ structurally do not collapse together. The
 * first version took the LARGEST run and printed 44 — and 44 happened to be a real number on
 * that screen (the count of one status), with a plausible row height to match. Two signals
 * agreeing is not corroboration when both come from the same blind spot.
 *
 * The largest run decides what a row IS here, and every run of that same element adds up.
 * Without the tag check an eleven-column table counts its `col` elements as rows.
 */
function rowsBelow(tree) {
  const runs = []
  const collect = t => { for (const c of t.children) { if (c.repeat) runs.push(c); collect(c) } }
  collect(tree)
  if (!runs.length) return 0
  const widest = runs.reduce((a, b) => (b.repeat > a.repeat ? b : a))
  return runs.filter(r => r.node.tag === widest.node.tag).reduce((sum, r) => sum + r.repeat, 0)
}

/**
 * The region's own title, if it has one.
 *
 * ⚠ The first region map shipped without this and dropped EVERY heading —
 * its section titles.
 * The flat map it replaced had carried them, so the new format was a regression
 * on exactly the words a designer needs to say where something goes. Censused:
 * 74 of 590 regions (12%) carry a heading that was going in the bin.
 */
function titleFor(owned, dataPatterns = []) {
  const heading = owned.filter((n) => /^h[1-6]$/.test(n.tag) && n.name).sort((a, b) => a.y - b.y || a.tag.localeCompare(b.tag))[0]
  if (!heading) return ""
  const text = heading.name.replace(/\s+/g, " ").trim()
  return redactName(text, dataPatterns).slice(0, 60)
}

/** Controls this region owns — not the ones its child regions own. */
function ownControls(nodes, tree) {
  const claimed = new Set()
  for (const child of tree.children) {
    for (const member of child.members ?? [child.node.i]) {
      for (const i of subtree(nodes, member)) claimed.add(i)
    }
  }
  return controlsIn(nodes, subtree(nodes, tree.node.i)).filter((n) => !claimed.has(n.i))
}

function ownNodes(nodes, tree) {
  const claimed = new Set()
  for (const child of tree.children) {
    for (const member of child.members ?? [child.node.i]) {
      for (const i of subtree(nodes, member)) claimed.add(i)
    }
  }
  return [...subtree(nodes, tree.node.i)].filter((i) => !claimed.has(i)).map((i) => nodes[i])
}

/** Identical adjacent lines collapse, and the count is always stated. */
function collapse(lines) {
  const out = []
  for (const line of lines) {
    const last = out[out.length - 1]
    if (last && last.text === line) last.count++
    else out.push({ text: line, count: 1 })
  }
  return out.map((e) => (e.count > 1 ? `${e.text}   (× ${e.count})` : e.text))
}

/**
 * @param {Array} nodes  the recorded element tree (see capture.mjs extractNodes)
 * @returns {{ text: string, regions: number, controls: number }}
 */
export function renderMap(nodes, { visual = true, dataPatterns = [] } = {}) {
  if (!nodes?.length) return { text: "", regions: 0, controls: 0 }

  const tree = regionTree(nodes)
  const lines = []
  const controlList = []
  let regions = 0
  let controls = 0

  const walk = (t, depth, inRepeat = false) => {
    regions++
    // Once inside a repeated run, everything below it belongs to a RECORD: a link on a
    // table row points at that row's record, not at a function the screen offers.
    const repeated = inRepeat || !!t.repeat
    const pad = "  ".repeat(depth)
    const node = t.node
    const owned = ownNodes(nodes, t)

    const notes = []
    if (t.overlay) notes.push("overlay — drawn over the content behind it")
    if (t.inset) notes.push(`${t.inset.inner}px wide, centred in ${t.inset.outer}px`)
    // The scroller may be a wrapper the walk stepped through — the fact is the
    // region's either way, and it is the one fact nothing else carries.
    const scroller = t.scroll ?? (isScroller(node) ? node : null)
    if (scroller) notes.push(`⇅ ${scroller.sh}px of content in a ${scroller.ch}px frame`)
    // Every omission announced — the failure class this tool exists to catch.
    if (t.escaped) notes.push(`⚠ ${t.escaped} more controls outside this frame`)
    if (t.depthCapped) notes.push("⚠ nesting below this level not mapped")

    const own = ownControls(nodes, t)
    const title = titleFor(owned, dataPatterns)

    // ⚠ A region with no controls, no title, no children and nothing to warn
    // about says only "a box exists here". Censused: 25 of 590 regions were
    // exactly that — a line each, paid for and read for nothing. Its children,
    // if it had any, are still walked; only the empty line goes.
    const worthPrinting = own.length || title || t.children.length || notes.length
    if (!worthPrinting) {
      regions--
      for (const child of t.children) walk(child, depth, repeated)
      return
    }

    const flow = visual ? flowFor(node, t.children.length + own.length) : ""
    // How much of this region a test or a recorded walkthrough can hold on to.
    // ⚠ The COUNT, never the ids. A list of test ids reads as "you can write E2E
    // from this map", and the atlas cannot promise the thing that claim needs:
    // that an id is unique. Measured in the consumer app the same week — `sku-`
    // stopped being unique when a shared combobox started emitting `sku-copy-<id>`,
    // and a prefix match silently drove the wrong element. The ids stay the
    // source's business; what the map adds is that the gap is now visible.
    const anchored = own.length ? ` · ${own.filter((c) => c.testid).length}/${own.length} anchored` : ""
    lines.push(
      `${pad}- ${roleFor(nodes, t, owned)}${node.testid ? ` #${node.testid}` : ""}${title ? ` "${title}"` : ""} [${node.w}×${node.h}${flow ? ` ${flow}` : ""}]${anchored}` +
        `${notes.length ? " — " + notes.join(" · ") : ""}`
    )
    controls += own.length
    // The same controls the page prints, kept as data for the cross-screen files.
    // Redacted names only: a record name is not an interface label anywhere.
    if (!repeated)
      for (const c of own) {
        const name = (c.name || "").replace(/\s+/g, " ").trim()
        // A name with no letter in it is a row number or a bullet, never an action.
        const shown = redactName(name, dataPatterns)
        // A label that is nothing but a record names no action — but one with an action
        // left around it does, and that is what the cross-section is for.
        if (name && /\p{L}/u.test(name) && shown !== RECORD_PLACEHOLDER)
          controlList.push({ kind: kindOf(c), name: shown.slice(0, 60), href: c.href || "" })
      }
    const place = visual ? placements(node, own) : new Map()
    for (const line of collapse(own.map((c) => `${pad}  - ${labelFor(c, place.get(c.i) ?? "", dataPatterns)}`))) lines.push(line)

    for (const child of t.children) walk(child, depth + 1, repeated)
  }

  walk(tree, 0)
  return { text: lines.join("\n"), regions, controls, controlList }
}

/**
 * Runs in the page. Records what a screenshot shows and the accessibility tree
 * does not: position, size, stacking and scroll.
 *
 * ⚠ Must stay a standalone function — `page.evaluate` serialises it, so it can
 * close over nothing.
 */
export function extractNodes() {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE"])
  const MAX_NODES = 30000
  const out = []

  const accName = (el) => {
    const label = el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("placeholder") || el.getAttribute("title")
    if (label) return label.trim().slice(0, 120)
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
      // Where a link GOES. It is deliberately not printed on the screen page —
      // it would cost tokens on every one of them to answer a question nobody
      // asks about a single screen. It answers a cross-screen one: which screens
      // reach which, and which screen nothing reaches.
      href: el.tagName === "A" ? (el.getAttribute("href") || "") : "",
      // Whole pixels — sub-pixel noise would make every diff a false positive.
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      sh: el.scrollHeight,
      ch: el.clientHeight,
      sw: el.scrollWidth,
      cw: el.clientWidth,
      dsp: cs.display,
      fd: cs.flexDirection,
      pos: cs.position,
      ovx: cs.overflowX,
      ovy: cs.overflowY,
      vis: cs.visibility,
      op: cs.opacity,
      dis: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      sel: el.getAttribute("aria-selected") === "true" || el.getAttribute("data-state") === "active",
    })

    for (const child of el.children) walk(child, i, depth + 1)
  }

  walk(document.body, -1, 0)
  return { nodes: out, truncated: out.length >= MAX_NODES, viewport: { w: window.innerWidth, h: window.innerHeight } }
}
