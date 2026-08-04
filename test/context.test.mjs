import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseFrontmatter, selectPages, neighbours, buildContext } from "../src/context.mjs"

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "set-atlas-ctx-"))

const page = (route, extra = "") => `---\nroute: ${route}\ntitle: ${route} screen\n${extra}---\n\n# ${route}\n\n\`\`\`yaml\n- button "Do it"\n\`\`\`\n`

function atlas(files) {
  const dir = path.join(tmp(), "atlas")
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
  return dir
}

function change(text) {
  const dir = path.join(tmp(), "change")
  fs.mkdirSync(path.join(dir, "specs"), { recursive: true })
  fs.writeFileSync(path.join(dir, "proposal.md"), text)
  return dir
}

test("frontmatter lists come back as arrays, scalars as strings", () => {
  const f = parseFrontmatter(`---\nroute: /a\ncomponents:\n  - src/one.tsx\n  - src/two.tsx\nregions: 4\n---\n\nbody`)
  assert.equal(f.route, "/a")
  assert.equal(f.regions, "4")
  assert.deepEqual(f.components, ["src/one.tsx", "src/two.tsx"])
})

test("REGRESSION: a list route is not pulled in by every mention of its detail route", () => {
  // `includes` matched `/orders` inside every `/orders/[id]`, so a change that
  // only touched the detail screen dragged the list screen in with it. With the
  // cap at five picks, one false hit pushes out a real one — the selection has to
  // be right, not roughly right.
  const pages = [
    { route: "/orders", paths: [], title: "list" },
    { route: "/orders/[id]", paths: [], title: "detail" },
  ]
  const picked = selectPages(pages, "We change the quote panel on /orders/[id] only.")
  assert.deepEqual(picked.map((p) => p.route), ["/orders/[id]"])
})

test("a page is picked by a source path too, and says which one", () => {
  const pages = [{ route: "/orders", paths: ["src/app/orders/page.tsx"], title: "list" }]
  const picked = selectPages(pages, "Touches src/app/orders/page.tsx.")
  assert.equal(picked.length, 1)
  assert.match(picked[0].why[0], /src\/app\/orders\/page\.tsx/)
})

test("the neighbourhood is what the change did NOT name", () => {
  const edges = [
    { from: "/", label: "Orders", to: "/orders" },
    { from: "/orders", label: "Open", to: "/orders/[id]" },
    { from: "/settings", label: "Home", to: "/" },
  ]
  const { near } = neighbours(edges, [{ route: "/orders" }], 4)
  assert.deepEqual(near.map((n) => n.route).sort(), ["/", "/orders/[id]"])
  assert.equal(near.some((n) => n.route === "/settings"), false, "two hops away is not the neighbourhood")
})

test("REGRESSION: a global nav link is not a neighbourhood, and its exclusion is announced", () => {
  // Measured on the consumer 2026-08-04: "one link away from /ajanlatok/[id]"
  // listed 25 screens, 24 of them only because every page in the app carries an
  // `Orders` link in its sidebar. A neighbourhood that contains everything says
  // nothing, and it buried the one real entry point under the furniture.
  const screens = ["/a", "/b", "/c", "/d", "/orders"]
  const edges = [
    ...screens.map((from) => ({ from, label: "Orders", to: "/orders" })), // the sidebar
    { from: "/quotes", label: "Convert to order", to: "/orders" }, // the one that matters
  ]
  const { near, hidden } = neighbours(edges, [{ route: "/orders" }], screens.length)
  assert.deepEqual(near.map((n) => n.route), ["/quotes"])
  assert.equal(hidden, 4)
})

test("a change that names no screen says so — it is a finding, not an empty result", () => {
  // The failure this package exists to catch is a feature landing where nobody
  // looked. A change whose text names no screen either touches no UI, or nobody
  // wrote down where it goes; printing nothing would hide the second.
  const dir = atlas({ "orders.md": page("/orders") })
  const out = buildContext({ atlasDir: dir, changeDir: change("Refactor the mailer queue."), changeName: "x" })
  assert.match(out, /names no screen in the atlas/)
  assert.match(out, /nobody wrote down where it lands/)
})

test("the cap on picked screens is ANNOUNCED, with the routes it dropped", () => {
  const files = {}
  for (const r of ["a", "b", "c"]) files[`${r}.md`] = page(`/${r}`)
  const dir = atlas(files)
  const out = buildContext({ atlasDir: dir, changeDir: change("Touches /a and /b and /c."), changeName: "x", top: 2 })
  assert.match(out, /2 of 3 screens/)
  assert.match(out, /1 further page\(s\) also matched/)
})

test("a stale page carries its warning INTO the planning context", () => {
  // A page marked stale by a failed recording is exactly the page a planner must
  // not read as current — and this is the one place it gets read without its
  // filename in sight.
  const dir = atlas({ "orders.md": page("/orders", "stale_reason: ariaSnapshot did not settle\n") })
  const out = buildContext({ atlasDir: dir, changeDir: change("Touches /orders."), changeName: "x" })
  assert.match(out, /This page is STALE/)
  assert.match(out, /ariaSnapshot did not settle/)
})

test("--files works where there is no change at all", () => {
  // Reported by the consumer 2026-08-04: most of their fixes are conformance
  // repair and run deliberately without a proposal, so `--change` has nothing to
  // read — while that is exactly where the failure class bites, because a bug
  // report describes what ONE screen shows and the fix belongs to the class.
  // A file list is always available; a change is not.
  const dir = atlas({ "orders.md": page("/orders", "source: src/app/orders/page.tsx\n"), "other.md": page("/other") })
  const out = buildContext({ atlasDir: dir, changeName: "2 changed file(s)", text: "src/app/orders/page.tsx\nsrc/lib/mailer.ts" })
  assert.match(out, /`\/orders`/)
  assert.match(out, /it references `src\/app\/orders\/page\.tsx`/)
  assert.equal(/## `\/other`/.test(out), false, "a page nothing points at stays out")
})
