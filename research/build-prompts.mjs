// Assembles one self-contained task file per (arm × screen).
//
// The evaluator reads exactly one of these and nothing else. The answer key
// lives in benchmark.json, which is never referenced from a task file — a run
// that opens it is not blind, and the instructions say so out loud.
//
//   node research/build-prompts.mjs

import fs from "node:fs"
import path from "node:path"

const HERE = import.meta.dirname
const benchmark = JSON.parse(fs.readFileSync(path.join(HERE, "benchmark.json"), "utf8"))
const ARMS = process.env.ARMS ? process.env.ARMS.split(",") : ["aria-flat", "geo-tree", "wireframe", "region-tree", "jsx-dsl"]
const OUT = path.join(HERE, "prompts")

const RULES = `Egyetlen képernyőről kapsz leírást, és kérdéseket kell megválaszolnod róla.

SZABÁLYOK — ezek nélkül a mérés értéktelen:
- KIZÁRÓLAG az alábbi leírásból dolgozz. Ne nyiss meg semmilyen fájlt, ne futtass parancsot, ne keress a projektben.
- Ha a leírásból nem derül ki a válasz, akkor is TIPPELJ a megadott lehetőségek közül — de a magyarázatban írd oda, hogy tipp.
- A válaszod utolsó blokkja pontosan ez a formátum legyen, kérdésazonosítónként egy sor:

VALASZOK
<kérdés-azonosító> = <válasz>
...

A válasz a kérdésben felkínált lehetőségek egyike legyen, szó szerint (IGEN / NEM / egy szám / a felsorolt szöveges opciók egyike / egy gombfelirat).`

fs.rmSync(OUT, { recursive: true, force: true })

for (const screen of benchmark.screens) {
  const questions = screen.items.map((it) => `- \`${it.id}\` — ${it.question}`).join("\n")

  for (const arm of ARMS) {
    const body = fs.readFileSync(path.join(HERE, "variants", arm, `${screen.slug}.md`), "utf8")
    fs.mkdirSync(path.join(OUT, arm), { recursive: true })
    fs.writeFileSync(
      path.join(OUT, arm, `${screen.slug}.md`),
      [RULES, "", "---", "", "## A képernyő leírása", "", body, "", "---", "", "## Kérdések", "", questions, ""].join("\n")
    )
  }

  if (process.env.ARMS) continue
  // The ceiling arm gets the picture instead of a description.
  fs.mkdirSync(path.join(OUT, "screenshot"), { recursive: true })
  fs.writeFileSync(
    path.join(OUT, "screenshot", `${screen.slug}.md`),
    [
      RULES.replace(
        "KIZÁRÓLAG az alábbi leírásból dolgozz. Ne nyiss meg semmilyen fájlt, ne futtass parancsot, ne keress a projektben.",
        `KIZÁRÓLAG a képernyőképet nézd meg a Read eszközzel: \`${path.join(HERE, "corpus", screen.slug, "shot.png")}\` — semmilyen MÁS fájlt ne nyiss meg, ne futtass parancsot, ne keress a projektben.`
      ),
      "",
      "---",
      "",
      `## A képernyő`,
      "",
      `A kép a(z) \`${screen.url}\` oldalt mutatja, ${screen.viewport.w}×${screen.viewport.h} látómezőben (a PNG kétszeres nagyításban készült, tehát ${screen.viewport.w * 2}×${screen.viewport.h * 2} pixel).`,
      "",
      "---",
      "",
      "## Kérdések",
      "",
      questions,
      "",
    ].join("\n")
  )
}

const arms = [...ARMS, "screenshot"]
console.log(`${arms.length} kar × ${benchmark.screens.length} képernyő = ${arms.length * benchmark.screens.length} futtatás`)
console.log(`${benchmark.screens.reduce((a, s) => a + s.items.length, 0)} kérdés karonként · research/prompts/`)
