// Layout-region reconstruction from geometry.
//
// Measured 2026-08-04 (docs/kutatas/2026-08-04-vizualis-megertes.md): a map in
// this shape answered 44 of 46 blind layout questions on 4,480 tokens, against
// 40/46 on 9,081 for the flat aria dump it replaces — and beat the screenshot.
//
// The accessibility tree has no role for "the middle column". That is not a bug
// in ARIA — a column carries no semantics for a screen reader, it is a visual
// fact. But it is exactly the fact a designer needs: "is the Approve button in
// the same pane as the field it approves?" So we recover it from boxes.
//
// The rule: a node SPLITS when two or more of its visible children occupy
// mutually disjoint boxes. Everything else is a wrapper and gets unwrapped —
// a Tailwind app nests eight divs to draw one panel, and naming all eight
// would bury the one that matters.

/** Below this the box is a control or a label, not a layout region. */
const MIN_REGION_AREA = 12000 // px², ≈ 150×80
// A top bar is 1536×56 — wide and short. An earlier version required 60px on
// BOTH sides and so dropped every header, which made its parent look like a
// single-child wrapper: the whole page collapsed to two regions.
const MIN_REGION_W = 40
const MIN_REGION_H = 24

const area = (n) => n.w * n.h
const visible = (n) => n.w > 0 && n.h > 0 && n.vis !== "hidden" && n.op !== "0"

const overlap = (a, b) => {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return ox > 0 && oy > 0 ? ox * oy : 0
}

export function childrenOf(nodes, i) {
  return nodes.filter((n) => n.p === i)
}

const isRegionSized = (k) => visible(k) && area(k) >= MIN_REGION_AREA && k.w >= MIN_REGION_W && k.h >= MIN_REGION_H

/**
 * An overlay is a dropdown, popover or modal: it is lifted out of the flow and
 * painted ON TOP of a sibling rather than beside it.
 *
 * ⚠ Treating overlap as "this parent does not split" silently destroyed
 * /ajanlatok/new: its partner dropdown covers the card below it, so the entire
 * page — 334 controls — stayed one undifferentiated region. An overlay is a
 * layout fact of its own and must be NAMED, not used as a reason to give up.
 */
function partitionOverlays(kids) {
  const big = kids.filter(isRegionSized)
  const lifted = new Set()

  for (let a = 0; a < big.length; a++) {
    for (let b = a + 1; b < big.length; b++) {
      const ov = overlap(big[a], big[b])
      if (ov <= 0.5 * Math.min(area(big[a]), area(big[b]))) continue
      // Whichever is lifted out of the flow is the overlay; if neither is,
      // the later sibling paints on top.
      const outOfFlow = (n) => n.pos === "absolute" || n.pos === "fixed"
      lifted.add(outOfFlow(big[b]) || !outOfFlow(big[a]) ? big[b] : big[a])
    }
  }

  return { flow: big.filter((k) => !lifted.has(k)), overlays: big.filter((k) => lifted.has(k)) }
}

/**
 * Walks down from `start`, skipping wrappers, and returns the region tree.
 * @returns {{node, children: []}}
 */
