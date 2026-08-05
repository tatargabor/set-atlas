import { test } from "node:test"
import assert from "node:assert/strict"
import { renderMap } from "../src/render-map.mjs"

/**
 * Builds the element tree `extractNodes` produces, with sane defaults so each
 * test only states the fact it is about.
 */
let next = 0
const node = (props) => ({
  i: next++,
  p: -1,
  d: 0,
  tag: "div",
  role: "",
  testid: "",
  name: "",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  sh: 100,
  ch: 100,
  sw: 100,
  cw: 100,
  dsp: "block",
  fd: "row",
  pos: "static",
  ovx: "visible",
  ovy: "visible",
  vis: "visible",
  op: "1",
  dis: false,
  sel: false,
  ...props,
})
const tree = (build) => {
  next = 0
  return build()
}

test("REGRESSION: a record name is redacted here too, not only in the aria map", () => {
  // Measured 2026-08-04: a picker page shipped ~340 lines of real
  // customer names and email addresses. The fix went into the aria compressor —
  // and the research renderer, which reads names from the DOM instead, promptly
  // leaked the same 300+ lines again because it did its own labelling. One
  // redaction rule, every renderer, or the leak comes back through the new door.
  const nodes = tree(() => {
    const root = node({ w: 1000, h: 800 })
    const left = node({ p: 0, x: 0, w: 480, h: 700, dsp: "flex" })
    const right = node({ p: 0, x: 500, w: 480, h: 700, dsp: "flex", fd: "column" })
    return [
      root,
      left,
      node({ p: 1, tag: "button", name: "Jane Doe jane.doe@example.com", w: 400, h: 40 }),
      right,
      node({ p: 3, tag: "input", name: "", w: 400, h: 40 }),
      node({ p: 3, tag: "button", name: "Save", w: 100, h: 40 }),
    ]
  })

  const { text } = renderMap(nodes)
  assert.doesNotMatch(text, /jane\.doe|Jane Doe/, "customer data reached the region map")
  assert.match(text, /‹record›/)
  assert.match(text, /"Save"/, "an ordinary control label must survive — this is redaction, not truncation")
})

test("side-by-side panes come out as sibling regions — the fact ARIA cannot express", () => {
  // A column has no ARIA role, so the flat map could not answer "are these two
  // controls in the same pane?". Measured: 3/6 for the flat map against 6/6 for
  // the shapes that carry geometry.
  const nodes = tree(() => [
    node({ w: 1500, h: 900, dsp: "flex" }),
    node({ p: 0, x: 0, w: 400, h: 800 }),
    node({ p: 1, tag: "button", name: "In the list", w: 300, h: 40 }),
    node({ p: 0, x: 420, w: 500, h: 800, tag: "section" }),
    node({ p: 3, tag: "input", name: "", w: 400, h: 40 }),
    node({ p: 3, tag: "input", name: "", w: 400, h: 40, y: 50 }),
    node({ p: 3, tag: "select", name: "", w: 400, h: 40, y: 100 }),
    node({ p: 0, x: 950, w: 540, h: 800, tag: "aside" }),
    node({ p: 7, tag: "button", name: "In the detail pane", w: 300, h: 40 }),
  ])

  const { text, regions } = renderMap(nodes)
  assert.ok(regions >= 4, `expected the root plus three panes, got ${regions} regions`)
  // The two buttons must not end up under one heading — that is the whole point.
  const lines = text.split("\n")
  const listLine = lines.findIndex((l) => l.includes("In the list"))
  const detailLine = lines.findIndex((l) => l.includes("In the detail pane"))
  const between = lines.slice(listLine + 1, detailLine)
  assert.ok(
    between.some((l) => /^\s*- (panel|form|navigation|scrollable list|toolbar strip|table)/.test(l)),
    "a region boundary must separate controls that sit in different panes"
  )
})

