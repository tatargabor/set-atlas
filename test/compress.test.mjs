// Regression tests — every one of them comes from a bug that actually happened.
// Run:  node --test
import { test } from "node:test"
import assert from "node:assert/strict"
import { compress } from "../src/compress.mjs"

test("REGRESSION: distinct menu items must NOT collapse into one", () => {
  // Measured on a real ERP surface, 2026-08-04: the first version normalized
  // names away before collapsing, so 11 main menu items became a single
  // `link "…"  (× 11)` row. The navigation vanished — the exact thing the map
  // is built for.
  const input = `
- navigation "Main navigation":
  - link "Dashboard":
  - link "Orders":
  - link "Products":
  - link "Partners":
`.trim()

  const { text } = compress(input)
  for (const label of ["Dashboard", "Orders", "Products", "Partners"]) {
    assert.match(text, new RegExp(label), `menu item "${label}" disappeared from the map`)
  }
  assert.doesNotMatch(text, /× 4/, "distinct menu items were collapsed")
})

test("REGRESSION: data-shaped card names are anonymized", () => {
  // Same day: order list cards carried the whole record in their accessible
  // name. Two problems — real personal data leaks into the map, and every new
  // order rewrites the file (noisy diff → the staleness gate becomes useless).
  const input = `
- main:
  - button "Jane Doe 07-27 07:26 INV-00303 · Jane Doe - 2026-07-27 07:25 Invoiced 312.459 Ft"
  - button "Acme Ltd 07-24 19:49 INV-00302 · Acme - 2026-07-23 Approved 13.882 Ft"
`.trim()

  const { text } = compress(input)
  assert.doesNotMatch(text, /Jane Doe|Acme/, "real record data leaked into the map")
  assert.match(text, /‹record›/)
  assert.match(text, /× 2/, "anonymized cards with the same shape should collapse")
})

test("short, non-data button names stay INTACT", () => {
  // The opposite failure mode: over-eager anonymization would erase the name of
  // the very actions a designer needs to see.
  const input = `
- main:
  - button "New quote"
  - button "Approve and send"
  - button "Clone to another partner"
`.trim()

  const { text } = compress(input)
  assert.match(text, /"New quote"/)
  assert.match(text, /"Approve and send"/)
  assert.match(text, /"Clone to another partner"/)
  assert.doesNotMatch(text, /‹record›/)
})

test("table rows are dropped, the column structure survives", () => {
  const input = `
- table:
  - rowgroup:
    - row "Date Amount Partner":
      - columnheader "Date"
      - columnheader "Amount"
      - columnheader "Partner"
  - rowgroup:
    - row "2026-07-27 312.459 Ft Jane Doe":
      - cell "2026-07-27"
      - cell "312.459 Ft"
      - cell "Jane Doe"
`.trim()

  const { text, droppedDataLines } = compress(input)
  assert.match(text, /columns: Date · Amount · Partner/)
  assert.doesNotMatch(text, /Jane Doe|312\.459/, "a data row survived into the map")
  assert.ok(droppedDataLines > 0, "dropped lines must be counted, not silently discarded")
})

test("state markers ([selected], [disabled]) are preserved", () => {
  // What matters at design time is whether an action is reachable — [disabled]
  // describes the surface's state machine, not the data.
  const input = `
- tablist:
  - tab "Details" [selected]
  - tab "Items"
- button "Create quote" [disabled]
`.trim()

  const { text } = compress(input)
  assert.match(text, /\[selected\]/)
  assert.match(text, /\[disabled\]/)
})

test("empty input does not throw", () => {
  assert.equal(compress("").text, "")
})
