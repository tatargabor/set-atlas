import { test } from "node:test"
import assert from "node:assert/strict"
import { buildActions, buildNavigation, patternFor } from "../src/crosscut.mjs"

const screen = (pattern, controls, extra = {}) => ({
  pattern,
  title: pattern,
  controlList: controls.map(c => (typeof c === "string" ? { kind: "button", name: c, href: "" } : c)),
  ...extra,
})

test("the same action offered on two screens is listed once, with both screens", () => {
  // This is the question the whole cross-section exists for: "is there already a
  // button for this somewhere?" Depth-first through 33 screen pages, an agent has
  // to read all of them to notice; here it is one grep.
  const md = buildActions([
    screen("/ajanlatok", ["Új ajánlat", "Szűrők törlése"]),
    screen("/rendelesek", ["Új ajánlat", "Új rendelés"]),
  ])

  const line = md.split("\n").find(l => l.includes("Új ajánlat") && !l.includes("generálása"))
  assert.ok(line.includes("/ajanlatok") && line.includes("/rendelesek"), `both screens must be on one row: ${line}`)
  // One row per action, not one per occurrence — otherwise the duplication is as
  // hard to see as it was in the screen pages.
  assert.equal(md.split("\n").filter(l => l.startsWith("| `Új ajánlat`")).length, 1)
})

test("REGRESSION: app chrome is separated, or it drowns everything else", () => {
  // Measured on a 33-screen app: the sidebar, the header and the user menu repeat
  // on every single screen. Listed inline they are the majority of the file, and
  // "appears on 33 screens" reads exactly like the duplication being hunted for.
  // The threshold is stated in the file itself — a silent filter would be the very
  // failure this tool exists to catch.
  const screens = Array.from({ length: 10 }, (_, i) => screen(`/s${i}`, ["Sötét mód", `Csak itt ${i}`]))
  const md = buildActions(screens)

  const [main, chrome] = md.split("## Everywhere")
  assert.ok(!main.includes("Sötét mód"), "chrome leaked into the main list")
  assert.ok(chrome?.includes("Sötét mód"), "chrome must still be listed, not dropped")
  assert.ok(main.includes("Csak itt 3"), "a screen-specific action must stay in the main list")
})

test("NAVIGATION: a screen nothing links to is named", () => {
  // The complaint the atlas was built for: a feature shipped where nothing reaches
  // it. Unreachability is a counting question, not a judgement — so it is stated.
  const md = buildNavigation([
    screen("/", [{ kind: "link", name: "Rendelések", href: "/rendelesek" }]),
    screen("/rendelesek", [{ kind: "link", name: "Vissza", href: "/" }]),
    screen("/ajanlatok", []),
  ])

  assert.match(md, /## Nothing links here/)
  const orphans = md.split("## Nothing links here")[1]
  assert.ok(orphans.includes("/ajanlatok"), "the unreachable screen was not called out")
  assert.ok(!orphans.includes("/rendelesek"), "a reachable screen must not be listed as an orphan")
})

test("a link to a record URL counts as a link to its route pattern", () => {
  // Hrefs carry live ids (/partnerek/bb071475-…). Compared raw, every screen with
  // a parameterised route would look unreachable — the exact false alarm that would
  // make the orphan list worthless.
  assert.equal(patternFor("/partnerek/bb071475-29eb-42b2-bba5-7a74e87ff793"), "/partnerek/[id]")
  assert.equal(patternFor("/rendelesek/12345"), "/rendelesek/[id]")
  assert.equal(patternFor("/rendelesek?fazis=quotes"), "/rendelesek")
  assert.equal(patternFor("https://example.com/kulso"), null, "an external link is not navigation within the app")
  assert.equal(patternFor("/partnerek"), "/partnerek")
})
