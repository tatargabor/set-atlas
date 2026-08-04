// Scores the blind runs against the computed ground truth.
//
//   node research/score.mjs            # the tables
//   node research/score.mjs --misses   # every wrong answer, with the truth

import fs from "node:fs"
import path from "node:path"
import { estimateTokens } from "./lib/variants.mjs"

const HERE = import.meta.dirname
const benchmark = JSON.parse(fs.readFileSync(path.join(HERE, "benchmark.json"), "utf8"))
const ARMS = process.env.ARMS ? process.env.ARMS.split(",") : ["screenshot", "aria-flat", "geo-tree", "wireframe", "region-tree", "jsx-dsl", "hybrid"]
const LABEL = {
  "region-pos": "vizuális réteggel",
  "region-nopos": "vizuális réteg nélkül",
  // ⚠ Was labelled "a kép (plafon)" until the 2026-08-04 run measured it: the
  // picture alone ties the coordinate-free region tree at 55/59 and loses to the
  // hybrid, and it inverted BOTH designer questions on one screen. Not a ceiling.
  screenshot: "a kép önmagában",
  "aria-flat": "S0 lapos aria (ma)",
  "geo-tree": "S1 geometria-fa",
  wireframe: "S2 wireframe",
  "region-tree": "S3 régió-fa",
  "jsx-dsl": "S5 JSX-DSL",
  hybrid: "S6 fa + annot. kép",
}

const truth = new Map()
const typeOf = new Map()
for (const screen of benchmark.screens) for (const it of screen.items) (truth.set(it.id, it.answer), typeOf.set(it.id, it.type))

/**
 * Loose on wording, strict on meaning.
 *
 * The button-label question is free text, so "Mindent jóváhagy (1)" and
 * "Mindent jóváhagy" must count as the same answer — the count in the label is
 * data, not interface. Everything else is a closed choice and matches exactly.
 */
const normalise = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*/g, " ")
    .replace(/[.…"„"]/g, "")
    .replace(/\s+/g, " ")
    .trim()

const correct = (id, given) => {
  const want = normalise(truth.get(id))
  const got = normalise(given)
  if (!got) return false
  return typeOf.get(id) === "primary-action" ? got.includes(want) || want.includes(got) : got === want
}

// Items nobody was asked. Regenerating the key after the region walker's depth
// fix produced three new list-scale questions; scoring them would mark six arms
// wrong for a question they never saw. Excluded — and said out loud.
// ⚠ Per ARM, not globally. A later arm answered three questions the earlier
// arms never saw; a shared "asked" set would have marked those three wrong for
// six formats that were never given them.
const askedBy = new Map()
for (const file of fs.readdirSync(path.join(HERE, "answers"))) {
  const arm = file.split("__")[0]
  if (!askedBy.has(arm)) askedBy.set(arm, new Set())
  for (const id of Object.keys(JSON.parse(fs.readFileSync(path.join(HERE, "answers", file), "utf8")))) askedBy.get(arm).add(id)
}
const asked = { has: () => true }

const results = {}
const missing = []
for (const arm of ARMS) {
  results[arm] = { byScreen: {}, byType: {}, answered: 0, right: 0, tokens: 0 }
  for (const screen of benchmark.screens) {
    const file = path.join(HERE, "answers", `${arm}__${screen.slug}.json`)
    if (!fs.existsSync(file)) {
      missing.push(`${arm}/${screen.slug}`)
      continue
    }
    const given = JSON.parse(fs.readFileSync(file, "utf8"))
    let right = 0
    const items = screen.items.filter((it) => (askedBy.get(arm) ?? new Set()).has(it.id))
    for (const it of items) {
      const ok = correct(it.id, given[it.id])
      right += ok ? 1 : 0
      results[arm].byType[it.type] ??= { right: 0, total: 0 }
      results[arm].byType[it.type].total++
      results[arm].byType[it.type].right += ok ? 1 : 0
      if (!ok && process.argv.includes("--misses")) {
        console.log(`✗ ${arm.padEnd(12)} ${it.id.padEnd(28)} adott: ${String(given[it.id]).padEnd(22)} helyes: ${it.answer}`)
      }
    }
    results[arm].byScreen[screen.slug] = { right, total: items.length }
    results[arm].answered += items.length
    results[arm].right += right
    // The picture costs image tokens, not text tokens — a 3200×2000 PNG is
    // roughly 1.6k tokens at Claude's tiling. Reported, not compared as text.
    // The hybrid arm pays BOTH, which is the whole question about it: the
    // annotated picture has to be worth the 1.6k it adds to the region tree.
    const variantFile = path.join(HERE, "variants", arm, `${screen.slug}.md`)
    const IMAGE_TOKENS = 1600
    results[arm].tokens +=
      arm === "screenshot" ? IMAGE_TOKENS : estimateTokens(fs.readFileSync(variantFile, "utf8")) + (arm === "hybrid" ? IMAGE_TOKENS : 0)
  }
}

if (missing.length) console.log(`⚠ hiányzó futtatás: ${missing.join(", ")}\n`)

const TYPES = [...new Set(benchmark.screens.flatMap((s) => s.items.map((i) => i.type)))]

console.log("ÖSSZESÍTÉS\n")
console.log(["kar".padEnd(20), "találat".padStart(9), "arány".padStart(8), "token".padStart(8), "token/találat".padStart(15)].join(""))
for (const arm of ARMS) {
  const r = results[arm]
  if (!r.answered) continue
  console.log(
    [
      LABEL[arm].padEnd(20),
      `${r.right}/${r.answered}`.padStart(9),
      `${Math.round((r.right / r.answered) * 100)}%`.padStart(8),
      String(r.tokens).padStart(8),
      (r.right ? Math.round(r.tokens / r.right) : "—").toString().padStart(15),
    ].join("")
  )
}

console.log("\nKÉRDÉSTÍPUSONKÉNT\n")
console.log(["típus".padEnd(16), ...ARMS.map((a) => LABEL[a].slice(0, 11).padStart(13))].join(""))
for (const type of TYPES) {
  console.log(
    [
      type.padEnd(16),
      ...ARMS.map((a) => {
        const t = results[a].byType[type]
        return (t ? `${t.right}/${t.total}` : "—").padStart(13)
      }),
    ].join("")
  )
}

console.log("\nKÉPERNYŐNKÉNT\n")
console.log(["képernyő".padEnd(16), ...ARMS.map((a) => LABEL[a].slice(0, 11).padStart(13))].join(""))
for (const screen of benchmark.screens) {
  console.log(
    [
      screen.slug.padEnd(16),
      ...ARMS.map((a) => {
        const s = results[a].byScreen[screen.slug]
        return (s ? `${s.right}/${s.total}` : "—").padStart(13)
      }),
    ].join("")
  )
}
