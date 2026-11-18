import type { PreviewItem } from '@queries/preview/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  references: [] as unknown[],
  previews: new Map<string, unknown>(),
  openWithSplit: vi.fn(),
  toastFailure: vi.fn(),
}));

vi.mock('@queries/storage/attachment-references', () => ({
  useAttachmentReferencesQuery: () => ({ data: mocks.references }),
}));
vi.mock('@queries/preview', () => ({
  isAccessiblePreviewItem: (item: PreviewItem) =>
    !item.loading && item.access === 'access',
  useItemPreview: (args: () => { id: string }) => [
    () => mocks.previews.get(args().id),
  ],
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({}),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toastFailure },
}));
vi.mock('@core/user', () => ({
  getDisplayNameParts: () => ({ firstName: 'Ada', fullName: 'Ada Lovelace' }),
  tryMacroId: (id: string) => id,
}));
vi.mock('@entity', () => ({ formatRelativeTimestamp: () => 'now' }));
vi.mock('./ItemPreview', () => ({
  InlineItemPreview: (props: { id: string }) => <span>{props.id}</span>,
}));
vi.mock('./UserIcon', () => ({ UserIcon: () => null }));
vi.mock('./LexicalMarkdown/component/core/StaticMarkdown', () => ({
  StaticMarkdown: () => null,
}));
vi.mock('./LexicalMarkdown/component/core/BlockLink', () => ({
  openDocument: vi.fn(),
}));
vi.mock('./LexicalMarkdown/theme', () => ({ twoLineClampMarkdownTheme: {} }));
vi.mock('@block-channel/utils/link', () => ({
  navigateToChannelMessage: vi.fn(),
}));
vi.mock('@app/features/projects/open-project', () => ({
  openProject: vi.fn(),
}));
vi.mock('@app/features/notifications/document-comment-location', () => ({
  documentCommentLocation: vi.fn(),
}));
vi.mock('@block-call/call-route', () => ({
  callDetailSearch: { namespace: 'call', defaults: {} },
  callDetailSearchCodec: { serialize: () => '' },
}));

import { References } from './References';

function genericReference(sourceId: string) {
  return {
    reference_type: 'generic',
    entity_type: 'document',
    entity_id: 'referenced-doc',
    source_entity_type: 'document',
    source_entity_id: sourceId,
    user_id: 'macro|ada@example.com',
    created_at: '2026-11-03T20:00:00Z',
  };
}

function documentPreview(
  id: string,
  subType?: { type: 'task'; is_completed: boolean }
): PreviewItem {
  return {
    id,
    type: 'document',
    access: 'access',
    loading: false,
    name: id,
    rawName: id,
    fileType: 'md',
    subType,
  };
}

afterEach(() => {
  cleanup();
  mocks.references = [];
  mocks.previews.clear();
  mocks.openWithSplit.mockReset();
  mocks.toastFailure.mockReset();
});

describe('References generic rows', () => {
  it('opens a referencing task as a task', () => {
    mocks.references = [genericReference('task-1')];
    mocks.previews.set(
      'task-1',
      documentPreview('task-1', { type: 'task', is_completed: false })
    );

    render(() => <References documentId="referenced-doc" />);
    fireEvent.click(screen.getByRole('button'));

    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'task', id: 'task-1' },
      { preferNewSplit: true }
    );
    expect(mocks.toastFailure).not.toHaveBeenCalled();
  });

  it('opens a referencing markdown document as a document', () => {
    mocks.references = [genericReference('doc-1')];
    mocks.previews.set('doc-1', documentPreview('doc-1'));

    render(() => <References documentId="referenced-doc" />);
    fireEvent.click(screen.getByRole('button'));

    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'md', id: 'doc-1' },
      { preferNewSplit: true }
    );
  });
});