// ⚠ 5 was too shallow: on /ajanlatok/new the partner dropdown sits at level 6,
// so the region walk stopped above it and its 331 rows spilled into an ancestor
// as loose controls — 6,345 tokens of list pretending to be interface.
export function regionTree(nodes, start = 0, depth = 0, maxDepth = 8) {
  const node = nodes[start]
  let current = start

  // Unwrap: descend through single-significant-child chains.
  //
  // ⚠ An earlier version stopped unwrapping when the child did not FILL the
  // parent, on the theory that a partly-filled parent is a region in its own
  // right. On /ajanlatok/new that stopped the walk dead: the page is a 672px
  // column centred in 1536px, so the whole form — 334 controls, including a
  // dropdown holding 18,866px of scrollable content — stayed one opaque region.
  // A lone region-sized child means the parent is margin. What the parent DOES
  // contribute is the centring, so record it instead of stopping on it.
  // ⚠ …and unwrapping unconditionally is just as wrong in the other direction:
  // it turned the 63×895 icon rail into the 47×392 `ul` inside it and the header
  // into its own search button, because in each case one child happened to be
  // the only region-SIZED one while smaller siblings still held real controls.
  // The test is not size but whether the child takes ALL the parent's controls.
  // Requiring ALL of them was one control too strict: two live outside the app
  // container on every screen (the floating assistant button and the toast
  // region), so the walk never started and every page rendered as bare <body>.
  const KEEPS_CONTROLS = 0.9
  const controls = controlCounts(nodes)
  let inset = null
  let scroll = null
  for (;;) {
    // ⚠ The scroll fact — 18,866px of content in a 318px frame — belongs to the
    // box that scrolls, and unwrapping past it threw away the one thing neither
    // the aria dump nor a screenshot can express. But REFUSING to unwrap there
    // was worse: a scrolling table then had no children at all, so its 104 rows
    // never reached the repeat collapse and all 104 printed individually —
    // docs/atlas/szamlak.md went 469 → 3,092 tokens. Carry the fact forward and
    // keep walking.
    if (!scroll && isScroller(nodes[current])) scroll = nodes[current]
    const kids = childrenOf(nodes, current).filter((k) => visible(k) && area(k) >= MIN_REGION_AREA)
    if (kids.length !== 1) break
    if (controls[kids[0].i] < KEEPS_CONTROLS * controls[current]) break
    if (kids[0].w < 0.75 * nodes[current].w) inset = { outer: nodes[current].w, inner: kids[0].w }
    current = kids[0].i
  }

  // What unwrapping left behind. A floating action button that sits outside the
  // page container is still on the screen; dropping it silently is the exact
  // failure this project exists to catch.
  const escaped = controls[start] - controls[current]
  const result = { node: nodes[current], entry: node, inset, escaped, scroll, children: [] }
  if (depth >= maxDepth) {
    result.depthCapped = true
    return result
  }

  const { flow, overlays } = partitionOverlays(childrenOf(nodes, current))
  if (flow.length + overlays.length < 2) return result

  const order = (a, b) => a.y - b.y || a.x - b.x
  const descend = (group, extra) =>
    group.length === 1
      ? { ...regionTree(nodes, group[0].i, depth + 1, maxDepth), ...extra }
      : // A collapsed list must claim ALL its rows, not just the one it shows.
        // Claiming only the first left the other 256 order rows "owned" by the
        // parent region, which then printed every one of them — the collapse
        // saved nothing and the three columns were buried a second time.
        { node: group[0], entry: group[0], children: [], repeat: group.length, members: group.map((g) => g.i), ...extra }

  result.children = [
    ...collapseRepeats(nodes, [...flow].sort(order)).map((g) => descend(g, {})),
    ...[...overlays].sort(order).map((o) => descend([o], { overlay: true })),
  ]
  return result
}

/**
 * A 209-row order list is ONE region — a list — not 209 regions.
 *
 * Without this the region tree of /rendelesek was 209 sibling boxes deep and the
 * three columns it exists to show were buried under them.
 *
 * ⚠ Width + tag alone is NOT enough. On /rendelesek the four stacked bars
 * (category tabs, filters, toolbar, content) are all `div` and all 1536 wide, so
 * a width-only rule folded the entire page into one phantom "×4 list" and the
 * three columns disappeared again — the same failure, one level up. What
 * separates a list row from a layout bar is what it CONTAINS, so the key is the
 * child-tag sequence plus the test-id prefix.
 */
const REPEAT_MIN = 3

/** `email-be8ba87c-…` and `email-70d17dee-…` are one list; the id is the record. */
const testidPrefix = (id) => id.replace(/[0-9a-f]{8}-[0-9a-f-]{20,}|\d+$/i, "*")

export function shapeKey(nodes, n) {
  // A test-id the app author wrote is a stronger signal than any heuristic:
  // `email-<uuid>` says "list row" outright.
  if (n.testid) return `${n.tag}|${testidPrefix(n.testid)}`
  const childTags = childrenOf(nodes, n.i)
    .map((c) => c.tag)
    .join(",")
  return `${n.tag}|${childTags}`
}

