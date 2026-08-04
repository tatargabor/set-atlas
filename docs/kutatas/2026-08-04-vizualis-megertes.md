---
title: Mennyit ér egy MD-leírás egy képernyőképhez képest — mérés
status: kész
created: "2026-08-04"
updated: "2026-08-04"
---

# Mennyit ér egy MD-leírás egy képernyőképhez képest

**A kérdés:** a set-atlas ma egy lapos ARIA-fát ír le képernyőnként. Egy tervező-ágens
ebből nem tudja megmondani, hogy két gomb egy hasábban van-e, hány panelre oszlik az
oldal, vagy hogy egy elem egyáltalán látszik-e görgetés nélkül. Milyen szöveges formátum
viszi a modellt a legközelebb ahhoz, mintha látná a képernyőt — és mennyi tokenért?

**A válasz:** a **régió-fa** (S3). 46 kérdésből 44 (96%), 4 480 tokenen — a mai formátum
fele áráért és kilenc ponttal pontosabban. **A képernyőképet is megveri** (43/46).

---

## 1. Az eredmény

| kar | találat | arány | token (6 képernyő) | token/találat |
|---|---|---|---|---|
| **S3 · régió-fa szerepcímkékkel** | **44/46** | **96%** | **4 480** | **102** |
| S5 · JSX-szerű layout-DSL | 44/46 | 96% | 6 172 | 140 |
| a képernyőkép *(referencia-plafon)* | 43/46 | 93% | ~9 600¹ | 223 |
| S2 · ASCII wireframe + régiólisták | 43/46 | 93% | 8 200 | 191 |
| S1 · geometria-annotált fa | 42/46 | 91% | 6 782 | 161 |
| **S0 · a mai lapos aria-dump** | **40/46** | **87%** | **9 081** | **227** |

¹ A kép nem szöveg-token: 3200×2000 PNG ≈ 1 600 kép-token darabonként, becsülve. Nem
összevethető a szöveges költséggel, csak nagyságrendként szerepel.

**A mai formátum az utolsó helyen áll, és egyben a legdrágább.**

### Kérdéstípusonként — hol nyer és hol veszít a szerkezet

| típus | kép | S0 ma | S1 geo | S2 wire | S3 régió | S5 DSL |
|---|---|---|---|---|---|---|
| `same-column` — egy hasábban van-e A és B | 12/12 | 11/12 | 11/12 | 12/12 | 12/12 | 11/12 |
| `co-visible` — látszik-e együtt görgetés nélkül | 11/11 | 11/11 | 10/11 | 11/11 | 11/11 | 11/11 |
| `quadrant` — melyik képernyőnegyedben van | 6/6 | 5/6 | 6/6 | 4/6 | 5/6 | 5/6 |
| **`column-count` — hány egymás melletti hasáb** | 4/6 | **3/6** | **6/6** | **6/6** | 5/6 | **6/6** |
| `list-scale` — hány elemű a fő lista | 3/3 | 2/3 | 2/3 | 3/3 | 3/3 | 3/3 |
| `primary-action` — melyik az elsődleges gomb | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |
| `scroll-overrun` — hányszoros a tartalom | 3/4 | 4/4 | 3/4 | 3/4 | 4/4 | 4/4 |

Három dolog olvasható ki:

1. **A hasábszám az egyetlen kérdés, ahol a mai formátum érdemben leszakad** (3/6 a
   6/6-hoz képest). Ez nem véletlen: a hasáb az egyetlen kérdezett tulajdonság, aminek
   **nincs ARIA-szerepe**. Egy oszlop a képernyőolvasónak nem jelent semmit, a tervezőnek
   viszont mindent.
2. **Az elsődleges gombot mindenki eltalálja, formátumtól függetlenül** (4/4 hatszor). A
   „melyik a fő művelet" kérdést a *szemantika* dönti el, nem a pixel — a `Jóváhagyás` és
   a `Mentés` a nevéből felismerhető. Ide **nem kell** vizuális jel.
