// Regression tests for the pointer layer.
// Run:  node --test
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { collectComponents, collectServerActions, buildPointers } from "../src/pointers.mjs"

let root

// A miniature Next.js app:
//
//   page.tsx  ──imports──▶ order-list.tsx ──imports { updateStatus }──▶ order-actions.ts
//                    │                    ──imports──▶ deep-panel.tsx ──▶ rare-actions.ts
//                    └──imports──▶ unrelated.ts
//
// `order-actions.ts` also exports `neverImported`, which no component pulls in.
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-pointers-"))
  const write = (rel, body) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), body)
  }

  write("package.json", "{}")
  // A four-line redirect stub and the page it redirects to — the shape that
  // produced the wrong `source:` on the consumer.
  write("src/app/quotes/page.tsx", `import { redirect } from "next/navigation"
     export default function Page() { redirect("/orders?phase=quotes") }`)
  write(
    "src/app/orders/page.tsx",
    `import { OrderList } from "@/components/order-list"
     import { helper } from "@/lib/unrelated"
     export default function Page() { return <OrderList /> }`
  )
  write(
    "src/components/order-list.tsx",
    `import { updateStatus, approveOrder } from "@/lib/order-actions"
     import type { OrderListItem } from "@/lib/order-actions"
     import { type PartnerOption, listPartners } from "@/lib/order-actions"
     import { DeepPanel } from "@/components/deep-panel"
     export function OrderList() { return null }`
  )
  write(
    "src/components/deep-panel.tsx",
    `import { archiveOrder } from "@/lib/rare-actions"
     export function DeepPanel() { return null }`
  )
  write(
    "src/lib/order-actions.ts",
    `"use server"
     export async function updateStatus() {}
     export async function approveOrder() {}
     export async function listPartners() {}
     export async function neverImported() {}
     export type OrderListItem = { id: string }
     export type PartnerOption = { id: string }`
  )
  write("src/lib/rare-actions.ts", `"use server"\nexport async function archiveOrder() {}`)
  write("src/lib/unrelated.ts", `export function helper() {}`)
})

after(() => fs.rmSync(root, { recursive: true, force: true }))

const config = () => ({ root, appDir: "src/app", alias: { "@/": "src/" } })

test("REGRESSION: an action a screen never imports is NOT listed", () => {
  // The first version listed every export of every reachable "use server"
  // module. Measured on a real app: /orders and /orders/[id] produced the same
  // ~130-entry list, from which no entry-point claim could be made.
  const components = collectComponents("src/app/orders/page.tsx", config())
  const actions = collectServerActions(components, config())
  const names = actions.map((a) => a.name)

  assert.ok(names.includes("updateStatus"), "an imported action is missing")
  assert.ok(names.includes("approveOrder"), "an imported action is missing")
  assert.ok(
    !names.includes("neverImported"),
    "an action nobody imports was listed — this is the ~130-entry bug"
  )
})

test("REGRESSION: type imports are not mistaken for actions", () => {
  // Measured 2026-08-04 on a real app: `import type { … }` and the inline
  // `{ type Foo, bar }` form both leaked type names into the action list —
  // five of them occupied the 14-slot cap on /rendelesek and pushed real
  // actions out of the output entirely.
  const components = collectComponents("src/app/orders/page.tsx", config())
  const names = collectServerActions(components, config()).map((a) => a.name)

  assert.ok(!names.includes("OrderListItem"), "a whole-clause type import leaked in")
  assert.ok(!names.includes("PartnerOption"), "an inline type specifier leaked in")
  assert.ok(names.includes("listPartners"), "the real action next to the inline type was lost")
})

test("REGRESSION: depth separates direct actions from buried ones", () => {
  const components = collectComponents("src/app/orders/page.tsx", config())
  const actions = collectServerActions(components, config())

  const direct = actions.find((a) => a.name === "updateStatus")
  const buried = actions.find((a) => a.name === "archiveOrder")

  assert.equal(direct.depth, 1, "an action of a directly imported component should be depth 1")
  assert.ok(buried.depth > 1, "an action two hops away must not look direct")
})

test("REGRESSION: truncation is always announced", () => {
  // A silently cut list is worse than a long one: the reader believes they saw
  // everything. The earlier version sliced components at 12 with no marker.
  //
  // Asserted as an INVARIANT (shown + announced == total), not against fixed
  // counts — a count-based version broke the moment the fixture grew, which
  // teaches the next maintainer to edit the number instead of the code.
  const full = buildPointers({ pattern: "/orders" }, config())
  const cut = buildPointers({ pattern: "/orders" }, config(), { maxDirect: 1, maxComponents: 1 })

  assert.equal(cut.actions.length, 1, "the cap must be honoured")
  assert.equal(
    cut.actions.length + (cut.actions_more ?? 0),
    full.actions.length + (full.actions_more ?? 0),
    "shown + announced must equal the full direct-action count"
  )
  assert.equal(cut.components.length, 1)
  assert.equal(
    cut.components.length + (cut.components_more ?? 0),
    full.components.length + (full.components_more ?? 0),
    "shown + announced must equal the full component count"
  )
  assert.equal(
    cut.actions_indirect,
    full.actions_indirect,
    "the indirect count is scope, not a cap — it must not move with the cap"
  )
  assert.ok(full.actions_indirect > 0, "the fixture must actually have a deeper action")
})

