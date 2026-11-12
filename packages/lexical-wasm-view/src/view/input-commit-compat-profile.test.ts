import { expect, test } from 'vitest';
import * as compatibility from '../../../../apps/web/src/lib/core/document-session/wasm-compat/document_session_wasm.js';
import { captureNativeInputCommit } from './input-commit-native';

test('actual generated compatibility module has no observation capability or capture', () => {
  // Metadata-only test of the real paired module. No compatibility session,
  // ordinary view/Port cast, fake capability or native receiver is constructed.
  expect(captureNativeInputCommit(compatibility)).toBeUndefined();
  expect(
    Object.getOwnPropertyDescriptor(
      compatibility.EditorSession.prototype,
      'inputObserved'
    )
  ).toBeUndefined();
  expect(
    Object.getOwnPropertyDescriptor(
      compatibility.EditorSession.prototype,
      'readInputCommitReceipt'
    )
  ).toBeUndefined();
  expect(Object.hasOwn(compatibility, 'InputCommitReceipt')).toBe(false);
  expect(Object.hasOwn(compatibility, 'InputCommitKind')).toBe(false);
});
