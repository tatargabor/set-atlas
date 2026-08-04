// Regression tests — every one of them comes from a bug that actually happened.
// Run:  node --test
import { test } from "node:test"
import assert from "node:assert/strict"
import { compress, isRecordName } from "../src/compress.mjs"

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

test("a name carrying an email address is a record, not an interface label", () => {
  // Measured 2026-08-04 on a 33-screen ERP: one partner-picker page was 5,640
  // tokens — 20% of the whole atlas — and 340 of its lines were real customer
  // names and email addresses. DATA_LIKE only knew about dates, amounts and
  // record ids, so a name like "Jane Doe jane.doe@example.com" passed straight
  // through: live personal data in a file the project tells you to paste into
  // planning prompts, and the screen's actual shape (a title, a search box, a
  // scrolling list, two buttons) buried under it.
  //
  // ⚠ The fixture is synthetic ON PURPOSE. The first version of this test used
  // three of the real names it was written to redact — in a public MIT repo. The
  // rule was already written down; it just wasn't applied to our own material.
  const input = `
- textbox "Search by name, email or tax number..."
- button "Jane Doe jane.doe@example.com"
- button "Acme Ltd. invoices@acme.example"
- button ". x@y.hu"
`.trim()

  const { text } = compress(input)
  assert.doesNotMatch(text, /jane\.doe|acme|x@y/, "customer data survived into the map")
  // The short one matters most: it is under the 25-character length gate, so
  // only the email itself can give it away.
  assert.match(text, /‹record›/)
  // The search box is interface and must survive — this is a redaction rule,
  // not a "drop anything long" rule.
  assert.match(text, /Search by name, email or tax number/)
})

test("REGRESSION: a consumer's own data patterns redact what the built-in rules cannot", () => {
  // Measured 2026-08-04, and it had been in the atlas unnoticed for a day: an accessible
  // label that wraps a record name in an action — `"FIKTÍVFA Kft. lenyitása"` — is 23
  // characters, under the 25-character length gate, and holds no date, amount or id. So
  // it passed through: 17 real company names across four screen pages. The cross-section
  // file did not cause this, it made it visible.
  //
  // No built-in rule can catch it. "A word that marks a company" is language-specific,
  // and hard-coding Hungarian company forms into a general tool is the same mistake as
  // hard-coding `Ft` — it would fail silently in the wrong direction on the next app.
  // So the consumer declares its own patterns, and they run ALONGSIDE the built-ins.
  const patterns = [/\b(Kft|Bt|Zrt|Nyrt)\b\.?/i]
  assert.equal(isRecordName("FIKTÍVFA Kft. lenyitása", patterns), true)
  assert.equal(isRecordName("Lorem Ipsum Kft partner megnyitása", patterns), true)
  // The built-ins keep working, and ordinary interface labels are untouched.
  assert.equal(isRecordName("jane.doe@example.com", patterns), true)
  assert.equal(isRecordName("Szűrők törlése", patterns), false)
  assert.equal(isRecordName("Előnézet frissítése", patterns), false)
  // Without the patterns the leak reproduces — this is what shipped.
  assert.equal(isRecordName("FIKTÍVFA Kft. lenyitása"), false)
})