test("scroll depth is stated — the fact a screenshot cannot show either", () => {
  // a measured screen held 18,866px of list in a 318px frame. The picture guessed
  // "3–15×" against a real 59×; no still image can show what is below the fold.
  const nodes = tree(() => [
    node({ w: 1000, h: 800, dsp: "flex" }),
    node({ p: 0, x: 0, w: 480, h: 600, ovy: "auto", sh: 18866, ch: 318 }),
    node({ p: 1, tag: "button", name: "Row", w: 400, h: 40 }),
    node({ p: 0, x: 500, w: 480, h: 600 }),
    node({ p: 3, tag: "button", name: "Elsewhere", w: 400, h: 40 }),
  ])

  assert.match(renderMap(nodes).text, /⇅ 18866px of content in a 318px frame/)
})

test("REGRESSION: controls left outside the unwrapped frame are announced, not dropped", () => {
  // The walk skips wrappers to reach the region that matters. In one measured
  // app every screen had two controls OUTSIDE the page container — a floating
  // assistant button and a toast region — and unwrapping swallowed them
  // silently. A control that is on the screen and missing from the map is the
  // exact failure this tool exists to catch.
  const nodes = tree(() => {
    const out = [
      node({ w: 1000, h: 800 }),
      node({ p: 0, w: 1000, h: 800, dsp: "flex" }), // the app container: one big child
      node({ p: 1, x: 0, w: 480, h: 700 }),
      node({ p: 1, x: 500, w: 480, h: 700 }),
    ]
    // The container must hold almost all the controls, or the walk correctly
    // refuses to unwrap and nothing is left behind to announce.
    for (let k = 0; k < 6; k++) out.push(node({ p: 2, tag: "button", name: `Left ${k}`, y: k * 45, w: 300, h: 40 }))
    for (let k = 0; k < 6; k++) out.push(node({ p: 3, tag: "input", name: "", y: k * 45, w: 300, h: 40 }))
    // Floating, outside the container that the unwrap descends into.
    out.push(node({ p: 0, tag: "button", name: "Floating", x: 940, y: 740, w: 48, h: 48, pos: "fixed" }))
    return out
  })

  assert.match(renderMap(nodes).text, /⚠ 1 more controls outside this frame/)
})

test("a repeated row is one line with its count, never 257 lines", () => {
  const nodes = tree(() => {
    const out = [node({ w: 1000, h: 800 }), node({ p: 0, w: 1000, h: 800, ovy: "auto", sh: 9000, ch: 800 })]
    for (let k = 0; k < 40; k++) {
      out.push(node({ p: 1, tag: "button", testid: `row-${k}`, name: `Record ${k}`, y: k * 90, w: 900, h: 88 }))
    }
    return out
  })

  const { text } = renderMap(nodes)
  assert.match(text, /repeated item ×40/)
  assert.ok(text.split("\n").length < 15, `the map should collapse the list, got ${text.split("\n").length} lines`)
})

test("empty input does not throw", () => {
  assert.deepEqual(renderMap([]), { text: "", regions: 0, controls: 0 })
})

test("REGRESSION: a scrolling table still collapses its rows", () => {
  // The scroll fact belongs to the box that scrolls, so an early fix refused to
  // unwrap past a scroller. That left a scrolling table with no child regions at
  // all, its rows never reached the repeat collapse, and every one printed:
  // one generated page went 469 → 3,092 tokens on the first real run. Both
  // facts have to survive together — the scroll depth AND the collapse.
  const nodes = tree(() => {
    const out = [
      node({ w: 1000, h: 800 }),
      node({ p: 0, w: 1000, h: 780, ovy: "auto", sh: 5087, ch: 780 }), // the scrolling frame
      node({ p: 1, tag: "table", w: 1000, h: 5087 }),
      node({ p: 2, tag: "tbody", w: 1000, h: 5000 }),
    ]
    for (let k = 0; k < 60; k++) {
      const row = next
      out.push(node({ p: 3, tag: "tr", testid: `row-${k}`, y: k * 48, w: 1000, h: 48 }))
      out.push(node({ p: row, tag: "a", name: `INV-${k}`, y: k * 48, w: 200, h: 40 }))
    }
    return out
  })

  const { text } = renderMap(nodes)
  assert.match(text, /⇅ 5087px of content in a 780px frame/, "the scroll depth must survive the unwrap")
  assert.match(text, /repeated item ×60/, "the rows must still collapse")
  assert.ok(text.split("\n").length < 12, `expected a collapsed map, got ${text.split("\n").length} lines`)
})

