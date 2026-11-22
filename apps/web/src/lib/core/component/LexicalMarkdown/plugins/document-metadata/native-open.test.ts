import 'fake-indexeddb/auto';
import { Access } from '@macro-inc/collaboration/session/abi.generated';
import {
  initializeInputCommitFixture,
  native,
} from '@macro-inc/lexical-wasm-view/view/input-commit-test-fixture';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { getErrorDescription } from '../../constants';
import { mountNewerDocumentFixture } from './browser-test/native-fixture';
import { nativeDocumentMetadataError } from './native';

let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeInputCommitFixture();
});
afterAll(() => restore?.());
for (const access of [Access.Edit, Access.Read, Access.CommentOnly]) {
  test(`actual newer-document seed maps to Source error with its read-only content (${access})`, async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const errors: unknown[] = [];
    const runtime = mountNewerDocumentFixture(root, native, access, (error) =>
      errors.push(error)
    );
    try {
      expect(errors).toHaveLength(1);
      const error = nativeDocumentMetadataError(errors[0]);
      expect(error).toBe('VERSION_MISMATCH_ERROR');
      expect(error && getErrorDescription(error)).toBe(
        'Refresh the page to edit this document. It may have been updated using a newer version of Macro.'
      );
      expect(runtime.view.node(0)).not.toBeNull();
      expect(root.textContent).toBe('Before');
      expect(runtime.view.isEditable).toBe(false);
    } finally {
      await runtime.close();
      root.remove();
    }
  });
}
