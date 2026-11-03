/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MakeDocumentFromMessage } from './MakeDocumentFromMessage';

const createDocumentFromReply = vi.hoisted(() => vi.fn());
const openWithSplit = vi.hoisted(() => vi.fn());
const failure = vi.hoisted(() => vi.fn());

vi.mock('../queries/create-message-document', () => ({
  createDocumentFromReply,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure },
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  createDocumentFromReply.mockReset();
  openWithSplit.mockReset();
  failure.mockReset();
});

describe('MakeDocumentFromMessage', () => {
  it('creates a document from the reply and opens it beside the session', async () => {
    createDocumentFromReply.mockResolvedValue('document-1');

    const view = render(() => (
      <MakeDocumentFromMessage
        title="Filmmaker and Editor"
        markdown="Draft the role."
      />
    ));
    fireEvent.click(view.getByRole('button', { name: 'Make a doc' }));

    await waitFor(() => {
      expect(openWithSplit).toHaveBeenCalledWith(
        { type: 'md', id: 'document-1' },
        { preferNewSplit: true, activate: true }
      );
    });
    expect(createDocumentFromReply).toHaveBeenCalledWith({
      title: 'Filmmaker and Editor',
      markdown: 'Draft the role.',
    });
    expect(failure).not.toHaveBeenCalled();
  });

  it('tells the reader when the document was not created', async () => {
    createDocumentFromReply.mockResolvedValue(undefined);

    const view = render(() => (
      <MakeDocumentFromMessage title="Notes" markdown="Hello" />
    ));
    fireEvent.click(view.getByRole('button', { name: 'Make a doc' }));

    await waitFor(() => {
      expect(failure).toHaveBeenCalledWith("Couldn't make a doc");
    });
    expect(openWithSplit).not.toHaveBeenCalled();
  });
});