test("REGRESSION: a region is named by its own heading", () => {
  // The first region map dropped EVERY heading. The flat map it replaced had
  // carried them, so the new format lost exactly the words that answer "where
  // does this go?" — the section titles themselves. Censused
  // across 33 real screens: 74 of 590 regions (12%) had a title going in the bin.
  const nodes = tree(() => [
    node({ w: 1000, h: 800, dsp: "flex" }),
    node({ p: 0, x: 0, w: 480, h: 700 }),
    node({ p: 1, tag: "h2", name: "Incoming orders", w: 300, h: 24 }),
    node({ p: 1, tag: "button", name: "Approve", y: 40, w: 300, h: 40 }),
    node({ p: 0, x: 500, w: 480, h: 700 }),
    node({ p: 4, tag: "button", name: "Reject", w: 300, h: 40 }),
  ])

  assert.match(renderMap(nodes).text, /"Incoming orders"/)
})

test("REGRESSION: a toolbar has to contain tools", () => {
  // `h ≤ 80 && w > 400` called any short wide box a toolbar. Censused: 80 of 198
  // "toolbar strip" regions across 33 screens held no control whatsoever.
  const nodes = tree(() => [
    node({ w: 1000, h: 800, dsp: "flex", fd: "column" }),
    node({ p: 0, w: 900, h: 60 }), // wide, short, and empty — not a toolbar
    node({ p: 1, tag: "span", name: "", w: 200, h: 20 }),
    node({ p: 0, y: 70, w: 900, h: 60 }),
    node({ p: 3, tag: "button", name: "Export", w: 100, h: 40 }),
    node({ p: 3, tag: "button", name: "Import", x: 120, w: 100, h: 40 }),
  ])

  const { text } = renderMap(nodes)
  assert.equal(text.match(/toolbar strip/g)?.length ?? 0, 1, "only the box with controls is a toolbar")
})