3. **Az együtt-láthatóságot már a mai formátum is hozza** (11/11) — de rossz okból: a
   futtatások indoklása szerint a modell a listahosszból *következtetett*, nem tudta. Ahol
   a becslés félrevihet, ott téved: a `/penzugy` listaméretét 10–50 közé tippelte a
   valódi 124 helyett.

---

## 2. Amit a kép sem tud

A képernyőkép **nem plafon**, csak egy erős kar. Három hibája volt:

| képernyő | kérdés | a kép válasza | valóság |
|---|---|---|---|
| `/cikktorzs/[id]` | hány hasáb | 4 | 1 |
| `/` | hány hasáb | 4 | 3 |
| `/ajanlatok/new` | hányszoros a görgethető tartalom | 3–15× | **59×** |

Az első kettő ugyanaz a tévedés: **egy űrlap négyoszlopos mezőrácsát a kép nézője
oldalszintű hasábnak olvassa.** A harmadik elvi korlát: a hajtás alatti tartalom
mennyiségét egy állókép nem mutatja meg — a `/ajanlatok/new` partnerlistájában 18 866
pixelnyi tartalom van egy 318 pixeles keretben, és ez a képen sehogy nem látszik.

**Ebből következik, hogy a generált leírás nem „a kép pótléka".** Vannak tények (görgetési
mélység, pontos elemszám), amiket **csak** a generált leírás hordoz.

---

## 3. Válasz a kódnyelv-kérdésre

> *„megnézhetjük hogy van-e olyan nyelv pl JS ami segít a leírásban md helyett"*

A JSX-szerű DSL (S5) **pontosan ugyanannyit talált el, mint a régió-fa (44/46), de 38%-kal
több tokenből** (6 172 vs 4 480). A `<Panel w={480} layout="oszlopban">` alak nem visz
közelebb és nem is visz félre — a szintaxis pusztán ráfizetés. Amit a modell használ, az a
**tartalmazási hierarchia és a méret**; hogy ez `▸ panel [480×629]` vagy
`<Panel w={480} h={629}>` alakban áll, nem számít.

⚠ Egy dologban mégis érdemes megjegyezni: a DSL-kar volt az egyetlen a geometriát vivők
közül, amelyik a `/ajanlatok/new`-on ugyanazt a hibát követte el, mint a mai lapos
formátum (`hasab-kulon` = IGEN a helyes NEM helyett). Az indoklás elárulja, miért: a
`layout="oszlopban"` propot úgy olvasta, hogy *minden* gyerek egy hasábban van — a
JSX-forma **állításnak** látszik ott, ahol a régió-fa csak méretet közöl. Egy kódszerű
leírás magabiztosabb következtetésre csábít, mint amennyit alátámaszt.

---

## 4. A módszer

**Miért nem én pontoztam.** A ground truth **geometriából számolt**, nem ítélt: a
„hasábban van-e" x-intervallum-átfedés, az „együtt látszik-e" befoglaló téglalap a
látómezőben, a „hányszoros a tartalom" `scrollHeight/clientHeight`. Így a képernyőkép is
csak egy versenyző, nem a bíró.

**Vak futtatás.** 6 kar × 6 képernyő = 36 izolált kontextus, mindegyik **egyetlen** fájlt
látott: vagy a formátumot, vagy a képet. A válaszkulcsra egyik sem hivatkozott.

**Egy pillanat.** A képernyőkép, az ARIA-fa és a geometria **ugyanabban a másodpercben**
készült (`research/capture-corpus.mjs`). A kézikönyv meglévő PNG-i más adatállapotban
készültek, mint a `docs/atlas/` — azok párosítása a sodródást mérte volna, nem a formátumot.

**A hat képernyő hat archetípus:** három-hasábos master-detail (`/rendelesek`), látszólag
egyszerű űrlap adat-dömpinggel (`/ajanlatok/new`), kártyarács (`/`), fülezett részletlap
(`/cikktorzs/[id]`), nagy táblázat (`/penzugy`), szekcionált beállítás-lap (`/beallitasok`).

### A benchmark kétszer bukott meg, és a futtatások fogták meg

