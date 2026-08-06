import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { writeScreens, withoutProvenance } from "../src/capture.mjs"

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "set-atlas-test-"))

const screen = (url, pattern, extra = {}) => ({
  url,
  pattern,
  title: url,
  map: `- button "${url}"`,
  pointers: {},
  stats: { mapTokens: 10 },
  ...extra,
})

test("REGRESSION: two routes sharing a pattern fail loudly instead of overwriting", () => {
  // Reported by the a measured app agent 2026-08-04, after the atlas turned out to be
  // seeing the `?fazis=quotes` tab only because a legacy `/ajanlatok` URL happens
  // to redirect there. Adding the tab the obvious way —
  //   { url: "/rendelesek?fazis=quotes", pattern: "/rendelesek" }
  // — would have silently DELETED rendelesek.md: the filename comes from the
  // pattern, so the second write wins and INDEX.md points both rows at one page.
  // The run still printed "33 screens ✓". A failure that looks exactly like
  // success is the specific bug this tool exists to catch.
  const root = tmpRoot()
  const screens = [screen("/rendelesek", "/rendelesek"), screen("/rendelesek?fazis=quotes", "/rendelesek")]

  assert.throws(() => writeScreens(screens, { root, outDir: "atlas" }), /state:/)
  // It must refuse BEFORE writing anything — a half-written atlas is worse than
  // none, because --check would then report drift that never happened.
  assert.equal(fs.existsSync(path.join(root, "atlas", "rendelesek.md")), false)
})

test("a `state:` gives the variant its own page, and the index says which is which", () => {
  const root = tmpRoot()
  const screens = [
    screen("/rendelesek", "/rendelesek"),
    screen("/rendelesek?fazis=quotes", "/rendelesek", { state: "quotes", title: "Quote requests tab" }),
  ]

  writeScreens(screens, { root, outDir: "atlas" })
  const dir = path.join(root, "atlas")
  assert.ok(fs.existsSync(path.join(dir, "rendelesek.md")))
  assert.ok(fs.existsSync(path.join(dir, "rendelesek--quotes.md")))

  // The page states its own variant: a reader who opens only this file has to be
  // able to tell that it is one view of a route, not the whole route.
  const variant = fs.readFileSync(path.join(dir, "rendelesek--quotes.md"), "utf8")
  assert.match(variant, /^state: quotes$/m)
  assert.match(variant, /^url: \/rendelesek\?fazis=quotes$/m)

  // Two index rows that both read "/rendelesek" would be useless — the row has to
  // carry the URL that reaches it.
  const index = fs.readFileSync(path.join(dir, "INDEX.md"), "utf8")
  assert.match(index, /rendelesek--quotes\.md/)
  assert.match(index, /\/rendelesek\?fazis=quotes/)
})

test("a state on a distinct pattern does not collide with anything", () => {
  const root = tmpRoot()
  writeScreens([screen("/partnerek", "/partnerek", { state: "archived" })], { root, outDir: "atlas" })
  assert.ok(fs.existsSync(path.join(root, "atlas", "partnerek--archived.md")))
})

test("REGRESSION: provenance is recorded, and does not make --check fire on every run", () => {
  // The atlas has to say where it came from — an atlas that cannot be dated cannot be
  // called stale, and "a stale UI description is worse than none" is this tool's first
  // principle. Measured 2026-08-04: three regenerations in one afternoon left no trace
  // of when or from which commit any of them was made.
  //
  // ⚠ But `--check` compares file CONTENT, so a timestamp in the index would mark it
  // stale on every single run — a gate that always fires is a gate nobody keeps. The
  // provenance lines are therefore excluded from that comparison, and only from it.
  const root = tmpRoot()
  writeScreens([screen("/a", "/a")], { root, outDir: "atlas" })
  const index = fs.readFileSync(path.join(root, "atlas", "INDEX.md"), "utf8")
  assert.match(index, /^generated_at: \d{4}-\d{2}-\d{2}/m)

  const later = index.replace(/^generated_at: .*$/m, "generated_at: 2099-01-01T00:00:00Z")
  assert.notEqual(later, index)
  assert.equal(withoutProvenance(later), withoutProvenance(index), "a re-run alone must not read as UI drift")
  // Everything else still counts — this is a narrow exception, not a blanket one.
  assert.notEqual(withoutProvenance(index.replace("/a", "/b")), withoutProvenance(index))
})