test("the page itself is `source`, not one of its own components", () => {
  const components = collectComponents("src/app/orders/page.tsx", config())
  assert.ok(
    !components.some((c) => c.file.endsWith("app/orders/page.tsx")),
    "the page listed itself as a component"
  )
})

test("a missing source file degrades gracefully", () => {
  const p = buildPointers({ pattern: "/does-not-exist" }, config())
  assert.equal(p.source, null)
  assert.deepEqual(p.actions, undefined)
})

test("non-server modules never contribute actions", () => {
  const components = collectComponents("src/app/orders/page.tsx", config())
  const actions = collectServerActions(components, config())
  assert.ok(!actions.some((a) => a.name === "helper"), "a plain export was treated as a server action")
})

test("REGRESSION: a route that redirects points at the file that DREW the screen", () => {
  // Reported by the consumer agent 2026-08-04. `/ajanlatok` is four lines —
  // `redirect("/rendelesek?fazis=quotes")` — so the UI on that atlas page is the
  // TARGET's, while `source:` pointed at the stub. `source:` is the one line a
  // reader uses to jump from the map to the code, and this sent them somewhere
  // with nothing in it.
  //
  // ⚠ And it failed in the REASSURING direction: the field was present and
  // well-formed, so it looked like the source was known. A wrong pointer that
  // looks right is worse than a missing one.
  const stub = buildPointers({ url: "/quotes", pattern: "/quotes" }, { root })
  assert.equal(stub.source, "src/app/quotes/page.tsx")
  assert.deepEqual(stub.components, [], "the stub imports nothing — that is the tell")

  const followed = buildPointers({ url: "/quotes", pattern: "/quotes", redirectedTo: "/orders?phase=quotes" }, { root })
  assert.equal(followed.source, "src/app/orders/page.tsx")
  assert.ok(followed.components.length, "and now the real page's components come with it")
})

test("a redirect to a path with no page file falls back, rather than losing the pointer", () => {
  const out = buildPointers({ url: "/quotes", pattern: "/quotes", redirectedTo: "/nowhere" }, { root })
  assert.equal(out.source, "src/app/quotes/page.tsx")
})

test("REGRESSION: a route-local client component is a component, wherever it sits", () => {
  // Reported by the consumer 2026-08-04, measured on their tree: `components:`
  // listed only files under `components/`, so `src/app/rendelesek/rendelesek-client.tsx`
  // — ~7000 lines, with a ~40-line page.tsx that only wraps it — appeared on no
  // page at all. `context --files` then answered "no screen" for the single most
  // edited UI file in the app.
  //
  // ⚠ Wrong in the reassuring direction again: "no screen" reads as "this change
  // has no surface", which is the exact question the tool exists to ask.
  //
  // The rule is the extension, not the directory: a .tsx the page imports draws
  // something. Measured on three of their pages, everything the old filter
  // dropped besides these was .ts — actions and lib, which belong to `actions:`.
  const local = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-local-"))
  const w = (rel, body) => {
    fs.mkdirSync(path.join(local, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(local, rel), body)
  }
  w("package.json", "{}")
  w("src/app/orders/page.tsx", `import { OrdersClient } from "./orders-client"\n     import { db } from "@/lib/prisma"\n     export default function Page() { return <OrdersClient /> }`)
  w("src/app/orders/orders-client.tsx", `import { Dialog } from "./credit-dialog"\n     export function OrdersClient() { return <Dialog /> }`)
  w("src/app/orders/credit-dialog.tsx", `export function Dialog() { return null }`)
  w("src/lib/prisma.ts", `export const db = {}`)

  const out = buildPointers({ url: "/orders", pattern: "/orders" }, { root: local })
  assert.ok(out.components.includes("src/app/orders/orders-client.tsx"), "the client the page wraps")
  assert.ok(out.components.includes("src/app/orders/credit-dialog.tsx"), "and what it renders in turn")
  assert.equal(out.components.includes("src/lib/prisma.ts"), false, "a .ts is logic — that is what `actions:` is for")
  // The nearest files first: with the cap at 12, a depth-1 client must not be
  // pushed out of the list by depth-2 shared components.
  assert.equal(out.components[0], "src/app/orders/orders-client.tsx")
})
