import type { CreateCommentResponse } from '@service-storage/generated/schemas/createCommentResponse';
import type { CreateUnthreadedAnchorResponse } from '@service-storage/generated/schemas/createUnthreadedAnchorResponse';
import type { DeleteCommentResponse } from '@service-storage/generated/schemas/deleteCommentResponse';
import type { DeleteUnthreadedAnchorResponse } from '@service-storage/generated/schemas/deleteUnthreadedAnchorResponse';
import type { EditAnchorResponse } from '@service-storage/generated/schemas/editAnchorResponse';
import type { EditCommentResponse } from '@service-storage/generated/schemas/editCommentResponse';
import type { MessageListItem } from '@service-storage/messages';
import { waitFor } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IHighlight } from '../model/Highlight';
import { createPdfAnnotations, type PdfAnnotations } from './pdf-annotations';

const annotationQueries = vi.hoisted(() => ({
  getPdfAnchors: vi.fn(async (_documentId: string) => []),
  getPdfComments: vi.fn(async (_documentId: string) => []),
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
      };
    },
  };
});

function setup(
  documentId: string,
  unified = false
): {
  annotations: PdfAnnotations;
  dispose: () => void;
} {
  return createRoot((dispose) => ({
    annotations: createPdfAnnotations(() => documentId, unified),
    dispose,
  }));
}