test("REGRESSION: an empty leaf region is not printed at all", () => {
  // Censused: 25 of 590 regions had no controls, no title, no children and
  // nothing to warn about — a line each saying only "a box exists here".
  const nodes = tree(() => [
    node({ w: 1000, h: 800, dsp: "flex" }),
    node({ p: 0, x: 0, w: 480, h: 700 }),
    // Deliberately under the region-size floor, or the walk descends into the
    // button itself and the panel under test disappears for a different reason.
    node({ p: 1, tag: "button", name: "Real", w: 200, h: 30 }),
    node({ p: 0, x: 500, w: 480, h: 700 }), // nothing inside worth a word
  ])

  const { text } = renderMap(nodes)
  assert.match(text, /"Real"/)
  assert.equal(text.split("\n").filter((l) => /\[480×700/.test(l)).length, 1, "the empty twin must not get a line")
})

test("in-bar placement marks only what is not on the left", () => {
  // Every format, the screenshot included, answered "top-left" for a search box
  // at x=1392 in a full-width bar. Left is the default and stays unmarked, so a
  // plain column costs nothing.
  const nodes = tree(() => [
    node({ w: 1000, h: 800, dsp: "flex", fd: "column" }),
    node({ p: 0, w: 1000, h: 60, dsp: "flex" }),
    node({ p: 1, tag: "button", name: "Filters", x: 0, w: 120, h: 40 }),
    node({ p: 1, tag: "button", name: "Approve", x: 850, w: 140, h: 40 }),
    node({ p: 0, y: 70, w: 1000, h: 600 }),
    node({ p: 4, tag: "button", name: "Below", w: 200, h: 40 }),
  ])

  const { text } = renderMap(nodes)
  assert.match(text, /"Approve" \[right\]/)
  assert.doesNotMatch(text, /"Filters" \[/, "the left end carries no marker")
  assert.doesNotMatch(renderMap(nodes, { visual: false }).text, /\[right\]/, "the visual layer must be switchable off")
})

test("REGRESSION: a table never claims 0 rows while its rows are right below it", () => {
  // Reported 2026-08-04 by the atlas's first consumer, on four screens at once:
  //   partnerek.md     table (0 rows) [1486×1022]   ← repeated item ×25 under it
  //   dokumentumok.md  table (0 rows) [1486×1265]   ← repeated item ×25
  //   ajanlatok-id.md  table (0 rows) [1086×310]    ← 6 real line items
  // The count only looked at what the region DIRECTLY owns, but rows become
  // child regions of their own — so they were never in that set. The consumer
  // was nearly misled into reporting an empty consignment as a bug.
  //
  // ⚠ This is worse than the missing field it was meant to replace: a stated
  // number that says zero is indistinguishable from a genuinely empty table,
  // and it is exactly the field that invites a reader to trust it. Where the
  // count cannot be established, the label carries no number at all — `table`
  // on its own is still a true statement.
  const nodes = tree(() => {
    const out = [node({ w: 1486, h: 1122 }), node({ p: 0, tag: "table", w: 1486, h: 1022 })]
    for (let r = 0; r < 25; r++) {
      const row = next
      out.push(node({ p: 1, tag: "tr", w: 1486, h: 40, y: r * 40 }))
      const cell = next
      out.push(node({ p: row, tag: "td", w: 700, h: 40, y: r * 40 }))
      out.push(node({ p: cell, tag: "button", name: `Row ${r}`, w: 200, h: 30, y: r * 40 }))
    }
    return out
  })

  const { text } = renderMap(nodes)
  assert.doesNotMatch(text, /table \(0 rows\)/, "the label stated zero over 25 rows")
  assert.match(text, /table \(25 rows\)/)
})

test("REGRESSION: a header row is not a row — the count means the same thing at every size", () => {
  // Found 2026-08-04 by research/truth-check.mjs, which counts `<tbody>` rows
  // straight off the raw capture instead of walking regions. Two screens
  // disagreed with the map; both had a one-row table:
  //   leltar-id      DOM 1 row   map `table (2 rows)`
  // The two counting paths had drifted apart. `rowsBelow` sums the repeated
  // runs, and a header never joins one because it is structurally unlike a data
  // row — so on the big tables (127, 103, 58, 25 rows measured) it was right.
  // `ownRows` counts every `tr` the region owns, header included, and it is the
  // path a small table takes. Same field, two meanings, off by one.
  //
  // ⚠ Off by one, on the reassuring side, on a table small enough that nobody
  // would recount. That is the whole failure class this benchmark exists for:
  // the format benchmark scored 98% while the map was printing it.
  const nodes = tree(() => {
    const out = [node({ w: 1536, h: 200 }), node({ p: 0, tag: "table", w: 1536, h: 125 })]
    const head = next
    out.push(node({ p: 1, tag: "thead", w: 1536, h: 40 }))
    const headRow = next
    out.push(node({ p: head, tag: "tr", w: 1536, h: 40 }))
    out.push(node({ p: headRow, tag: "th", name: "Item", w: 700, h: 40 }))
    const body = next
    out.push(node({ p: 1, tag: "tbody", w: 1536, h: 85, y: 40 }))
    const bodyRow = next
    out.push(node({ p: body, tag: "tr", w: 1536, h: 85, y: 40 }))
    out.push(node({ p: bodyRow, tag: "td", name: "The only row", w: 700, h: 85, y: 40 }))
    return out
  })

  const { text } = renderMap(nodes)
  assert.match(text, /table \(1 rows?\)/, "the header row was counted as data")
})

test("a table whose rows cannot be counted states no number rather than a wrong one", () => {
  const nodes = tree(() => [
    node({ w: 1000, h: 400 }),
    node({ p: 0, tag: "table", w: 900, h: 300 }),
    node({ p: 1, tag: "button", name: "Add the first row", w: 200, h: 40 }),
  ])

  const { text } = renderMap(nodes)
  assert.match(text, /- table \[/, "expected a bare `table` label")
  assert.doesNotMatch(text, /0 rows/)
})

test("REGRESSION: a table's rows are the SUM of its repeated runs, not the largest one", () => {
  // Measured 2026-08-04 on a real bug-tracker screen: the label said 44 rows over a table
  // whose DOM held 58. The rows had split into three repeated runs (11 + 44 + 3, because
  // rows that differ structurally do not collapse together) and the count took the biggest.
  //
  // ⚠ Why it survived review: 44 was ALSO a real number on that screen — the count of one
  // status — and the region height divided by it gave a plausible row height. Two signals
  // agreeing is not corroboration when both come from the same blind spot.
  //
  // The run tag decides what counts as a row: `col` elements repeat too, and a table with
  // eleven columns is not eleven rows.
  const nodes = tree(() => {
    const out = [node({ w: 1500, h: 1000 }), node({ p: 0, tag: "table", w: 1451, h: 900 })]
    let y = 0
    // Three runs of `tr`, plus a run of `col` that must not be mistaken for rows.
    for (const [count, cls] of [[11, "a"], [44, "b"], [3, "c"]]) {
      for (let r = 0; r < count; r++) {
        const row = next
        out.push(node({ p: 1, tag: "tr", w: 1451, h: 33, y: (y += 33), testid: `row-${cls}` }))
        out.push(node({ p: row, tag: "td", w: 700, h: 33, y, name: `cell ${cls}${r}` }))
      }
    }
    for (let c = 0; c < 11; c++) out.push(node({ p: 1, tag: "col", w: 96, h: 900 }))
    return out
  })

  const { text } = renderMap(nodes)
  assert.match(text, /table \(58 rows\)/, "expected 11 + 44 + 3 rows, not the largest run alone")
})

test("REGRESSION: controls inside a repeated row are records, not actions", () => {
  // Measured 2026-08-04 on the first real ACTIONS.md: 320 "actions", of which 30 had no
  // letter in them at all (`10`, `11`, `.`) and 16 were whole paragraphs. Every one came
  // from the rows of one table — a link on a table row points at THAT RECORD, and listing
  // it as an offered action is how a cross-screen index turns into noise nobody greps.
  const nodes = tree(() => {
    const out = [
      node({ w: 1200, h: 900 }),
      node({ p: 0, tag: "button", name: "Új bejelentés", w: 150, h: 40 }), // a real action
      node({ p: 0, tag: "table", w: 1100, h: 800, y: 50 }),
    ]
    for (let r = 0; r < 8; r++) {
      const row = next
      out.push(node({ p: 2, tag: "tr", w: 1100, h: 40, y: 50 + r * 40 }))
      out.push(node({ p: row, tag: "a", name: `${r + 10}`, w: 60, h: 30, y: 50 + r * 40 }))
    }
    return out
  })

  const { controlList } = renderMap(nodes)
  const names = controlList.map(c => c.name)
  assert.ok(names.includes("Új bejelentés"), "a real action must survive")
  assert.deepEqual(names.filter(n => /^\d+$/.test(n)), [], `row links leaked in: ${names}`)
})

test("a region with a testid says so — a name a human already gave it", () => {
  // The `panel` label is the catch-all, and a census put it on 48% of regions. The
  // annotation prototype showed the missing name was already in the data: the region
  // the consumer had to identify from its size alone (`panel [483×796]`) carries
  // `data-testid="email-viewer-panel"`. Zero heuristics — someone wrote that name for
  // their own tests, and it is the one place the role guesser gives up.
  const nodes = tree(() => [
    node({ w: 1000, h: 800, dsp: "flex" }),
    node({ p: 0, x: 0, w: 480, h: 700, testid: "email-viewer-panel" }),
    node({ p: 1, tag: "button", name: "Válasz", w: 100, h: 40 }),
    node({ p: 0, x: 500, w: 480, h: 700 }),
    node({ p: 3, tag: "button", name: "Mentés", w: 100, h: 40 }),
  ])

  const { text } = renderMap(nodes)
  assert.match(text, /panel #email-viewer-panel/, "the name that was already there went in the bin")
  // A region with no testid must not gain a fake one.
  assert.ok(text.split("\n").filter(l => l.includes("- panel")).some(l => !l.includes("#")))
})
