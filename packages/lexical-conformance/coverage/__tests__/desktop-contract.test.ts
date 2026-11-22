import { expect, test } from 'vitest';
import { desktopIncludesSession } from '../desktop-contract';

test('desktop membership requires a name in the assigned package list', () => {
  expect(
    desktopIncludesSession('coreWasmPackages = []; # "document_session_wasm"')
  ).toBe(false);
  expect(
    desktopIncludesSession(
      'coreWasmPackages = []; other = { name = "document_session_wasm"; };'
    )
  ).toBe(false);
  expect(
    desktopIncludesSession(
      'coreWasmPackages = [{ dir = "document_session_wasm"; }];'
    )
  ).toBe(false);
  expect(
    desktopIncludesSession(
      'coreWasmPackages = map mkCoreWasmPackage [{ name = "document_session_wasm"; }];'
    )
  ).toBe(true);
  expect(
    desktopIncludesSession(
      'coreWasmPackages = [/* name = "document_session_wasm"; */];'
    )
  ).toBe(false);
});