test("REGRESSION: a screen that could not be recorded says so ON ITS OWN PAGE", () => {
  // Measured 2026-08-04: `/leltar/[id]` failed to record (`ariaSnapshot did not
  // settle after a retry`), and its page from the PREVIOUS run stayed in
  // docs/atlas/ unchanged. The run printed `✗`, INDEX.md listed it under
  // "Could not be recorded" — but the page itself said nothing, so a reader who
  // opened that one file had no way to know it described an older UI.
  //
  // Deleting it is the wrong repair, and the consumer's argument is why: a
  // deleted page and a screen that never existed look identical from outside.
  // The page stays; it stops claiming to be current.
  const root = tmpRoot()
  const page = path.join(root, "atlas", "leltar-id.md")

  writeScreens([screen("/leltar/1", "/leltar/[id]")], { root, outDir: "atlas" })
  assert.ok(fs.readFileSync(page, "utf8").includes('button "/leltar/1"'))

  const failing = [screen("/leltar/1", "/leltar/[id]", { error: "ariaSnapshot did not settle after a retry" })]
  writeScreens(failing, { root, outDir: "atlas" })
  const marked = fs.readFileSync(page, "utf8")
  assert.match(marked, /^stale_since: \d{4}-\d{2}-\d{2}/m, "a machine reader has to be able to filter it")
  assert.match(marked, /ariaSnapshot did not settle/, "and it has to say WHY the recording failed")
  assert.ok(marked.includes('button "/leltar/1"'), "the previous recording is kept, not thrown away")

  // ⚠ The failure repeats every run until someone fixes the screen, so the mark
  // must replace itself rather than stack. Two runs, one mark.
  writeScreens(failing, { root, outDir: "atlas" })
  const twice = fs.readFileSync(page, "utf8")
  assert.equal(twice.match(/^stale_since:/gm).length, 1)
  assert.equal(twice.match(/could not be re-recorded/g).length, 1)

  // ⚠ And the same trap as the index timestamp: the screen fails again on every
  // run, so `stale_since` moves while nothing about the UI has. `--check` must
  // fire ONCE — when the page went stale — not on every run afterwards.
  assert.notEqual(twice, marked, "the timestamp did move")
  assert.equal(withoutProvenance(twice), withoutProvenance(marked), "a repeated failure alone must not read as UI drift")
  // The reason is not exempt: becoming stale, or stale for a different reason,
  // is a real change to the atlas.
  const otherReason = markedFor(root, page, "the route now 404s")
  assert.notEqual(withoutProvenance(otherReason), withoutProvenance(twice))
})

/** Re-runs the same failing screen with a different error and returns the page. */
function markedFor(root, page, error) {
  writeScreens([screen("/leltar/1", "/leltar/[id]", { error })], { root, outDir: "atlas" })
  return fs.readFileSync(page, "utf8")
}

test("REGRESSION: a redirect is stated on the page, not silently followed", () => {
  // The consumer's `/ajanlatok` renders `/rendelesek?fazis=quotes`. Following the
  // redirect is right — that IS the screen a user sees — but doing it silently
  // makes two different situations look identical: a route with its own UI, and
  // a route that is a doorway to someone else's. The reader has to be told which
  // one they are looking at, and the pointers have to name the file that drew it.
  const root = tmpRoot()
  writeScreens([screen("/quotes", "/quotes", { redirectedTo: "/orders?phase=quotes" })], { root, outDir: "atlas" })
  const page = fs.readFileSync(path.join(root, "atlas", "quotes.md"), "utf8")
  assert.match(page, /^redirected_to: \/orders\?phase=quotes$/m)
})

test("the atlas states which GENERATOR made it, not only which commit it read", () => {
  // Asked for by the consumer 2026-08-06, out of a measurement of ours: the
  // `· N/M anchored` change moved all 33 of their pages, and `suspect` could not
  // see why — it watches the CONSUMER's UI files, and this was a change in the
  // tool. `--check` saw it, but that needs a running app, so it is not gate-shaped.
  //
  // ⚠ Their argument is what decided it, and it is not about convenience: without
  // this field, "33 pages moved" either causes a panic or — far worse — teaches
  // the reader that a large number means format noise. The second is what would
  // swallow a real 33-page surface change.
  const root = tmpRoot()
  writeScreens([screen("/orders", "/orders")], { root, outDir: "atlas" })
  const index = fs.readFileSync(path.join(root, "atlas", "INDEX.md"), "utf8")
  assert.match(index, /^generator_version: \S+/m)
})

test("REGRESSION: the stamp is the commit the recording STARTED from", () => {
  // Measured by a consumer 2026-08-06, and the direction of the error is the
  // point. A full recording takes them ~12 minutes; the stamp was taken at the
  // END of it. So a commit landing DURING the window — theirs landed at 10:10:30
  // inside a 10:03→10:14:52 run — became the stamp, and the atlas then claims to
  // describe a state it never saw.
  //
  // ⚠ That error points the reassuring way: `suspect` compares from the stamp
  // forward, so anything committed mid-run reads as "already recorded". Stamping
  // the START instead can only make the window WIDER — the gate may ask about a
  // file that was in fact captured, which costs a look, not a false all-clear.
  // Excluding `docs/atlas/` does not help here: that hides our own output, not
  // someone else's commit landing mid-run.
  const root = tmpRoot()
  writeScreens([screen("/orders", "/orders")], { root, outDir: "atlas", recordedFrom: "deadbee" })

  const index = fs.readFileSync(path.join(root, "atlas", "INDEX.md"), "utf8")
  assert.match(index, /^generated_from_commit: deadbee$/m, "the stamp ignored the commit the run started from")
})
