import type { CreateUnthreadedAnchorResponse } from '@service-storage/generated/schemas/createUnthreadedAnchorResponse';
import type { DeleteUnthreadedAnchorResponse } from '@service-storage/generated/schemas/deleteUnthreadedAnchorResponse';
import type { EditAnchorResponse } from '@service-storage/generated/schemas/editAnchorResponse';
import type { MessageListItem } from '@service-storage/messages';
import { waitFor } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IHighlight } from '../model/Highlight';
import { createPdfAnnotations, type PdfAnnotations } from './pdf-annotations';

const annotationQueries = vi.hoisted(() => ({
  getPdfAnchors: vi.fn(async (_documentId: string) => []),
}));
const messageRoots = vi.hoisted(() => ({
  parents: [] as string[],
  setRoots: (_roots: MessageListItem[]) => {},
}));

vi.mock('../queries/annotations', () => annotationQueries);
vi.mock('@queries/messages/document-messages', async () => {
  const { createSignal } = await import('solid-js');
  const [roots, setRoots] = createSignal<MessageListItem[]>([]);
  messageRoots.setRoots = setRoots;
  return {
    useMessageRootsQuery: (parent: () => { type: string; id: string }) => {
      messageRoots.parents.push(`${parent().type}:${parent().id}`);
      return {
        get data() {
          return roots();
        },
        isSuccess: true,
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      };
    },
  };
});

function setup(documentId: string): {
  annotations: PdfAnnotations;
  dispose: () => void;
} {
  return createRoot((dispose) => ({
    annotations: createPdfAnnotations(() => documentId),
    dispose,
  }));
}

async function waitForInitialResources(annotations: PdfAnnotations) {
  await waitFor(() => {
    expect(annotations.anchors()).toEqual([]);
  });
}

function createHighlight(
  uuid: string,
  overrides: Partial<IHighlight> = {}
): IHighlight {
  return {
    uuid,
    pageNum: 2,
    rects: [{ top: 0.1, left: 0.2, width: 0.3, height: 0.04 }],
    color: { red: 253, green: 224, blue: 71, alpha: 0.4 },
    type: 1,
    thread: null,
    text: 'highlight text',
    pageViewport: { width: 600, height: 800 },
    hasTempThread: false,
    existsOnServer: false,
    owner: 'user-1',
    ...overrides,
  };
}

function createServerHighlight(
  uuid: string,
  rootId?: string
): CreateUnthreadedAnchorResponse {
  return {
    uuid,
    documentId: 'document-1',
    anchorType: 'highlight',
    page: 2,
    highlightRects: [{ id: 1, top: 0.1, left: 0.2, width: 0.3, height: 0.04 }],
    red: 253,
    green: 224,
    blue: 71,
    alpha: 0.4,
    highlightType: 1,
    pageViewportWidth: 600,
    pageViewportHeight: 800,
    text: 'server highlight',
    owner: 'user-1',
    rootId,
  };
}

function createServerPlaceable(
  uuid: string,
  rootId: string
): CreateUnthreadedAnchorResponse {
  return {
    uuid,
    documentId: 'document-1',
    anchorType: 'placeable',
    owner: 'user-1',
    rootId,
    page: 1,
    originalPage: 1,
    originalIndex: -1,
    xPct: 0.1,
    yPct: 0.2,
    widthPct: 0.05,
    heightPct: 0.05,
    rotation: 0,
    wasEdited: false,
    wasDeleted: false,
    shouldLockOnSave: false,
  };
}

function root(id: string, content = 'first comment'): MessageListItem {
  const created_at = '2026-09-09T00:00:00Z';
  return {
    id,
    parent: { type: 'document', id: 'document-1' },
    sender_id: 'user-1',
    content,
    mentions: [],
    attachments: [],
    reactions: [],
    created_at,
    updated_at: created_at,
    state: {
      root_id: id,
      user_id: 'user-1',
      resolved: false,
      created_at,
      updated_at: created_at,
    },
    thread: { reply_count: 0, preview: [], latest_reply_at: null },
  };
}

beforeEach(() => {
  annotationQueries.getPdfAnchors.mockClear();
  messageRoots.parents.length = 0;
  messageRoots.setRoots([]);
});

