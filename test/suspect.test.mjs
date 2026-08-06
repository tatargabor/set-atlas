import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { atlasCommit, uiFilesChanged, suspectReport } from "../src/suspect.mjs"

const tmp = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "set-atlas-suspect-"))
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), body)
  }
  return dir
}

test("the gate reads which commit the atlas was recorded from", () => {
  const dir = tmp({ "INDEX.md": "---\ngenerated_at: 2026-08-05T06:00:00.000Z\ngenerated_from_commit: abc1234\n---\n\n# Atlas\n" })
  assert.equal(atlasCommit(dir), "abc1234")
})

test("an atlas with no provenance SAYS so rather than passing quietly", () => {
  // D14 and D7 together. An atlas that cannot be dated cannot be asked whether it
  // is stale — and a gate that returns "fine" on missing evidence is worse than no
  // gate, because it reports a check that never happened.
  const dir = tmp({ "INDEX.md": "---\ntokens: 100\n---\n\n# Atlas\n" })
  assert.equal(atlasCommit(dir), null)

  const report = suspectReport({ atlasDir: dir, commit: null, files: [] })
  assert.match(report.text, /cannot be dated|no `generated_from_commit`/i)
  assert.equal(report.suspect, true, "an undatable atlas has to be treated as suspect, not as clean")
})

test("only files that DRAW something make the atlas suspect", () => {
  // The extension rule, not the directory rule — see isUiFile. A server action
  // changing does not move a pixel; the route-local client component does, and it
  // does not live under /components/.
  const changed = [
    "src/app/orders/orders-client.tsx",
    "src/app/orders/actions.ts",
    "src/lib/pricing.ts",
    "src/components/order-table.tsx",
    "package.json",
    "docs/atlas/orders.md",
  ]
  assert.deepEqual(uiFilesChanged(changed), ["src/app/orders/orders-client.tsx", "src/components/order-table.tsx"])
})

test("the atlas's own pages never make the atlas suspect", () => {
  // Regenerating writes docs/atlas/*.md. If those counted, every regeneration
  // would leave the gate firing about the run that had just satisfied it.
  assert.deepEqual(uiFilesChanged(["docs/atlas/orders.md", "docs/atlas/INDEX.md"]), [])
})

test("the report names the SCREENS, not just the file count", () => {
  // The whole point of the gate. "3 UI files moved" tells the author to go and
  // look at 33 screens; naming the two that those files draw is the difference
  // between a warning that gets acted on and one that gets skipped.
  //
  // ⚠ The screen slugs here deliberately share NO substring with the changed file
  // paths. The first version of this test used `/orders` for both, and it passed
  // against a report that named zero screens — the assertion was matching the file
  // list. It was caught by running the gate against a real repository, where every
  // screen came out `undefined`; the green test had said nothing.
  const dir = tmp({
    "INDEX.md": "---\ngenerated_from_commit: abc1234\n---\n",
    "listaz.md": "---\nroute: /listaz\nurl: /listaz\nsource: src/app/orders/page.tsx\ncomponents:\n  - src/app/orders/orders-client.tsx\n---\n\n- panel [100×100]\n",
    "beallit.md": "---\nroute: /beallit\nurl: /beallit\nsource: src/app/settings/page.tsx\n---\n\n- panel [100×100]\n",
  })

  const report = suspectReport({ atlasDir: dir, commit: "abc1234", files: ["src/app/orders/orders-client.tsx"] })
  assert.equal(report.suspect, true)
  assert.equal(report.screens.length, 1, "the gate found no screen at all, or found both")
  assert.match(report.text, /listaz/, "the screen the changed file draws was not named")
  assert.doesNotMatch(report.text, /beallit/, "a screen the changed files do not draw was named anyway")
})

test("no UI file moved — the gate is clean and says what it checked", () => {
  const dir = tmp({ "INDEX.md": "---\ngenerated_from_commit: abc1234\n---\n" })
  const report = suspectReport({ atlasDir: dir, commit: "abc1234", files: [] })
  assert.equal(report.suspect, false)
  assert.match(report.text, /abc1234/, "a clean result that does not say what it compared against cannot be audited")
})

test("a DELETED drawing file is a stronger claim than a changed one", () => {
  // Reported by the consumer 2026-08-05, hours after this gate shipped: two routes
  // did not change, they were REMOVED — the editor moved into a tab of another
  // screen, and `quote-editor-client.tsx` was deleted. The gate named the right
  // page and said the wrong thing about it: "check this screen" instead of "this
  // page probably describes a screen that no longer exists".
  //
  // ⚠ This is the failure class the tool is for, aimed at the tool. A stale page
  // that merely lags is a page you re-read; a page for a route that is gone is one
  // that plans get built on. The atlas keeps it deliberately (from outside, a
  // deleted and a never-existing screen look the same) — so the gate has to say it.
  const dir = tmp({
    "INDEX.md": "---\ngenerated_from_commit: abc1234\n---\n",
    "listaz.md": "---\nroute: /listaz\nurl: /listaz\nsource: src/app/orders/page.tsx\ncomponents:\n  - src/app/orders/orders-client.tsx\n---\n\n- panel [100×100]\n",
  })

  const report = suspectReport({
    atlasDir: dir,
    commit: "abc1234",
    files: ["src/app/orders/orders-client.tsx"],
    deleted: ["src/app/orders/orders-client.tsx"],
  })
  assert.equal(report.suspect, true)
  assert.match(report.text, /deleted|no longer exist|removed/i, "a deleted drawing file read as an ordinary change")
  assert.match(report.text, /listaz/, "the page whose drawing file was deleted was not named")
})

test("an uncommitted provenance is announced — the gate says whose atlas it read", () => {
  // Found by the consumer 2026-08-06, and they were right to check the number:
  // I ran the gate on their tree and reported "✓ level with `0d5bbd9a`", while
  // their COMMIT carried `ea855349`. A second regeneration had rewritten the
  // atlas in the working tree without being committed.
  //
  //   git show HEAD:docs/atlas/INDEX.md → generated_from_commit: ea855349
  //   working tree                      → generated_from_commit: 0d5bbd9a
  //
  // ⚠ Reading the working tree is the RIGHT default — the gate exists to answer
  // "is the map behind the code in front of me". But a green answer about an
  // uncommitted atlas is not the answer CI or a reviewer would get, and unsaid,
  // it reads as if it were. The measurement was fine; the silence was not.
  const dir = tmp({ "INDEX.md": "---\ngenerated_from_commit: abc1234\n---\n" })
  const report = suspectReport({ atlasDir: dir, commit: "abc1234", files: [], provenanceUncommitted: true })
  assert.match(report.text, /uncommitted|working tree/i, "the gate reported on an uncommitted atlas without saying so")
})

test("the warning states that suspicion is not proof", () => {
  // ⚠ This gate runs WITHOUT the app, so it cannot know whether the surface
  // actually changed — only that a file which draws one moved. Claiming more than
  // that is the reassuring-direction error this project keeps measuring. The
  // Doorstop "suspect link" pattern: the system reports on its own bookkeeping.
  const dir = tmp({
    "INDEX.md": "---\ngenerated_from_commit: abc1234\n---\n",
    "orders.md": "---\nurl: /orders\nsource: src/app/orders/page.tsx\n---\n\n- panel [100×100]\n",
  })
  const report = suspectReport({ atlasDir: dir, commit: "abc1234", files: ["src/app/orders/page.tsx"] })
  assert.match(report.text, /suspicion|cannot tell|not proof/i)
})
