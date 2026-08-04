// Scratch inspector — prints the reconstructed region tree for one screen so we
// can check it against the screenshot before anything is built on top of it.
//
//   node research/inspect.mjs rendelesek

import fs from "node:fs"
import path from "node:path"
import { regionTree, subtree, controlsIn, isScroller } from "./lib/regions.mjs"

const slug = process.argv[2] ?? "rendelesek"
const dir = path.join(import.meta.dirname, "corpus", slug)
const nodes = JSON.parse(fs.readFileSync(path.join(dir, "nodes.json"), "utf8"))
const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"))

const label = (n) => {
  const bits = [`${n.tag}${n.role ? `[${n.role}]` : ""}`]
  if (n.testid) bits.push(`#${n.testid}`)
  if (n.name) bits.push(`"${n.name.slice(0, 40)}"`)
  return bits.join(" ")
}

const print = (t, indent = 0) => {
  const n = t.node
  const ids = subtree(nodes, n.i)
  const ctrls = controlsIn(nodes, ids)
  const pad = "  ".repeat(indent)
  console.log(
    `${pad}▸ ${label(n)}${t.escaped ? ` (+${t.escaped} kívül)` : ""}  [${n.x},${n.y} ${n.w}×${n.h}] ${n.dsp}${n.fd && n.dsp.includes("flex") ? "/" + n.fd : ""}` +
      `${isScroller(n) ? ` ⇅scroll ${n.sh}px tartalom` : ""}${t.inset ? ` ⬌${t.inset.inner}/${t.inset.outer} középre` : ""}${t.repeat ? ` ×${t.repeat} ISMÉTLŐDŐ` : ""}${t.overlay ? " ⬒OVERLAY" : ""}  · ${ctrls.length} kontroll`
  )
  for (const c of t.children) print(c, indent + 1)
}

console.log(`\n${meta.title} — ${meta.url}  (${meta.archetype})`)
console.log(`viewport ${meta.viewport.w}×${meta.viewport.h} · oldalmagasság ${meta.pageHeight} · ${meta.nodeCount} node\n`)
print(regionTree(nodes))
