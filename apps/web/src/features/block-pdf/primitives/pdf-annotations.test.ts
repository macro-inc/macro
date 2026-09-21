import type { CreateCommentResponse } from '@service-storage/generated/schemas/createCommentResponse';
import type { CreateUnthreadedAnchorResponse } from '@service-storage/generated/schemas/createUnthreadedAnchorResponse';
import type { DeleteCommentResponse } from '@service-storage/generated/schemas/deleteCommentResponse';
import type { DeleteUnthreadedAnchorResponse } from '@service-storage/generated/schemas/deleteUnthreadedAnchorResponse';
import type { EditAnchorResponse } from '@service-storage/generated/schemas/editAnchorResponse';
import type { EditCommentResponse } from '@service-storage/generated/schemas/editCommentResponse';
import { waitFor } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IHighlight } from '../model/Highlight';
import { createPdfAnnotations, type PdfAnnotations } from './pdf-annotations';

const annotationQueries = vi.hoisted(() => ({
  getPdfAnchors: vi.fn(async (_documentId: string) => []),
  getPdfComments: vi.fn(async (_documentId: string) => []),
}));

vi.mock('../queries/annotations', () => annotationQueries);

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
  threadId?: number
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
