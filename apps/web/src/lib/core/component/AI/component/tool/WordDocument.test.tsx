import { describe, expect, it, vi } from 'vitest';
import {
  describedBlockCount,
  editWordDocumentHandler,
  readWordDocumentHandler,
} from './WordDocument';

// The document chip pulls in the app's live clients; these tests need none.
vi.mock('@core/component/ItemPreview', () => ({ ItemPreview: () => null }));

describe('Word document tools', () => {
  it('reads the block count from a description', () => {
    expect(
      describedBlockCount('Word document with 17 blocks.\nIds are stable')
    ).toBe(17);
    expect(describedBlockCount('Word document with 1 block.')).toBe(1);
    expect(describedBlockCount('something else')).toBeUndefined();
  });

  it('needs no response handling: edits reach open editors live', () => {
    expect(readWordDocumentHandler.handleResponse).toBeUndefined();
    expect(editWordDocumentHandler.handleResponse).toBeUndefined();
  });
});