/**
 * Groups by shape across ALL siblings, not just adjacent runs.
 *
 * Adjacent-run grouping broke the order list into 40 fragments, because row
 * heights alternate 88/104/109/125 with the amount of text in them — and a
 * height tolerance loose enough to bridge that was loose enough to merge the
 * filter bar with the toolbar. Shape, not size, decides; a row that is a row
 * stays one whether or not its neighbour wraps to two lines.
 */
function collapseRepeats(nodes, siblings) {
  const byKey = new Map()
  for (const node of siblings) {
    const key = shapeKey(nodes, node)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(node)
  }

  // ⚠ Shape alone over-merges. On /penzugy three siblings share the key
  // `div|div` but measure 81px, 81px and 782px tall: two summary strips and the
  // entire content area below them. Folding those into one "×3 list" hid 267
  // controls. Members of a list must also be of one SIZE — 2× is the widest
  // ratio a wrapping row produces (measured: 88…125px on /rendelesek).
  const MAX_HEIGHT_RATIO = 2
  const buckets = []
  for (const group of byKey.values()) {
    for (const node of group) {
      const bucket = buckets.find(
        (b) => shapeKey(nodes, b[0]) === shapeKey(nodes, node) && Math.max(b[0].h, node.h) <= MAX_HEIGHT_RATIO * Math.min(b[0].h, node.h)
      )
      if (bucket) bucket.push(node)
      else buckets.push([node])
    }
  }

  const emitted = new Set()
  const out = []
  for (const node of siblings) {
    const bucket = buckets.find((b) => b.includes(node))
    // A pair is a two-column layout, not a list — only 3+ collapses.
    if (bucket.length < REPEAT_MIN) {
      out.push([node])
      continue
    }
    if (emitted.has(bucket)) continue
    emitted.add(bucket)
    out.push(bucket)
  }
  return out
}

/**
 * Controls per subtree, for every node, in one pass.
 *
 * The extractor walks preorder, so a parent's index is always lower than its
 * children's — accumulating from the end lets one backwards loop replace a
 * subtree walk per node (6,286 nodes on /rendelesek).
 */
const countCache = new WeakMap()
function controlCounts(nodes) {
  const cached = countCache.get(nodes)
  if (cached) return cached
  const counts = new Array(nodes.length).fill(0)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    if (visible(n) && (CONTROL_TAGS.has(n.tag) || CONTROL_ROLES.has(n.role))) counts[i]++
    if (n.p >= 0) counts[n.p] += counts[i]
  }
  countCache.set(nodes, counts)
  return counts
}

/** Every descendant index of `i`, itself included. */
export function subtree(nodes, i, out = new Set()) {
  out.add(i)
  for (const k of childrenOf(nodes, i)) subtree(nodes, k.i, out)
  return out
}

/** The interactive controls a region owns, in reading order. */
const CONTROL_TAGS = new Set(["button", "a", "input", "textarea", "select"])
const CONTROL_ROLES = new Set(["button", "link", "tab", "checkbox", "radio", "switch", "menuitem", "option", "combobox", "textbox"])

export function controlsIn(nodes, indices) {
  return [...indices]
    .map((i) => nodes[i])
    .filter((n) => visible(n) && (CONTROL_TAGS.has(n.tag) || CONTROL_ROLES.has(n.role)))
    .sort((a, b) => a.y - b.y || a.x - b.x)
}

/** Fully inside the first viewport — no scrolling, no clicking. */
export const inViewport = (n, vp) => n.y >= 0 && n.x >= 0 && n.y + n.h <= vp.h && n.x + n.w <= vp.w && visible(n)

/** A box that scrolls: its content is taller/wider than its frame. */
export const isScroller = (n) =>
  (n.sh > n.ch + 8 && (n.ovy === "auto" || n.ovy === "scroll")) || (n.sw > n.cw + 8 && (n.ovx === "auto" || n.ovx === "scroll"))
