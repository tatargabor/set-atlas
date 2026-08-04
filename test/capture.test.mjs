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
