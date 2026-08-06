import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const CLI = path.join(import.meta.dirname, "..", "src", "cli.mjs")

/** A config just complete enough for the CLI to load and reach argument handling. */
function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "set-atlas-cli-"))
  fs.writeFileSync(
    path.join(root, "atlas.config.mjs"),
    'export default { baseUrl: "http://127.0.0.1:1", outDir: "atlas", routes: [], login: async () => {} }\n'
  )
  fs.mkdirSync(path.join(root, "atlas"))
  return root
}

const run = (root, args) => {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    return { code: 0, out: stdout, err: "" }
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? "" }
  }
}

test("REGRESSION: an unknown command fails loudly instead of recording everything", () => {
  // Reported by a consumer 2026-08-06, and it is the failure class this package is
  // named for, inside the package. Only `suspect` and `context` were handled as
  // `args[0]`; anything else fell through to the recording path. So
  //
  //     set-atlas capture /rendelesek
  //
  // did not fail — it silently started a FULL recording of every screen (~5 min,
  // needs the app, a database and a login) and dropped the path argument. The
  // caller believed one page had been refreshed.
  //
  // ⚠ They were teaching that spelling in three of their own docs, having assumed
  // it existed. Nothing contradicted them: no error, no warning, and a run that
  // looks like success. A loud failure is the minimum repair — it costs the caller
  // a second instead of five minutes and a wrong belief.
  const root = tmpProject()
  const { code, err } = run(root, ["capture", "/rendelesek"])

  assert.equal(code, 1, "an unknown command was accepted")
  assert.match(err, /capture/, "the error does not name what was rejected")
  assert.match(err, /suspect|context/, "the error does not say what IS accepted")
})

test("a flag-shaped first argument is not mistaken for a command", () => {
  // `set-atlas --config path.mjs` has a first argument too, and it is not a
  // command. Rejecting it would break the documented invocation.
  const root = tmpProject()
  const cfg = path.join(root, "atlas.config.mjs")
  const { code, err } = run(root, ["--config", cfg, "--check"])

  // It gets past argument handling and fails later, on Playwright not being
  // installed in the temp project — which is proof it was NOT rejected as unknown.
  assert.equal(code, 1)
  assert.doesNotMatch(err, /Unknown command/)
})