Ez a mérés legfontosabb módszertani tapasztalata. **Ha hat, egymásról nem tudó olvasó
egyöntetűen mást mond, mint a válaszkulcs, akkor a kulcs a hibás.** Kétszer fordult elő:

1. **A hasábszám első definíciója** bármely két egymás melletti dobozt hasábnak vett, így
   egy eszköztár (balra cím, jobbra két gomb) a `/penzugy`-t „2 hasábossá" tette. Mind a
   hat kar 1-et mondott, a képet néző is. Javítva: egy hasáb **abszolút értelemben magas**
   (≥150px); egy eszköztár két fele 32 és 48 pixel.
2. **Az első javítás elrontotta a másik irányt:** az „minden hasáb töltse ki a konténer
   felét" szabály kidobta a `/beallitasok` 596 pixeles navigációs hasábját az 1371 pixeles
   tartalom mellől — pedig mind a hat kar hasábnak látta, és az is.

Mindkét hibás kulcs a `research/build-benchmark.mjs`-ben, kommenttel és a méréssel együtt
maradt bent, hogy ne lehessen visszacsinálni.

---

## 5. Amit közben találtunk — élő adatszivárgás az atlaszban

A `/ajanlatok/new` atlaszlapja **5 640 token volt, az egész atlasz 20%-a**, és ~340 sorban
**valódi partnernevek és email-címek** sorakoztak benne. A `DATA_LIKE` regex csak dátumot,
összeget és azonosítót ismert, a „Név email@cím" mintát nem.

A képernyőkép azonnal megmutatta, hogy a felület valójában triviális: cím + keresőmező +
görgethető lista + két gomb. **A kép megmutatta, amit az MD elrejtett** — és ez egy olyan
repóban történt, aminek a CLAUDE.md-je tiltja a nyers atlasz-output publikálását.

Javítva: `EMAIL_LIKE` a hosszkapu **előtt** fut (`. foo@bar.hu` 19 karakter és mégis ügyfél).
Bukó teszt előbb, a méréssel a kommentben — `test/compress.test.mjs`.

A felvett nyers aria-fán mérve: **5 640 → 402 token (93%)**, bennmaradt email-cím: **0**.
A lap valódi szerkezete végre kilátszik a zaj alól.

---

## 6. Korlátok — ne olvasd többnek, mint amennyi

1. **Hat képernyő, egy alkalmazás, egy adatállapot.** 46 kérdés. A 96% és a 87% közti
   különbség 4 találat; egy másik alkalmazáson más lehet a sorrend.
2. **Cellánként egyetlen futtatás.** Nincs ismétlés, tehát **nincs szórásbecslés**. A 44 és
   a 43 közti különbség önmagában nem szignifikáns; a 44 és a 40 közti már irányt mutat.
3. **A `quadrant` kérdésen mind a hat kar ugyanúgy hibázott a `/rendelesek`-en**
   (felső-bal a felső-jobb helyett). Egyik formátum sem mondja meg, hogy egy elem egy
   sávon **belül** hol áll. Ez valódi, még nyitott rés — nem a mérés hibája.
4. **A szerver-oldali hatókör továbbra is láthatatlan.** Egyik formátum sem lát `where`
   feltételt. Az atlasz irányt mutat, nem bizonyít.
5. **A korpusz nem publikálható:** éles adatmásolatból készült. `research/corpus/` és
   `research/runs/` gitignore-olt, idézet csak redaktálva.

---

## 7. Következtetés a set-atlas formátumára

**A `map:` blokk lapos ARIA-YAML helyett régió-fa legyen.** Amit a nyertes formátum ad, és
a mai nem:

- **régiónkénti tagolás** tartalmazással (melyik panel melyiket fogja)
- **méret** minden régión (`[319×761]`) — ebből jön a hasáb- és a negyed-kérdés
- **görgetési tény** (`⇅ 24914px tartalom 761px keretben`) — ez a mai formátumból teljesen hiányzik
- **ismétlődés-szám** régió szinten (`ismétlődő elem ×257`), nem csak sorszinten
- **overlay-jelölés** (a legördülő a mögötte lévő tartalom fölé nyílik)
- **szerepcímke bizonyítékkal** (`táblázat (127 sor)`, `görgethető lista`)

