// Renders every variant for every recorded screen and reports what each costs.
//
//   node research/build-variants.mjs                    # all
//   node research/build-variants.mjs wireframe rendelesek   # print one to stdout

import fs from "node:fs"
import path from "node:path"
import { VARIANTS, estimateTokens } from "./lib/variants.mjs"

const CORPUS = path.join(import.meta.dirname, "corpus")
const OUT = path.join(import.meta.dirname, "variants")
const SCREENS = ["rendelesek", "ajanlatok-new", "index", "cikktorzs-id", "penzugy", "beallitasok"]

const load = (slug) => ({
  nodes: JSON.parse(fs.readFileSync(path.join(CORPUS, slug, "nodes.json"), "utf8")),
  meta: JSON.parse(fs.readFileSync(path.join(CORPUS, slug, "meta.json"), "utf8")),
  aria: fs.readFileSync(path.join(CORPUS, slug, "aria.yaml"), "utf8"),
})

const [wanted, oneScreen] = process.argv.slice(2)
if (wanted && oneScreen) {
  console.log(VARIANTS[wanted].build(load(oneScreen)))
  process.exit(0)
}

fs.mkdirSync(OUT, { recursive: true })
const table = []
for (const slug of SCREENS) {
  const capture = load(slug)
  const row = { slug }
  for (const [name, variant] of Object.entries(VARIANTS)) {
    const text = variant.build(capture)
    fs.mkdirSync(path.join(OUT, name), { recursive: true })
    fs.writeFileSync(path.join(OUT, name, `${slug}.md`), text)
    row[name] = estimateTokens(text)
  }
  table.push(row)
}

const names = Object.keys(VARIANTS)
console.log(["képernyő".padEnd(15), ...names.map((n) => n.padStart(12))].join(""))
for (const row of table) console.log([row.slug.padEnd(15), ...names.map((n) => String(row[n]).padStart(12))].join(""))
console.log(["ÖSSZESEN".padEnd(15), ...names.map((n) => String(table.reduce((a, r) => a + r[n], 0)).padStart(12))].join(""))
