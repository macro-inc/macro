#!/usr/bin/env bun
// S4 normative row generation, adapted to checked-in specs and recorder inventory.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  alsoFor,
  behs,
  divRows,
  exportStatus,
  famInfo,
  famOf,
  HEADER,
  idOverride,
  macText,
  nodeTests,
  OUT,
  privRows,
  RICH,
  RX_RUST,
  routeTests,
  S3,
  S7,
  s3NotPortedCite,
  s7Tests,
  s7Ticks,
  s8ByRow,
  snake,
  symOverride,
  syms,
  testTicks,
  ticks,
  upText,
  wordRe,
  XB_RUST,
} from './seed-plan';

// ---------- rows ----------
type Out = Record<(typeof HEADER)[number], string>;
const rows: Out[] = [];
const ids = new Map<string, string>();
const push = (r: Partial<Out>) => {
  // Ids are unique. A transformer list named in two S3 places is one row; any other clash
  // (an entry and a list with the same name) is qualified by kind.
  const prev = ids.get(r.id!);
  if (prev !== undefined) {
    if (prev === r.kind) return;
    r = { ...r, id: `${r.id}/${r.kind}` };
  }
  ids.set(r.id!, r.kind!);
  rows.push(
    Object.fromEntries(
      HEADER.map((h) => [h, String(r[h] ?? '').replace(/[\t\n]/g, ' ')])
    ) as Out
  );
};

// Packages aliased to Rust-backed modules in Tier B config 2 (§2.2, R2 list) plus core `lexical`.
const ALIASED = new Set([
  'lexical',
  '@lexical/list',
  '@lexical/link',
  '@lexical/table',
  '@lexical/code-core',
  '@lexical/code',
  '@lexical/code-prism',
  '@lexical/mark',
  '@lexical/rich-text',
  '@lexical/markdown',
  '@lexical/history',
  '@lexical/selection',
  '@lexical/utils',
  '@lexical/hashtag',
  '@lexical/clipboard',
  '@lexical/plain-text',
  '@lexical/overflow',
  '@lexical/text',
  '@lexical/offset',
  '@lexical/headless',
  '@lexical/html',
]);
const pkgDir = (pkg: string) =>
  `packages/${pkg === 'lexical' ? 'lexical' : 'lexical-' + pkg.replace('@lexical/', '').split('/')[0]}`;
const tierB = (pkg: string) => `tierb:core:${pkgDir(pkg)}/src/__tests__/unit`;

