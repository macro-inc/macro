import {
  explicitNoiseFilter,
  noiseFilter,
  signalFilter,
} from '../inbox-filters';
import {
  notDoneFilter as notDonePredicate,
  sharedEntity as sharedEntityPredicate,
  unreadFilter as unreadPredicate,
} from '../predicates';
import { config, NIL_UUID } from './base';

export const inboxFilter = config({
  id: 'inbox',
  group: 'focus',
  predicate: (e, ctx) =>
    signalFilter(e) &&
    (ctx.notificationSource
      ? notDonePredicate(ctx.notificationSource)(e)
      : false),
  query: {
    include: {
      documentDone: false,
      emailDone: false,
      emailImportance: true,
      channelDone: false,
      chatDone: false,
      folderDone: false,
      foreignEntitySource: ['github_pull_request'],
      foreignEntityDone: false,
    },
    emailView: 'inbox',
  },
});

export const noiseFilterDef = config({
  id: 'noise',
  group: 'focus',
  predicate: (e) => noiseFilter(e),
  query: {
    include: {
      documentDone: false,
      emailDone: false,
      emailImportance: false,
      channelDone: false,
      chatDone: false,
      folderDone: false,
    },
    emailView: 'inbox',
  },
});

export const explicitNoiseFilterDef = config({
  id: 'explicit-noise',
  group: 'focus',
  predicate: (e) => !explicitNoiseFilter(e),
  query: {
    exclude: {
      documentId: [NIL_UUID],
      channelId: [NIL_UUID],
      chatId: [NIL_UUID],
      folderId: [NIL_UUID],
      threadId: [NIL_UUID],
    },
    emailView: 'all',
  },
});

export const unreadFilter = config({
  id: 'unread',
  predicate: (e, ctx) =>
    ctx.notificationSource ? unreadPredicate(ctx.notificationSource)(e) : false,
  query: {
    include: {
      documentSeen: false,
      emailSeen: false,
      channelSeen: false,
      chatSeen: false,
      folderSeen: false,
    },
  },
});

export const readFilter = config({
  id: 'read',
  predicate: (e, ctx) =>
    ctx.notificationSource
      ? !unreadPredicate(ctx.notificationSource)(e)
      : false,
  query: {
    include: {
      documentSeen: true,
      emailSeen: true,
      channelSeen: true,
      chatSeen: true,
      folderSeen: true,
    },
  },
});

export const notDoneFilter = config({
  id: 'not-done',
  predicate: (e, ctx) =>
    ctx.notificationSource
      ? notDonePredicate(ctx.notificationSource)(e)
      : false,
  query: {
    include: {
      documentDone: false,
      emailDone: false,
      channelDone: false,
      chatDone: false,
      folderDone: false,
    },
  },
});

export const doneFilter = config({
  id: 'done',
  predicate: (e, ctx) =>
    ctx.notificationSource
      ? !notDonePredicate(ctx.notificationSource)(e)
      : false,
  query: {
    include: {
      documentDone: true,
      emailDone: true,
      channelDone: true,
      chatDone: true,
      folderDone: true,
    },
  },
});

export const sharedEntityFilter = config({
  id: 'shared-entity',
  predicate: (e, ctx) => sharedEntityPredicate(() => ctx.userId)(e),
  query: (ctx) => ({
    exclude: {
      documentOwnerId: [ctx.userId ?? ''],
      chatOwnerId: [ctx.userId ?? ''],
      folderOwnerId: [ctx.userId ?? ''],
    },
  }),
});

export const ownedEntityFilter = config({
  id: 'owned-entity',
  predicate: (e, ctx) => !sharedEntityPredicate(() => ctx.userId)(e),
  query: (ctx) => ({
    include: {
      documentOwnerId: [ctx.userId ?? ''],
      chatOwnerId: [ctx.userId ?? ''],
      folderOwnerId: [ctx.userId ?? ''],
    },
  }),
});
