/*  check-exports.js — validate the OBJ/MTL/glTF exporters headless (Node).
 *
 *      npm install && node check-exports.js
 *
 *  Loading check-model.js runs the full smoke test first and leaves the
 *  engine hooks on globalThis (__unitModel for exporters, __checkApi for
 *  plan selection). This script then builds every export format for every
 *  plan and checks:
 *
 *    · glTF — full structural validation via the Khronos gltf-validator
 *    · OBJ  — geometry sanity: vertices, faces, named objects, mtllib ref
 *    · MTL  — every material the OBJ uses is defined
 *
 *  Exits nonzero on any failure, so CI can gate on it.
 */
'use strict';

/* Order matters: gltf-validator's Dart runtime sniffs for a browser at load
 * time, and check-model.js installs browser shims (window, document). Load
 * the validator first, while this is still recognisably Node. */
const { validateBytes } = require('gltf-validator');

require('./check-model.js');       // runs the smoke test, installs the hooks

const um  = globalThis.__unitModel;
const api = globalThis.__checkApi;
if (!um || !api) throw new Error('check-exports: engine hooks not found');

async function checkPlan(id, name) {
  let bad = 0;
  api.selectPlan(id);
  console.log('── ' + name + ' (' + id + ') ──');

  /* ── OBJ sanity ── */
  const obj = um.buildOBJ();
  const vCount = (obj.match(/^v /gm) || []).length;
  const fCount = (obj.match(/^f /gm) || []).length;
  const oCount = (obj.match(/^o /gm) || []).length;
  /* Not just "some mtllib line exists" — that is what this asserted while the
   * OBJ pointed at apartment.mtl and exportOBJ() wrote <plan>.mtl, so every
   * export imported with no materials and this test stayed green. The name
   * has to be the file the exporter actually downloads beside it. */
  const mtllib = (obj.match(/^mtllib (.+)$/m) || [])[1];
  const wantMtl = id + '.mtl';                    // exportOBJ(): grab(U.id + '.mtl', …)
  console.log(`  OBJ : ${vCount} vertices, ${fCount} faces, ${oCount} named objects, mtllib=${mtllib}`);
  if (vCount < 8 || fCount < 6 || oCount < 1) {
    console.error('  *** OBJ export looks degenerate'); bad++;
  }
  if (mtllib !== wantMtl) {
    console.error(`  *** mtllib is "${mtllib}" but the .mtl is written as "${wantMtl}" — materials will not load`);
    bad++;
  }

  /* ── MTL covers every usemtl ── */
  const mtl = um.buildMTL();
  const used    = new Set((obj.match(/^usemtl (.+)$/gm) || []).map(l => l.slice(7).trim()));
  const defined = new Set((mtl.match(/^newmtl (.+)$/gm) || []).map(l => l.slice(7).trim()));
  const missing = [...used].filter(m => !defined.has(m));
  console.log(`  MTL : ${defined.size} materials defined, ${used.size} used${missing.length ? ', MISSING: ' + missing.join(', ') : ''}`);
  if (missing.length) { console.error('  *** OBJ uses undefined materials'); bad++; }

  /* ── glTF structural validation ── */
  const gltf = um.buildGLTF();
  const report = await validateBytes(new Uint8Array(Buffer.from(gltf)));
  const { numErrors, numWarnings } = report.issues;
  console.log(`  glTF: validator errors=${numErrors} warnings=${numWarnings}`);
  if (numErrors > 0) {
    report.issues.messages.filter(m => m.severity === 0)
      .slice(0, 10).forEach(m => console.error('    ', m.code, m.message, m.pointer || ''));
    bad++;
  }
  return bad;
}

async function main() {
  console.log('\n══ export validation ══');
  let failures = 0;
  for (const p of api.plans()) failures += await checkPlan(p.id, p.name);
  console.log(failures ? `\n*** check-exports: ${failures} FAILURE(S)` : '\ncheck-exports: clean.');
  if (failures) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