// 1. S2 exports (every row; re-export rows point at their origin).
for (const s of syms) {
  const id = `S2:${s.entry}:${s.sym}`;
  const reexport = /re-export of/.test(s.what);
  const base = {
    kind: 'sym',
    id,
    package: s.entry,
    class: s.cls,
    pri: s.pri,
    source: `S2:${s.line}`,
  };
  if (reexport) {
    const origin = /re-export of `?([^`\s)]+)/.exec(s.what)?.[1] ?? '';
    push({
      ...base,
      owner: `alias:${origin}`,
      gate: 'required',
      tier: 'shim',
      test_id: `exports.test.ts::${s.entry}/${s.sym}`,
      test_file: 'packages/lexical-wasm-shim/src/__tests__/exports.test.ts',
      also: `origin row S2:${origin}:${s.sym}`,
      milestone: 'M3',
    });
    continue;
  }
  const ov = symOverride.get(s.sym);
  const isType = /^type$/.test(s.kind);
  const isP0 = s.pri === 'P0';
  if (s.cls === 'VIEW') {
    // Types are checked by the type test; a VIEW value that Macro uses is js-by-design.
    const jsByDesign = isP0 && !isType && ALIASED.has(s.pkg);
    push({
      ...base,
      owner: s.target.startsWith('shim') ? 'shim' : 'view',
      gate: isType
        ? 'required'
        : jsByDesign
          ? 'ledger:js-by-design'
          : 'ledger:view-only',
      tier: ov ? ov.tier : isType ? 'types' : 'B',
      test_id: ov
        ? ov.tests.join(' + ')
        : isType
          ? `types.test-d.ts::${s.entry}/${s.sym}`
          : tierB(s.pkg),
      test_file: ov
        ? ''
        : isType
          ? 'packages/lexical-wasm-shim/src/__tests__/types.test-d.ts'
          : '',
      also: ov ? ov.src : '',
      milestone: 'M3',
    });
    continue;
  }
  const st = exportStatus(s.sym);
  const shimTarget = /^(shim-only|lexical_loro \(reference only\))/.test(
    s.target
  );
  if (isType && !ov) {
    // A type never executes: it is checked by the shim's type-equality test, whatever its owner.
    const towner =
      (st.st === 'mapped' || st.st === 'prose') && !shimTarget
        ? `rust:${s.target.split(/[ +]/)[0]}+shim-type`
        : 'shim-type';
    push({
      ...base,
      owner: towner,
      gate: 'required',
      tier: 'types',
      test_id: `types.test-d.ts::${s.entry}/${s.sym}`,
      test_file: 'packages/lexical-wasm-shim/src/__tests__/types.test-d.ts',
      also: st.at ? `owner ${st.at}` : '',
      milestone: 'M3',
    });
    continue;
  }
  let owner: string,
    gate = 'required',
    tier: string,
    test: string,
    file: string,
    ms = 'M1',
    also = st.at ? `owner ${st.at}` : '';
  if (st.st === 'na' || st.st === 'not-ported') {
    owner = 'upstream-js';
    gate =
      isP0 && ALIASED.has(s.pkg)
        ? `ledger:js-by-design(${st.at})`
        : `ledger:not-ported(${st.at})`;
    tier = ov ? ov.tier : 'B';
    test = ov ? ov.tests.join(' + ') : tierB(s.pkg);
    file = '';
    ms = 'M3';
    if (ov) also = [also, ov.src].filter(Boolean).join('; ');
  } else if (st.st === 'unmapped' && /^not-needed$/.test(s.target.trim())) {
    // S12 §4 owner `not-needed` (R2.1): upstream JS runs unchanged in Tier B, nothing ships.
    owner = 'upstream-js';
    gate =
      isP0 && ALIASED.has(s.pkg)
        ? 'ledger:js-by-design(S2:target)'
        : 'ledger:not-ported(S2:target)';
    tier = ov ? ov.tier : 'B';
    test = ov ? ov.tests.join(' + ') : tierB(s.pkg);
    file = '';
    ms = 'M3';
    if (ov) also = [also, ov.src].filter(Boolean).join('; ');
  } else if ((st.st === 'prose' || st.st === 'unmapped') && shimTarget) {
    owner = /reference/.test(s.target) ? 'reference' : 'shim';
    gate = owner === 'reference' ? 'ledger:not-ported(S2:target)' : 'required';
    tier = owner === 'reference' ? 'B' : isType ? 'types' : 'shim';
    test =
      owner === 'reference'
        ? tierB(s.pkg)
        : isType
          ? `types.test-d.ts::${s.entry}/${s.sym}`
          : `exports.test.ts::${s.entry}/${s.sym}`;
    file =
      owner === 'reference'
        ? ''
        : `packages/lexical-wasm-shim/src/__tests__/${isType ? 'types.test-d.ts' : 'exports.test.ts'}`;
    ms = 'M3';
  } else {
    owner =
      st.st === 'unmapped' ? 'unowned' : `rust:${s.target.split(/[ +]/)[0]}`;
    if (st.st === 'unmapped') gate = 'blocked:no-rust-owner';
    const named = wordRe(s.sym).test(upText) || wordRe(s.sym).test(macText);
    const fallback = `s2sym::${snake(s.pkg)}::${snake(s.sym)}`;
    const fallbackFile = `crates/client/lexical/lexical_conformance/tests/s2sym/${snake(s.pkg)}.rs`;
    if (ov) {
      tier = ov.tier;
      test = ov.tests.join(' + ');
      file = '';
      also = [also, ov.src].filter(Boolean).join('; ');
    } else if (isType) {
      tier = 'types';
      test = `types.test-d.ts::${s.entry}/${s.sym}`;
      file = 'packages/lexical-wasm-shim/src/__tests__/types.test-d.ts';
    } else if (named) {
      tier = 'A-rec|A-hand';
      test = `index:${s.entry}/${s.sym} | ${fallback}`;
      file = fallbackFile;
    } else {
      tier = 'A-hand';
      test = fallback;
      file = fallbackFile;
    }
  }
  push({
    ...base,
    owner,
    gate,
    tier,
    test_id: test,
    test_file: file,
    also,
    milestone: ms,
  });
}

