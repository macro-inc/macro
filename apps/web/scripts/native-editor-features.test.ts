import { expect, test } from 'vitest';
import {
  assertCompatibilityWebGraph,
  assertEditorLoroFeature,
  assertNativeEditorGraph,
  assertSessionArtifact,
} from './native-editor-features';

test('native graphs retain application support without foreign nodes', () => {
  expect(() =>
    assertNativeEditorGraph(
      'document_session_ffi v0.1.0|\ndocument_session v0.1.0|application\nlexical_model v0.1.0|',
      'document_session_ffi'
    )
  ).not.toThrow();
});

test('production graphs reject development probes at every forwarded layer', () => {
  for (const dependency of [
    'document_session_wasm',
    'document_session',
    'lexical_loro',
  ]) {
    const graph = [
      'document_session_wasm v0.1.0|bebop-owned-all',
      'document_session v0.1.0|application',
      'lexical_loro v0.1.0|',
      'lexical_model v0.1.0|',
    ]
      .map((line) =>
        line.startsWith(`${dependency} v`)
          ? `${line}${line.endsWith('|') ? '' : ','}dev-probes`
          : line
      )
      .join('\n');
    expect(() =>
      assertNativeEditorGraph(graph, 'document_session_wasm')
    ).toThrow('enables development probes');
  }
});

test('production graphs reject test fault hooks on both crates that define them', () => {
  for (const dependency of ['document_session', 'lexical_loro']) {
    const graph = [
      'document_session_wasm v0.1.0|bebop-owned-all',
      'document_session v0.1.0|application',
      'lexical_loro v0.1.0|',
      'lexical_model v0.1.0|',
    ]
      .map((line) =>
        line.startsWith(`${dependency} v`)
          ? `${line}${line.endsWith('|') ? '' : ','}test-faults`
          : line
      )
      .join('\n');
    expect(() =>
      assertNativeEditorGraph(graph, 'document_session_wasm')
    ).toThrow('enables test fault hooks');
  }
});

test('a transitive foreign-nodes route fails even without a session compatibility feature', () => {
  expect(() =>
    assertNativeEditorGraph(
      'document_session_ffi v0.1.0|\nlexical_model v0.1.0|foreign-nodes',
      'document_session_ffi'
    )
  ).toThrow('enables compatibility');
});

test('default compatibility and missing or malformed graphs fail closed', () => {
  for (const graph of [
    'document_session_wasm v0.1.0|bebop-owned-all,compatibility\nlexical_model v0.1.0|',
    'document_session v0.1.0|compatibility\nlexical_model v0.1.0|',
    'lexical_model v0.1.0|',
    'document_session_wasm v0.1.0|',
    '',
  ]) {
    expect(() =>
      assertNativeEditorGraph(graph, 'document_session_wasm')
    ).toThrow();
  }
});

test('the explicit web compatibility positive control requires the actual foreign closure', () => {
  const graph =
    'document_session_wasm v0.1.0|bebop-owned-all,compat-web,compatibility\ndocument_session v0.1.0|application,compatibility\nlexical_model v0.1.0|foreign-nodes';
  expect(() => assertCompatibilityWebGraph(graph)).not.toThrow();
  expect(() =>
    assertCompatibilityWebGraph(graph.replace('foreign-nodes', ''))
  ).toThrow();
  expect(() =>
    assertNativeEditorGraph(graph, 'document_session_wasm')
  ).toThrow();
});

function wasmWithExports(names: string[]) {
  const exports = names.flatMap((name) => [
    name.length,
    ...new TextEncoder().encode(name),
    0,
    0,
  ]);
  return new Uint8Array([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    1,
    4,
    1,
    96,
    0,
    0,
    3,
    2,
    1,
    0,
    7,
    exports.length + 1,
    names.length,
    ...exports,
    10,
    4,
    1,
    2,
    0,
    11,
  ]);
}

test('native artifact rejects a cached compatibility binary regardless of its path', () => {
  const bytes = wasmWithExports([
    'editorsession_createMacro',
    'editorsession_createCompat',
  ]);
  expect(() => assertSessionArtifact(bytes, 'native')).toThrow(
    'exports compatibility'
  );
  expect(() => assertSessionArtifact(bytes, 'compat')).not.toThrow();
});

test('compatibility output rejects a native artifact and corrupt artifacts fail', () => {
  const bytes = wasmWithExports(['editorsession_createMacro']);
  expect(() => assertSessionArtifact(bytes, 'native')).not.toThrow();
  expect(() => assertSessionArtifact(bytes, 'compat')).toThrow(
    'missing createCompat'
  );
  expect(() => assertSessionArtifact(new Uint8Array([0]), 'native')).toThrow();
});

test('native session graphs need the editor Loro runtime and others must not enable it', () => {
  const editor = 'loro-internal v1.17.1 (/vendor/loro-editor/loro-internal)';
  const native = `document_session v0.1.0|application\n${editor}|native-editor,wasm`;
  const upstream = `macro_document_model v0.1.0|html\n${editor}|wasm`;
  expect(() => assertEditorLoroFeature(native, true)).not.toThrow();
  expect(() => assertEditorLoroFeature(upstream, false)).not.toThrow();
  expect(() => assertEditorLoroFeature(upstream, true)).toThrow('lacks');
  expect(() => assertEditorLoroFeature('', true)).toThrow('lacks');
  expect(() => assertEditorLoroFeature(native, false)).toThrow('enables');
});