async function waitForInitialResources(annotations: PdfAnnotations) {
  await waitFor(() => {
    expect(annotations.anchors()).toEqual([]);
    expect(annotations.commentThreads()).toEqual([]);
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
  threadId?: number,
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
    threadId,
    rootId,
  };
}

function createServerPlaceable(
  uuid: string,
  binding: { threadId?: number; rootId?: string }
): CreateUnthreadedAnchorResponse {
  return {
    uuid,
    documentId: 'document-1',
    anchorType: 'placeable',
    owner: 'user-1',
    ...binding,
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

function createCommentResponse(
  threadId: number,
  commentId: number
): CreateCommentResponse {
  return {
    documentId: 'document-1',
    thread: {
      threadId,
      documentId: 'document-1',
      owner: 'user-1',
      resolved: false,
    },
    comments: [
      {
        commentId,
        threadId,
        owner: 'user-1',
        text: 'first comment',
      },
    ],
  };
}

beforeEach(() => {
  annotationQueries.getPdfAnchors.mockClear();
  annotationQueries.getPdfComments.mockClear();
  messageRoots.parents.length = 0;
  messageRoots.setRoots([]);
});

describe('createPdfAnnotations', () => {
  it('starts empty, projects highlight indexes, and isolates authorities', async () => {
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
      commentQueryDocumentIds: annotationQueries.getPdfComments.mock.calls.map(
        ([documentId]) => documentId
      ),
      firstHighlight: first.annotations.highlightsByUuid()['highlight-1']?.uuid,
      secondHighlights: second.annotations.highlightsByUuid(),
      exposesAnchorMutate: 'mutate' in first.annotations.anchors,
      exposesCommentThreadMutate: 'mutate' in first.annotations.commentThreads,
    }).toEqual({
      anchorQueryDocumentIds: ['document-1', 'document-2'],
      commentQueryDocumentIds: ['document-1', 'document-2'],
      firstHighlight: 'highlight-1',
      secondHighlights: {},
      exposesAnchorMutate: false,
      exposesCommentThreadMutate: false,
    });
    expect(messageRoots.parents).toEqual([]);

    first.dispose();
    second.dispose();
  });

  it('applies resource response transitions in response order', async () => {
    const { annotations, dispose } = setup('document-1');
    await waitForInitialResources(annotations);
    const firstAnchor = createServerHighlight('highlight-1');
    const secondAnchor = createServerHighlight('highlight-2');
    const createdComment = createCommentResponse(31, 41);

    annotations.commands.applyCreatedAnchor(firstAnchor);
    annotations.commands.applyCreatedAnchor(secondAnchor);
    annotations.commands.applyEditedAnchor({
      ...firstAnchor,
      text: 'edited highlight',
    } as EditAnchorResponse);
    annotations.commands.applyCreatedComment(createdComment);
    annotations.commands.applyEditedComment({
      ...createdComment.comments[0],
      documentId: 'document-1',
      documentName: 'document.pdf',
      documentOwner: 'user-1',
      text: 'edited comment',
    } as EditCommentResponse);

    expect({
      anchors: annotations.anchors()?.map((anchor) => ({
        uuid: anchor.uuid,
        text: 'text' in anchor ? anchor.text : null,
      })),
      comments: annotations
        .commentThreads()
        ?.flatMap((thread) =>
          thread.comments.map(({ commentId, text }) => ({ commentId, text }))
        ),
    }).toEqual({
      anchors: [
        { uuid: 'highlight-2', text: 'server highlight' },
        { uuid: 'highlight-1', text: 'edited highlight' },
      ],
      comments: [{ commentId: 41, text: 'edited comment' }],
    });

    annotations.commands.applyDeletedComment({
      commentId: 41,
      documentId: 'document-1',
      thread: { threadId: 31, deleted: false },
    } satisfies DeleteCommentResponse);
    annotations.commands.applyDeletedAnchor({
      uuid: 'highlight-1',
      documentId: 'document-1',
      threadId: 31,
    } as DeleteUnthreadedAnchorResponse);

    expect({
      anchorUuids: annotations.anchors()?.map((anchor) => anchor.uuid),
      commentThreads: annotations.commentThreads(),
    }).toEqual({
      anchorUuids: ['highlight-2'],
      commentThreads: [],
    });
    dispose();
  });

  it('projects server anchors and threads into highlights', async () => {
    const { annotations, dispose } = setup('document-1');
    await waitForInitialResources(annotations);
    const anchor = createServerHighlight('highlight-1', 31);

    annotations.commands.applyCreatedAnchor(anchor);
    expect(annotations.highlightsByUuid()).toEqual({});

    annotations.commands.applyCreatedComment(createCommentResponse(31, 41));

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
          threadId: 31,
          rootId: 41,
          anchorId: 'highlight-1',
          page: 2,
          comments: [
            {
              commentId: 41,
              threadId: 31,
              owner: 'user-1',
              text: 'first comment',
            },
          ],
          isResolved: false,
        },
      });
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

describe('createPdfAnnotations on the message API', () => {
  async function waitForAnchors(annotations: PdfAnnotations) {
    await waitFor(() => expect(annotations.anchors()).toEqual([]));
  }

  it('reads the document discussion instead of the legacy comments', async () => {
    const { annotations, dispose } = setup('document-1', true);
    await waitForAnchors(annotations);

    expect({
      unified: annotations.unified,
      messageParents: messageRoots.parents,
      legacyCommentQueries: annotationQueries.getPdfComments.mock.calls.length,
      commentThreads: annotations.commentThreads(),
    }).toEqual({
      unified: true,
      messageParents: ['document:document-1'],
      legacyCommentQueries: 0,
      commentThreads: undefined,
    });
    dispose();
  });

  it('projects anchors and their discussion roots into highlights', async () => {
    const { annotations, dispose } = setup('document-1', true);
    await waitForAnchors(annotations);

    annotations.commands.applyCreatedAnchor(
      createServerHighlight('highlight-1', undefined, 'root-1')
    );
    // A threaded highlight waits for its discussion.
    expect(annotations.highlightsByUuid()).toEqual({});

    messageRoots.setRoots([root('root-1')]);
    await waitFor(() => {
      expect(annotations.highlightsByUuid()['highlight-1']?.thread).toEqual({
        threadId: 'root-1',
        rootId: 'root-1',
        anchorId: 'highlight-1',
        page: 2,
        comments: [root('root-1')],
        replyCount: 0,
        isResolved: false,
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

  it('keeps open comment drafts when the discussion or anchors change', async () => {
    const { annotations, dispose } = setup('document-1', true);
    await waitForAnchors(annotations);
    annotations.commands.applyCreatedAnchor(
      createServerHighlight('existing-highlight')
    );
    await waitFor(() =>
      expect(annotations.highlightsByUuid()['existing-highlight']).toBeTruthy()
    );
    const existing = annotations.highlightsByUuid()['existing-highlight']!;
    annotations.commands.beginExistingHighlightCommentDraft(existing);
    annotations.commands.beginNewHighlightCommentDrafts([
      createHighlight('new-highlight'),
    ]);

    // Another client posts a discussion and an unrelated anchor arrives.
    messageRoots.setRoots([root('root-9')]);
    annotations.commands.applyCreatedAnchor(
      createServerHighlight('other-highlight')
    );

    await waitFor(() =>
      expect(annotations.highlightsByUuid()['other-highlight']).toBeTruthy()
    );
    expect({
      existing:
        annotations.highlightsByUuid()['existing-highlight']?.hasTempThread,
      created: annotations.highlightsByUuid()['new-highlight']?.hasTempThread,
    }).toEqual({ existing: true, created: true });

    // Once the server holds a draft's highlight with its discussion, the
    // draft gives way to the saved thread.
    messageRoots.setRoots([root('root-9'), root('root-10')]);
    annotations.commands.applyCreatedAnchor(
      createServerHighlight('new-highlight', undefined, 'root-10')
    );
    await waitFor(() =>
      expect(
        annotations.highlightsByUuid()['new-highlight']?.thread?.threadId
      ).toBe('root-10')
    );
    expect(annotations.highlightsByUuid()['new-highlight']?.hasTempThread).toBe(
      false
    );
    dispose();
  });

  it('binds a posted root to its anchor and releases anchors of a deleted discussion', async () => {
    const { annotations, dispose } = setup('document-1', true);
    await waitForAnchors(annotations);
    messageRoots.setRoots([root('root-1'), root('root-2')]);

    annotations.commands.applyCreatedAnchor(
      createServerHighlight('highlight-1')
    );
    annotations.commands.applyCreatedAnchor(
      createServerPlaceable('placeable-1', { rootId: 'root-2' })
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
});

/**
 * Production runs both paths on the same documents. Imported anchors carry
 * both ids; an anchor written by one path carries only its own. Neither client
 * may treat the other's discussion as a bare highlight it can delete or
 * re-thread.
 */
describe('anchors shared between legacy and message clients', () => {
  const messageHighlight = () =>
    createServerHighlight('message-highlight', undefined, 'root-1');
  const legacyHighlight = () => createServerHighlight('legacy-highlight', 31);
  const importedHighlight = () =>
    createServerHighlight('imported-highlight', 32, 'root-2');
  const bareHighlight = () => createServerHighlight('bare-highlight');

  function seed(annotations: PdfAnnotations) {
    for (const anchor of [
      messageHighlight(),
      legacyHighlight(),
      importedHighlight(),
      bareHighlight(),
      createServerPlaceable('message-placeable', { rootId: 'root-3' }),
      createServerPlaceable('legacy-placeable', { threadId: 33 }),
    ])
      annotations.commands.applyCreatedAnchor(anchor);
  }

  const threadIdsByAnchor = (annotations: PdfAnnotations) =>
    Object.fromEntries(
      (annotations.anchors() ?? []).map((anchor) => [
        anchor.uuid,
        annotations.anchorThread(anchor)?.threadId ??
          annotations.anchorThread(anchor),
      ])
    );

  it('keeps a legacy client off anchors created through the message path', async () => {
    const { annotations, dispose } = setup('document-1', false);
    await waitForInitialResources(annotations);
    // The message roots exist, but a legacy client never reads them.
    messageRoots.setRoots([root('root-1'), root('root-2'), root('root-3')]);
    seed(annotations);
    for (const threadId of [31, 32, 33])
      annotations.commands.applyCreatedComment(
        createCommentResponse(threadId, threadId + 10)
      );

    await waitFor(() => {
      expect(Object.keys(annotations.highlightsByUuid()).sort()).toEqual([
        'bare-highlight',
        'imported-highlight',
        'legacy-highlight',
      ]);
    });
    expect(threadIdsByAnchor(annotations)).toEqual({
      'message-highlight': undefined,
      'legacy-highlight': 31,
      'imported-highlight': 32,
      'bare-highlight': null,
      'message-placeable': undefined,
      'legacy-placeable': 33,
    });
    // Hidden, so it is never offered as a highlight to delete or comment on.
    expect(annotations.highlightsByUuid()['message-highlight']).toBeUndefined();
    dispose();
  });

  it('keeps a message client off anchors only a legacy thread holds', async () => {
    const { annotations, dispose } = setup('document-1', true);
    await waitFor(() => expect(annotations.anchors()).toEqual([]));
    messageRoots.setRoots([root('root-1'), root('root-2'), root('root-3')]);
    seed(annotations);

    await waitFor(() => {
      expect(Object.keys(annotations.highlightsByUuid()).sort()).toEqual([
        'bare-highlight',
        'imported-highlight',
        'message-highlight',
      ]);
    });
    expect(threadIdsByAnchor(annotations)).toEqual({
      'message-highlight': 'root-1',
      'legacy-highlight': undefined,
      'imported-highlight': 'root-2',
      'bare-highlight': null,
      'message-placeable': 'root-3',
      'legacy-placeable': undefined,
    });
    dispose();
  });

  it('shows a highlight whose message discussion was deleted as bare to both clients', async () => {
    // The server detaches a highlight when its discussion is deleted.
    const detached = { ...messageHighlight(), rootId: null };
    for (const unified of [false, true]) {
      const { annotations, dispose } = setup('document-1', unified);
      await waitFor(() => expect(annotations.anchors()).toEqual([]));
      annotations.commands.applyCreatedAnchor(detached);
      await waitFor(() => {
        expect(
          annotations.highlightsByUuid()['message-highlight']?.thread
        ).toBeNull();
      });
      dispose();
    }
  });
});