// 2. S2 behaviours.
const handModule = (pkg: string) => snake(pkg === 'lexical' ? 'lexical' : pkg);
for (const b of behs) {
  const fam = famOf(b.id);
  const fi = famInfo(fam);
  const cls = b.cls || fi.cls;
  let owner = fi.owner;
  if (fam.startsWith('RX-') && RX_RUST.has(fam)) owner = RICH;
  if (fam === 'XB' && XB_RUST.has(b.id)) owner = RICH;
  if (fam === 'HTML' && /> Export /.test(b.section + ' '))
    owner = 'rust:lexical_html';
  if (fam === 'HTML' && /Exports \(/.test(b.section)) owner = 'shim';
  if (cls === 'VIEW' && owner.startsWith('rust:')) owner = 'view';
  const ms = owner.startsWith('rust:') ? fi.ms : 'M3';
  const base = {
    kind: 'beh',
    id: b.id,
    package: fi.pkg,
    class: cls + (b.clsSource ? '' : ' (family)'),
    pri: '',
    source: `S2:${b.line}`,
    also: alsoFor(fam),
  };
  const ov = idOverride.get(b.id);
  const famFile = `crates/client/lexical/lexical_conformance/tests/s2/${snake(fam)}.rs`;
  if (owner === 'view') {
    push({
      ...base,
      owner,
      gate: 'ledger:view-only',
      tier: ov?.tier ?? 'B',
      test_id: ov?.test ?? tierB(fi.pkg),
      test_file: '',
      milestone: 'M3',
    });
  } else if (owner === 'upstream-js' || owner === 'reference') {
    push({
      ...base,
      owner,
      gate: `ledger:not-ported(${owner === 'reference' ? 'S2:target' : s3NotPortedCite(fam, b.text)})`,
      tier: ov?.tier ?? 'B',
      test_id: ov?.test ?? tierB(fi.pkg),
      test_file: '',
      milestone: 'M3',
    });
  } else if (owner === 'shim') {
    push({
      ...base,
      owner,
      gate: 'required',
      tier: 'shim',
      test_id: `exports.test.ts::${fi.pkg}/${b.id}`,
      test_file: 'packages/lexical-wasm-shim/src/__tests__/exports.test.ts',
      milestone: 'M3',
    });
  } else if (ov) {
    push({
      ...base,
      owner,
      gate: 'required',
      tier: ov.tier,
      test_id: ov.test,
      test_file: '',
      also: [base.also, ov.src].filter(Boolean).join('; '),
      milestone: ms,
    });
  } else if (b.ambiguous) {
    push({
      ...base,
      owner,
      gate: 'required',
      tier: 'A-hand',
      test_id: `hand::${handModule(fi.pkg)}::ambiguous_${snake(b.id)}`,
      test_file: `crates/client/lexical/lexical_conformance/tests/hand/${handModule(fi.pkg)}.rs`,
      milestone: ms,
    });
  } else {
    push({
      ...base,
      owner,
      gate: 'required',
      tier: 'A-hand',
      test_id: `s2::${snake(fam)}::${snake(b.id)}`,
      test_file: famFile,
      milestone: ms,
    });
  }
}

// 3. S3 nodes (Macro node mapping tables).
const nodeSeen = new Set<string>();
for (const r of S3.rows) {
  if (!r.header || r.header[0] !== 'Rust struct' || r.header[1] !== 'TS class')
    continue;
  const ts = r.cells[1].replace(/`/g, '').split(/\s/)[0];
  if (nodeSeen.has(ts)) continue;
  nodeSeen.add(ts);
  const t =
    nodeTests.get(ts) ??
    [...nodeTests.entries()].find(([, v]) => v.cells[0].includes(ts))?.[1];
  const specific = t ? testTicks(t.cells[2] ?? '') : [];
  const fixtures = t ? ticks(t.cells[1] ?? '').join(', ') : '';
  const abstractVia =
    t && t.cells[0].includes(`\`${ts}\` base`)
      ? 'via ImageNode, VideoNode'
      : '';
  push({
    kind: 'node',
    id: `S3:node:${ts}`,
    package: 'macro_document_model',
    class: 'MODEL',
    pri: '',
    owner: 'rust:macro_document_model',
    gate: 'required',
    tier: specific.length ? 'A-hand+synthetic' : 'synthetic',
    test_id: [`synthetic::${snake(ts)}::every_route`, ...specific].join(' + '),
    test_file: 'packages/lexical-conformance/diff/synthetic',
    also: [fixtures && `A-rec ${fixtures}`, abstractVia]
      .filter(Boolean)
      .join('; '),
    milestone: 'M1',
    source: `S3:${r.line}`,
  });
}

// 4. S3 routes.
for (const r of S3.rows) {
  if (!r.header || r.header[0] !== '#' || r.header[1] !== 'Method + path')
    continue;
  const n = r.cells[0].trim();
  const t = routeTests.get(n);
  const dropped = n === '0' || /dropped/.test(t?.cells[2] ?? '');
  const tests = t ? s7Ticks(t.cells[2]) : [];
  push({
    kind: 'route',
    id: `S3:route:${n}`,
    package: 'services/lexical-service',
    class: 'MODEL',
    pri: '',
    owner: 'rust:macro_document_model',
    gate: dropped ? 'ledger:dropped-route' : 'required',
    tier: dropped ? 'corpus' : 'A-rec+corpus+shadow',
    test_id: tests.length ? tests.join(' + ') : (t?.cells[2] ?? 'corpus'),
    test_file: '',
    also: t ? t.cells[2] : '',
    milestone: 'M1',
    source: `S3:${r.line}`,
  });
}

// 5. Transformers: S3 §4.2.6 (Macro) and §2.11 rows from MarkdownTransformers.ts (upstream).
const tfSeen = new Set<string>();
for (const r of S3.rows) {
  const macro = r.header?.[0] === 'Rust const' && r.header?.[1] === 'TS name';
  const tsName = r.cells[1].replace(/`/g, '').split(/[ /]/)[0];
  // Upstream: only the transformer objects and groups (types and helpers are export rows).
  const up =
    !macro &&
    /2\.11/.test(r.section) &&
    /MarkdownTransformers\.ts/.test(r.text) &&
    /^[A-Z][A-Z_]+$/.test(tsName) &&
    !/_STATE$/.test(tsName);
  if (!macro && !up) continue;
  const rust = ticks(r.cells[0])[0] ?? r.cells[0];
  const isArray = /^[a-z_]+\(\)$/.test(rust) || /TRANSFORMERS$/.test(tsName);
  const isFn = macro && /^fn|port|fn\/const/.test(r.cells[3] ?? '');
  const crate = macro ? 'macro_document_model' : 'lexical_markdown';
  const file = `crates/client/lexical/${crate}/tests/transformers.rs`;
  if (isArray) {
    push({
      kind: 'tf-order',
      id: `S3:tf:${tsName}`,
      package: crate,
      class: 'MODEL',
      pri: '',
      owner: `rust:${crate}`,
      gate: 'required',
      tier: 'A-hand',
      test_id: `transformers::${snake(tsName)}_order_equals_ts`,
      test_file: file,
      also: 'order is the behaviour (MD-ARR)',
      milestone: 'M1',
      source: `S3:${r.line}`,
    });
  } else {
    const base = `S3:tf:${rust.replace(/\[i\].*/, '')}`;
    const tfId = tfSeen.has(base) ? `${base}/${tsName}` : base;
    tfSeen.add(base);
    push({
      kind: 'tf',
      id: tfId,
      package: crate,
      class: 'MODEL',
      pri: '',
      owner: `rust:${crate}`,
      gate: 'required',
      tier: isFn ? 'A-hand' : 'A-rec(fired)|A-hand',
      test_id: isFn
        ? `md_utils::${snake(rust)}`
        : `fired:${tsName} | transformers::${snake(rust)}_fires`,
      test_file: isFn
        ? `crates/client/lexical/${crate}/tests/md_utils.rs`
        : file,
      also: '§3.6c regex differential where it has a regex',
      milestone: 'M1',
      source: `S3:${r.line}`,
    });
  }
}
// Order arrays defined in S3 §4.2 code blocks (Macro lists) and upstream groups.
for (const [name, re] of [
  ['INTERNAL_TRANSFORMERS', /INTERNAL_TRANSFORMERS \(index\.ts/],
  ['EXTERNAL_TRANSFORMERS', /EXTERNAL_TRANSFORMERS \(index\.ts/],
  ['ALL_TRANSFORMERS', /ALL_TRANSFORMERS \(index\.ts/],
  ['CUSTOM_TRANSFORMERS', /CUSTOM_TRANSFORMERS \(customTransformers\.ts/],
] as const) {
  const line = S3.lines.findIndex((l) => re.test(l)) + 1;
  if (!line) throw new Error(`S3 has no ${name} list`);
  push({
    kind: 'tf-order',
    id: `S3:tf:${name}`,
    package: 'macro_document_model',
    class: 'MODEL',
    pri: '',
    owner: 'rust:macro_document_model',
    gate: 'required',
    tier: 'A-hand',
    test_id: `transformers::${snake(name)}_order_equals_ts`,
    test_file:
      'crates/client/lexical/macro_document_model/tests/transformers.rs',
    also: 'order is the behaviour (MD-ARR)',
    milestone: 'M1',
    source: `S3:${line}`,
  });
}

// 6. S7 §6 rows.
for (const r of S7.rows) {
  if (!/^6\. /.test(r.section) || !/^\d+$/.test(r.cells[0])) continue;
  const n = +r.cells[0];
  const removed = /removed/.test(r.cells[4] ?? '');
  const t = s7Tests.get(n);
  const s8 = s8ByRow.get(n) ?? [];
  const tests = t ? s7Ticks(t.cells[1]) : [];
  const primary = removed
    ? 'removed'
    : tests.length
      ? tests.join(' + ')
      : t
        ? t.cells[1]
        : s8.join(' + ');
  push({
    kind: 's7',
    id: `S7:${n}`,
    package: 'doc_sync_core/document_session',
    class: 'MODEL',
    pri: '',
    owner: removed ? 'removed' : 'rust:doc_sync_core',
    gate: removed ? 'ledger:removed' : primary ? 'required' : 'MISSING',
    tier: removed ? '-' : tests.some((x) => x.includes('::')) ? 'unit' : 'S8',
    test_id: primary,
    test_file: '',
    also: [...new Set(s8)].join(', '),
    milestone: 'M2',
    source: `S7:${r.line}`,
  });
}

// 7. audit-r2-1 divergence regressions (S4 §1.8e).
for (const r of divRows) {
  const id = /^(R2-\d+)/.exec(r.cells[0])![1];
  push({
    kind: 'div',
    id: `S1:${id}`,
    package: r.cells[3] ?? '',
    class: 'MODEL',
    pri: '',
    owner: `rust:${r.cells[3] ?? ''}`,
    gate: 'required',
    tier: r.cells[2] ?? '',
    test_id: testTicks(r.cells[1]).join(' + '),
    test_file: '',
    also: r.cells[0].replace(/^R2-\d+\s*/, ''),
    milestone: 'M1',
    source: `S4:${r.line}`,
  });
}

// 8. Private surface Macro uses (S4 §1.8h).
for (const r of privRows) {
  push({
    kind: 'priv',
    id: `S4:priv:${ticks(r.cells[0])[0] ?? r.cells[0]}`,
    package: 'lexical',
    class: 'VIEW',
    pri: 'P0',
    owner: 'shim',
    gate: 'required',
    tier: 'shim',
    test_id: ticks(r.cells[2])[0] ?? r.cells[2],
    test_file: 'packages/lexical-wasm-shim/src/__tests__/view_gaps.test.ts',
    also: r.cells[1],
    milestone: 'M3',
    source: `S4:${r.line}`,
  });
}

// ---------- write / check ----------
const tsv =
  [
    HEADER.join('\t'),
    ...rows.map((r) => HEADER.map((h) => r[h]).join('\t')),
  ].join('\n') + '\n';
const count = (f: (r: Out) => boolean) => rows.filter(f).length;
const summary = [
  `rows ${rows.length}`,
  `sym ${count((r) => r.kind === 'sym')} (MODEL/BRIDGE ${count((r) => r.kind === 'sym' && /MODEL|BRIDGE/.test(r.class))})`,
  `beh ${count((r) => r.kind === 'beh')} (MODEL/BRIDGE ${count((r) => r.kind === 'beh' && /MODEL|BRIDGE/.test(r.class))}, required ${count((r) => r.kind === 'beh' && r.gate === 'required')})`,
  `priv ${count((r) => r.kind === 'priv')} node ${count((r) => r.kind === 'node')} route ${count((r) => r.kind === 'route')} tf ${count((r) => r.kind === 'tf')} tf-order ${count((r) => r.kind === 'tf-order')} s7 ${count((r) => r.kind === 's7')} div ${count((r) => r.kind === 'div')}`,
  `js-by-design ${count((r) => r.gate.startsWith('ledger:js-by-design'))}; blocked ${count((r) => r.gate.startsWith('blocked'))}; MISSING ${count((r) => r.gate === 'MISSING')}`,
].join('\n');
if (process.argv.includes('--check')) {
  const disk = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (disk !== tsv) {
    console.error('S4-matrix.tsv is stale: re-run without --check');
    process.exit(1);
  }
  console.log(summary);
} else {
  writeFileSync(OUT, tsv);
  console.log(summary);
}
if (rows.some((r) => r.gate === 'MISSING')) {
  console.error(
    'rows with no test:',
    rows
      .filter((r) => r.gate === 'MISSING')
      .map((r) => r.id)
      .join(' ')
  );
  process.exit(2);
}
