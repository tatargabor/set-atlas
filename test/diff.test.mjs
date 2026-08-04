import { test } from "node:test"
import assert from "node:assert/strict"
import { lineDiff, formatDiff } from "../src/diff.mjs"

test("an added control shows as an addition, and the untouched lines stay untouched", () => {
  const before = `- toolbar strip\n  - searchbox "Search"\n- panel`
  const after = `- toolbar strip\n  - searchbox "Search"\n  - button "New quote"\n- panel`
  const rows = lineDiff(before, after)
  assert.deepEqual(
    rows.map((r) => r.mark),
    [" ", " ", "+", " "]
  )
  assert.equal(rows[2].text, `  - button "New quote"`)
})

test("a replaced line is one removal and one addition, not a whole-file rewrite", () => {
  // The point of an LCS rather than a set difference: `button "Approve"` becoming
  // `button "Approve all (3)"` has to read as ONE changed control. Comparing sets
  // of lines would say the same thing, but it would say it for two unrelated
  // lines that happened to move as well — and then nobody reads the output.
  const before = `- panel\n  - button "Approve"\n  - button "Reject"\n- footer`
  const after = `- panel\n  - button "Approve all (3)"\n  - button "Reject"\n- footer`
  const marks = lineDiff(before, after)
    .filter((r) => r.mark !== " ")
    .map((r) => `${r.mark}${r.text.trim()}`)
  assert.deepEqual(marks, [`-- button "Approve"`, `+- button "Approve all (3)"`])
})

test("identical pages produce nothing to print", () => {
  const text = `- panel\n  - button "Save"`
  assert.deepEqual(formatDiff(text, text), [])
})

test("the cap on printed lines is ANNOUNCED, never silent", () => {
  // A renamed route rewrites a whole page. Without the cap that one screen buries
  // every other screen's changes; with a silent cap the output claims the rest
  // did not change. Both are the same failure this package exists to catch.
  const before = Array.from({ length: 100 }, (_, i) => `  - button "old ${i}"`).join("\n")
  const after = Array.from({ length: 100 }, (_, i) => `  - button "new ${i}"`).join("\n")
  const out = formatDiff(before, after, { maxLines: 10 })
  assert.ok(out.length <= 14, "the cap holds")
  assert.match(out.at(-1), /⚠ \d+ further changed line\(s\) not shown/)
})

test("a page too large to diff says so instead of pretending it matched", () => {
  const huge = Array.from({ length: 4001 }, (_, i) => `line ${i}`).join("\n")
  assert.equal(lineDiff(huge, huge + "\nmore"), null)
  assert.match(formatDiff(huge, huge + "\nmore")[0], /too large to diff/)
})
