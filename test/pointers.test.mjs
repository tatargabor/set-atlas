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
