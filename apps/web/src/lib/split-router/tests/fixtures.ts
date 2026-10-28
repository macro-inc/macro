import { z } from 'zod';
import type { SplitCloseAction, SplitPanePolicy } from '../router/types';
import { defineRoute, defineRoutes } from '../routes/define';
import type { PaneId, SplitLocation } from '../routes/types';

export const documentRoute = defineRoute({
  id: 'drive-document',
  path: ':documentType/:documentId',
  params: z.object({
    documentType: z.enum(['md', 'pdf']),
    documentId: z.string().min(1),
  }),
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${documentType}:${documentId}`,
  }),
  remountKey: ({ documentId }) => documentId,
});

export const folderRoute = defineRoute({
  id: 'drive-folder',
  path: 'folder/:folderId?',
  params: z.object({ folderId: z.string().min(1).optional() }),
});

export const driveRoute = defineRoute({
  id: 'drive',
  path: 'drive',
  search: ['drive'],
  children: [folderRoute, documentRoute],
});

export const threadRoute = defineRoute({
  id: 'mail-thread',
  path: ':threadId',
  claim: ({ threadId }) => ({ namespace: 'block', id: `email:${threadId}` }),
});

export const mailRoute = defineRoute({
  id: 'mail',
  path: 'mail',
  children: [threadRoute],
});

export const blockRoute = defineRoute({
  id: 'block',
  path: ':type/:id',
  params: z.object({
    type: z.enum(['md', 'pdf', 'channel']),
    id: z.string().min(1),
  }),
  claim: ({ type, id }) => ({ namespace: 'block', id: `${type}:${id}` }),
});

export const homeRoute = defineRoute({ id: 'home', path: 'home' });

export const notFoundRoute = defineRoute({
  id: 'not-found',
  path: '*segments',
});

/** Declared out of order on purpose: matching must rank by specificity. */
export const appRoute = defineRoute({
  id: 'app',
  children: [notFoundRoute, blockRoute, homeRoute, mailRoute, driveRoute],
});

export const loginRoute = defineRoute({
  id: 'login',
  path: 'login',
  externalSearch: '*',
});

export const appRoutes = defineRoutes({
  definitions: [loginRoute, appRoute],
  globalSearch: ['referral_code'],
  defaultRoute: () => ({
    matches: [
      { id: 'app', params: {} },
      { id: 'home', params: {} },
    ],
  }),
});

/** A location under the app route, whose children are the pane routes. */
export function appLocation(id: string, params = {}): SplitLocation {
  return {
    route: {
      matches: [
        { id: 'app', params: {} },
        { id, params },
      ],
    },
  };
}

export const homeLocation = appLocation('home');

/**
 * Opens new panes after their source, or in the source once `maxPanes` are
 * open. Closing the last pane goes home instead; pinned panes never close.
 */
export function createTestPolicy(
  options: {
    maxPanes?: number;
    pinned?: readonly PaneId[];
    closeLast?: SplitCloseAction;
  } = {}
) {
  const activated: PaneId[] = [];
  const placements: Parameters<SplitPanePolicy['placeNewPane']>[0][] = [];

  const policy: SplitPanePolicy = {
    placeNewPane(request) {
      placements.push(request);

      const { source, panes, opening } = request;
      const isFull = panes.length + opening >= (options.maxPanes ?? Infinity);
      if (isFull) return { pane: source ?? panes.at(-1)! };

      const insertAt = source ? panes.indexOf(source) + 1 : panes.length;

      return { insertAt };
    },

    closeAction: ({ pane, panes }) => {
      const isPinned = options.pinned?.includes(pane);
      if (isPinned) return { type: 'keep' };
      if (panes.length > 1) return { type: 'remove' };

      const goHome: SplitCloseAction = {
        type: 'navigate',
        destination: homeLocation,
      };

      return options.closeLast ?? goHome;
    },

    activate: (pane) => {
      activated.push(pane);
    },
  };

  return { policy, activated, placements };
}