describe('createPdfAnnotations', () => {
  it('starts empty, reads the document discussion, and isolates authorities', async () => {
    const first = setup('document-1');
    const second = setup('document-2');
    await Promise.all([
      waitForInitialResources(first.annotations),
      waitForInitialResources(second.annotations),
    ]);
    const highlight = createHighlight('highlight-1');

    first.annotations.commands.beginNewHighlightCommentDrafts([highlight]);

    expect({
      anchorQueryDocumentIds: annotationQueries.getPdfAnchors.mock.calls.map(
        ([documentId]) => documentId
      ),
      messageParents: messageRoots.parents,
      firstHighlight: first.annotations.highlightsByUuid()['highlight-1']?.uuid,
      secondHighlights: second.annotations.highlightsByUuid(),
      exposesAnchorMutate: 'mutate' in first.annotations.anchors,
    }).toEqual({
      anchorQueryDocumentIds: ['document-1', 'document-2'],
      messageParents: ['document:document-1', 'document:document-2'],
      firstHighlight: 'highlight-1',
      secondHighlights: {},
      exposesAnchorMutate: false,
    });

    first.dispose();
    second.dispose();
  });

  it('applies anchor transitions in response order', async () => {
    const { annotations, dispose } = setup('document-1');
    await waitForInitialResources(annotations);
    const firstAnchor = createServerHighlight('highlight-1');
    const secondAnchor = createServerHighlight('highlight-2');

    annotations.commands.applyCreatedAnchor(firstAnchor);
    annotations.commands.applyCreatedAnchor(secondAnchor);
    annotations.commands.applyEditedAnchor({
      ...firstAnchor,
      text: 'edited highlight',
    } as EditAnchorResponse);

    expect(
      annotations.anchors()?.map((anchor) => ({
        uuid: anchor.uuid,
        text: 'text' in anchor ? anchor.text : null,
      }))
    ).toEqual([
      { uuid: 'highlight-2', text: 'server highlight' },
      { uuid: 'highlight-1', text: 'edited highlight' },
    ]);

    annotations.commands.applyDeletedAnchor({
      uuid: 'highlight-1',
      documentId: 'document-1',
      fileType: 'pdf',
      anchorType: 'highlight',
    } as DeleteUnthreadedAnchorResponse);

    expect(annotations.anchors()?.map((anchor) => anchor.uuid)).toEqual([
      'highlight-2',
    ]);
    dispose();
  });

  it('projects anchors and their discussion roots into highlights', async () => {
    const { annotations, dispose } = setup('document-1');
    await waitForInitialResources(annotations);
    const anchor = createServerHighlight('highlight-1', 'root-1');

    annotations.commands.applyCreatedAnchor(anchor);
    // A threaded highlight waits for its discussion.
    expect(annotations.highlightsByUuid()).toEqual({});

    messageRoots.setRoots([root('root-1')]);

    await waitFor(() => {
      expect(annotations.highlightsByUuid()['highlight-1']).toEqual({
        owner: 'user-1',
        existsOnServer: true,
        pageNum: 2,
        rects: [
          {
            id: 1,
            top: 0.1,
            left: 0.2,
            width: 0.3,
            height: 0.04,
          },
        ],
        color: { red: 253, green: 224, blue: 71, alpha: 0.4 },
        hasTempThread: false,
        uuid: 'highlight-1',
        text: 'server highlight',
        type: 1,
        pageViewport: { width: 600, height: 800 },
        thread: {
          threadId: 'root-1',
          rootId: 'root-1',
          anchorId: 'highlight-1',
          page: 2,
          comments: [root('root-1')],
          replyCount: 0,
          isResolved: false,
        },
      });
    });

    // A deleted discussion drops out of the join.
    const deleted = root('root-1');
    deleted.state = { ...deleted.state, deleted_at: '2026-09-10T00:00:00Z' };
    messageRoots.setRoots([deleted]);
    await waitFor(() => {
      expect(annotations.highlightsByUuid()).toEqual({});
    });
    dispose();
  });

  it('binds a posted root to its anchor and releases anchors of a deleted discussion', async () => {
    const { annotations, dispose } = setup('document-1');
    await waitForInitialResources(annotations);
    messageRoots.setRoots([root('root-1'), root('root-2')]);

    annotations.commands.applyCreatedAnchor(
      createServerHighlight('highlight-1')
    );
    annotations.commands.applyCreatedAnchor(
      createServerPlaceable('placeable-1', 'root-2')
    );
    annotations.commands.attachAnchorRoot('highlight-1', 'root-1');

    await waitFor(() => {
      expect(
        annotations.highlightsByUuid()['highlight-1']?.thread?.threadId
      ).toBe('root-1');
    });

    annotations.commands.applyThreadDeleted('root-1');
    annotations.commands.applyThreadDeleted('root-2');

    expect(
      annotations
        .anchors()
        ?.map((anchor) => ({ uuid: anchor.uuid, rootId: anchor.rootId }))
    ).toEqual([{ uuid: 'highlight-1', rootId: null }]);
    await waitFor(() => {
      expect(annotations.highlightsByUuid()['highlight-1']?.thread).toBeNull();
    });
    dispose();
  });

  it('reverts converted drafts and removes newly created drafts', async () => {
    const { annotations, dispose } = setup('document-1');
    await waitForInitialResources(annotations);
    const existing = createHighlight('existing-highlight');
    const created = createHighlight('created-highlight');

    annotations.commands.beginNewHighlightCommentDrafts([existing, created]);
    expect(annotations.highlightsByUuid()[created.uuid]?.hasTempThread).toBe(
      true
    );
    annotations.commands.beginExistingHighlightCommentDraft(existing);
    expect(annotations.highlightsByUuid()[existing.uuid]?.hasTempThread).toBe(
      true
    );

    expect(
      annotations.commands.cancelTemporaryHighlightCommentDraft(existing.uuid)
    ).toBe(true);
    expect(
      annotations.commands.cancelTemporaryHighlightCommentDraft(created.uuid)
    ).toBe(false);

    expect({
      existing: annotations.highlightsByUuid()[existing.uuid],
      created: annotations.highlightsByUuid()[created.uuid],
      hasHighlights: annotations.hasHighlights(),
    }).toEqual({
      existing: {
        ...existing,
        thread: null,
        hasTempThread: false,
      },
      created: undefined,
      hasHighlights: true,
    });

    annotations.commands.cancelTemporaryHighlightCommentDraft(existing.uuid);
    expect(annotations.hasHighlights()).toBe(false);
    dispose();
  });
});