⚠ **Amit NEM szabad átvenni:** koordinátákat (`@ 64,204`) a régió-fa nem tartalmaz, és
mégis ez a legpontosabb kar. A geometria-annotált fa (S1), ami minden elemre kiírja a
dobozt, **rosszabb** lett (42/46) és 51%-kal drágább. A nyers szám zaj; a **méret és a
tartalmazás** a jel.

A megvalósítás a `research/lib/regions.mjs`-ben már működik mind a hat archetípuson. A
`src/`-be emeléshez kell: `boundingBox`-felvétel a `capture.mjs`-be, a régió-rekonstrukció
átemelése, és minden mai teszt zöldben tartása.

---

## 8. Utómérés — a vizuális réteg (ugyanaznap, az éles bevezetés után)

A 6. pont két nyitott résére (`panel` gyűjtőcímke, negyed-kérdés) készült egy **cenzus a 33
valós lapon**, nem a hat archetípuson. Amit talált:

| lelet | szám |
|---|---|
| a régiók hányada névtelen `panel` | **48%** (285/590) |
| ezekben **nulla** kontroll | 64% (185/285) |
| „toolbar strip", amiben nincs egyetlen kontroll sem | **40%** (80/198) |
| régió, ami saját **címet** hordoz — és a térkép eldobta | **74** (12%) |
| kontroll, cím, gyerek és figyelmeztetés nélküli régió (tiszta zaj) | 25 |

⚠ **A címek elvesztése visszalépés volt, amit ugyanaznap én okoztam.** A lecserélt lapos
formátum kiírta a `heading "Bejövő rendelések"` sorokat; az első régió-fa **egyet sem**. Pont
azokat a szekciónevet, amikre a „hova kerüljön?" kérdés támaszkodik.

Három javítás ebből, plusz a negyed-kérdésre a **pozíció-jelölés** (`[right]`, `[centre]` —
a bal az alapértelmezett, jelöletlen) és a **layout-irány** (`row` / `column` / `grid`).

**Vak újramérés, ugyanaz a kérdéssor, két kar:**

| | találat | token |
|---|---|---|
| **régió-fa + vizuális réteg** | **48/49 (98%)** | 5 109 |
| régió-fa vizuális réteg nélkül | 46/49 (94%) | 4 516 |

+2 találat +13% tokenért, és a nyereség pont ott van, ahol a rés volt:

- `quadrant` **6/6** (volt 5/6) — a `/rendelesek` kérdés, amit korábban **mind a hat kar
  elrontott, a képernyőképet néző is**, most helyes. A `[right]` jelölés adta.
- `column-count` **6/6** (volt 5/6) — a `/cikktorzs/[id]` űrlaprácsáról a `[centre]`/`[right]`
  jelölésekből kiderült, hogy nem oldalszintű hasáb.

**98% az eddigi legmagasabb érték** — a képernyőkép 93%-a fölött.

⚠ A `panel` gyűjtőcímke **nem** tűnt el; a cenzus szerint 48%-ról indult, és a javítások a
címzett régiókat nevezik meg, nem a maradékot. A névtelen konténerek nagy része valóban csak
konténer. Ez nyitott marad.

---

## Hogyan futtasd újra

```bash
cd ~/code/consumer-a && pnpm dev          # kell futó app + DB + login
cd ~/code/set-atlas
node research/capture-corpus.mjs               # kép + aria + geometria egy pillanatban
node research/build-benchmark.mjs              # a válaszkulcs geometriából
node research/build-variants.mjs               # a hat formátum + token-költség
node research/build-prompts.mjs                # 36 vak feladatlap
#   … a 36 futtatás izolált kontextusokban, a válaszok research/answers/-be …
node research/score.mjs                        # a táblák
node research/score.mjs --misses               # minden tévedés a helyes válasszal
```
