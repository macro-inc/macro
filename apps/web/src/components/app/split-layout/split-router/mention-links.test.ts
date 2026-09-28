import { createRoutesManifest, defineRoute } from '@app/lib/split-router';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  createMacroMentionLinkResolver,
  uuidRouteReference,
} from './mention-links';
import { useMacroMentionLinkResolver } from './use-mention-link-resolver';

const documentId = '019507e8-14a3-7bc1-8610-419f16bd03a8';
const folderId = '019507e8-14a3-7bc1-8610-419f16bd03a9';

const routes = createRoutesManifest({
  definitions: [
    defineRoute({
      id: 'drive',
      path: 'drive',
      externalSearch: ['comment_id', 'page'],
      children: [
        defineRoute({
          id: 'drive-call',
          path: 'call/:callId',
          toReference: ({ callId }) => uuidRouteReference(callId, 'call'),
        }),
        defineRoute({
          id: 'renamed-drive-document',
          path: ':documentType/:documentId',
          toReference: ({ documentId, documentType }) =>
            uuidRouteReference(documentId, documentType),
        }),
        defineRoute({
          id: 'drive-folder',
          path: 'folder/:folderId',
          children: [
            defineRoute({
              id: 'drive-folder-document',
              path: ':documentType/:documentId',
              toReference: ({ documentId, documentType }) =>
                uuidRouteReference(documentId, documentType),
            }),
          ],
        }),
        defineRoute({
          id: 'drive-tab',
          path: ':tab',
          children: [
            defineRoute({
              id: 'drive-tab-document',
              path: ':documentType/:documentId',
              toReference: ({ documentId, documentType }) =>
                uuidRouteReference(documentId, documentType),
            }),
          ],
        }),
      ],
    }),
    defineRoute({
      id: 'view-tasks',
      path: 'tasks',
      children: [
        defineRoute({
          id: 'tasks-task',
          path: ':taskId',
          toReference: ({ taskId }) => uuidRouteReference(taskId, 'task'),
        }),
      ],
    }),
    defineRoute({
      id: 'view-inbox',
      path: 'inbox',
      children: [
        defineRoute({
          id: 'inbox-document',
          path: ':documentType/:documentId',
          toReference: ({ documentId, documentType }) =>
            uuidRouteReference(documentId, documentType),
        }),
      ],
    }),
    defineRoute({
      id: 'view-channels',
      path: 'channels',
      children: [
        defineRoute({
          id: 'channels-channel',
          path: ':channelId',
          toReference: ({ channelId }) =>
            uuidRouteReference(channelId, 'channel'),
        }),
      ],
    }),
    defineRoute({
      id: 'view-mail',
      path: 'mail',
      children: [
        defineRoute({
          id: 'mail-thread',
          path: ':threadId',
          toReference: ({ threadId }) => uuidRouteReference(threadId, 'email'),
        }),
      ],
    }),
    defineRoute({
      id: 'view-reviews',
      path: 'reviews',
      children: [
        defineRoute({
          id: 'reviews-pr',
          path: 'pr/:foreignEntityId',
          toReference: ({ foreignEntityId }) => ({
            type: 'pr',
            id: foreignEntityId,
          }),
        }),
      ],
    }),
    defineRoute({ id: 'view-settings', path: 'settings' }),
  ],
});

const resolve = createMacroMentionLinkResolver(routes);

describe('Macro route mention links', () => {
  it.each([
    [`/app/drive/md/${documentId}?s0.drive.commentId=target`, 'md'],
    [`/app/drive/folder/${folderId}/pdf/${documentId}`, 'pdf'],
    [`/app/drive/recent/md/${documentId}`, 'md'],
    [`/app/drive/call/${documentId}`, 'call'],
    [`/app/inbox/task/${documentId}`, 'task'],
    [`/app/tasks/${documentId}`, 'task'],
    [`/app/channels/${documentId}`, 'channel'],
    [`/app/mail/${documentId}`, 'email'],
    [`/app/reviews/pr/${documentId}`, 'pr'],
  ])('resolves %s as a %s mention', (path, block) => {
    expect(resolve(`${window.location.origin}${path}`)).toEqual({
      id: documentId,
      block,
      params: {},
    });
  });

  it.each([
    `/app/drive/md/not-a-uuid`,
    `/app/drive/folder/${folderId}`,
    `/app/settings`,
    `/app/unknown/${documentId}`,
  ])('leaves unsupported paths as links: %s', (path) => {
    expect(resolve(`${window.location.origin}${path}`)).toBeUndefined();
  });

  it('preserves UUID-shaped identifiers with noncanonical version bits', () => {
    const id = '019507e8-14a3-abcd-1234-419f16bd03a8';
    expect(resolve(`${window.location.origin}/app/drive/md/${id}`)).toEqual({
      id,
      block: 'md',
      params: {},
    });
  });

  it('preserves non-UUID pull request IDs from Reviews routes', () => {
    const id = 'owner/repo/pull/12';
    expect(
      resolve(
        `${window.location.origin}/app/reviews/pr/${encodeURIComponent(id)}`
      )
    ).toEqual({ id, block: 'pr', params: {} });
  });

  it('retains compatible block targets but not pane-local search state', () => {
    const url = `${window.location.origin}/app/drive/md/${documentId}`;
    expect(
      resolve(
        `${url}?comment_id=target&s0.drive.commentId=other&referral_code=ignored`
      )
    ).toEqual({
      id: documentId,
      block: 'md',
      params: { comment_id: 'target' },
    });
  });

  it('leaves standalone editor hosts without a route resolver', () => {
    createRoot((dispose) => {
      expect(useMacroMentionLinkResolver()).toBeUndefined();
      dispose();
    });
  });

  it('rejects foreign hosts', () => {
    expect(
      resolve(`https://example.com/app/drive/md/${documentId}`)
    ).toBeUndefined();
  });
});
