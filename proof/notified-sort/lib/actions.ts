// The write steps a sequence draws from, each through the service a user's
// client would call: notifications through the ingress queue (so they are
// pushed to open pages), notification state and mutes through the
// notification service, renames, moves, deletes and shares through the
// document storage service, participants through the channels API. A step
// that the backend refuses is recorded with its status, not retried.

import { queueNotify } from './notify.ts';
import type { Rng } from './rng.ts';
import { sender } from './setup.ts';
import { call, HttpError, q, sql, type Stack, type User } from './stack.ts';
import { ODD_NAMES, type Entity, type World } from './world.ts';

export type StepKind =
  | 'notify'
  | 'notify-burst'
  | 'seen'
  | 'done'
  | 'undone'
  | 'delete-notification'
  | 'mute'
  | 'unmute'
  | 'snooze'
  | 'mentions-only'
  | 'rename'
  | 'move'
  | 'delete'
  | 'restore'
  | 'share-public'
  | 'revoke'
  | 'role'
  | 'team-share'
  | 'team-unshare'
  | 'participant-remove'
  | 'participant-add'
  | 'create';

export const STEP_WEIGHTS: [StepKind, number][] = [
  ['notify', 8],
  ['notify-burst', 2],
  ['seen', 3],
  ['done', 3],
  ['undone', 1.5],
  ['delete-notification', 1],
  ['mute', 1],
  ['unmute', 1],
  ['snooze', 1],
  ['mentions-only', 0.5],
  ['rename', 2],
  ['move', 1],
  ['delete', 0.7],
  ['restore', 0.7],
  ['share-public', 1],
  ['revoke', 1],
  ['role', 1],
  ['team-share', 0.7],
  ['team-unshare', 0.7],
  ['participant-remove', 1],
  ['participant-add', 1],
  ['create', 1],
];

export type StepResult = {
  kind: StepKind;
  entity: string;
  entityKind: string;
  access: string;
  ok: boolean;
  status?: number;
  note?: string;
  ms: number;
};

export type ActionContext = {
  stack: Stack;
  queueUrl: string;
  world: World;
  users: Map<string, User>;
  viewer: string;
  rng: Rng;
  /** Entities created during the run, per viewer. */
  created: Entity[];
};

const docLike = (e: Entity) => e.kind === 'document' || e.kind === 'task';

function mine(ctx: ActionContext): Entity[] {
  return [...ctx.world.entities.filter((e) => e.viewer === ctx.viewer), ...ctx.created];
}

function userOf(ctx: ActionContext, key: string): User {
  const user = ctx.users.get(key);
  if (!user) throw new Error(`no signed-in user ${key}`);
  return user;
}

/** The viewer's notifications on an entity, in the given states. */
async function notificationIds(ctx: ActionContext, entity: Entity, states: string[]): Promise<string[]> {
  const viewer = userOf(ctx, ctx.viewer).macroUserId;
  const primary = entity.channel && entity.kind !== 'document' ? entity.channel.id : entity.id;
  const secondary = entity.kind === 'thread' ? ` AND n.secondary_event_item_id = ${q(entity.id)}` : '';
  const rows = await sql<{ id: string }>(
    ctx.stack,
    `SELECT un.notification_id::text AS id FROM user_notification un JOIN notification n ON n.id = un.notification_id WHERE un.user_id = ${q(viewer)} AND un.event_item_id = ${q(primary)} AND un.deleted_at IS NULL AND un.state::text IN (${states.map(q).join(',')})${secondary} ORDER BY un.created_at DESC LIMIT 20`
  );
  return rows.map((r) => r.id);
}

function muteType(entity: Entity): string {
  if (entity.kind === 'thread') return 'channel';
  return entity.itemType;
}

function muteId(entity: Entity): string {
  return entity.kind === 'thread' && entity.channel ? entity.channel.id : entity.id;
}

/** Runs one step of the given kind on a random fitting entity. */
export async function runStep(ctx: ActionContext, kind: StepKind): Promise<StepResult> {
  const started = Date.now();
  const all = mine(ctx);
  const pick = (pool: Entity[]) => (pool.length ? ctx.rng.pick(pool) : undefined);
  let entity: Entity | undefined;
  const result = (ok: boolean, extra: Partial<StepResult> = {}): StepResult => ({
    kind,
    entity: entity?.key ?? '-',
    entityKind: entity?.kind ?? '-',
    access: entity?.access ?? '-',
    ok,
    ms: Date.now() - started,
    ...extra,
  });
  try {
    const viewer = userOf(ctx, ctx.viewer);
    switch (kind) {
      case 'notify':
      case 'notify-burst': {
        entity = pick(all);
        if (!entity) return result(false, { note: 'no entity' });
        const count = kind === 'notify' ? 1 : ctx.rng.int(2, 5);
        const targets = kind === 'notify' ? [entity] : [entity, ...Array.from({ length: count - 1 }, () => ctx.rng.pick(all))];
        let written = 0;
        await Promise.all(
          targets.map(async (target) => {
            const sent = await queueNotify(ctx.stack, ctx.queueUrl, target, [viewer.macroUserId], sender(ctx.world, target), ctx.rng);
            if (sent.written) written += 1;
          })
        );
        return result(true, { note: `${written}/${targets.length} written` });
      }
      case 'seen':
      case 'done':
      case 'undone':
      case 'delete-notification': {
        const states = kind === 'undone' ? ['done'] : kind === 'delete-notification' ? ['unseen', 'seen', 'done'] : kind === 'seen' ? ['unseen'] : ['unseen', 'seen'];
        // Prefer an entity that has a notification in the right state.
        for (const candidate of ctx.rng.shuffle(all).slice(0, 12)) {
          const ids = await notificationIds(ctx, candidate, states);
          if (!ids.length) continue;
          entity = candidate;
          const chosen = ctx.rng.bool(0.7) ? ids : ids.slice(0, 1);
          if (kind === 'delete-notification') {
            await call(ctx.stack, viewer, '/notification/user_notifications/bulk', { method: 'DELETE', body: { notificationIds: chosen } });
          } else {
            await call(ctx.stack, viewer, `/notification/user_notifications/bulk/${kind}`, { method: 'PATCH', body: { notificationIds: chosen } });
          }
          return result(true, { note: `${chosen.length} notifications` });
        }
        return result(false, { note: 'no notification in state' });
      }
      case 'mute':
      case 'unmute':
      case 'snooze':
      case 'mentions-only': {
        // Only channels take mentions-only.
        entity = pick(kind === 'mentions-only' ? all.filter((e) => e.kind === 'channel' || e.kind === 'thread') : all);
        if (!entity) return result(false, { note: 'no entity' });
        const base = `/notification/unsubscribe/item/${muteType(entity)}/${muteId(entity)}`;
        if (kind === 'unmute') await call(ctx.stack, viewer, base, { method: 'DELETE' });
        else if (kind === 'mute') await call(ctx.stack, viewer, base, { method: 'POST' });
        else if (kind === 'snooze') {
          const until = new Date(Date.now() + ctx.rng.pick([2, 60, 600]) * 1000).toISOString();
          await call(ctx.stack, viewer, `${base}?snoozed_until=${encodeURIComponent(until)}`, { method: 'POST' });
        } else await call(ctx.stack, viewer, `${base}?mentions_only=true`, { method: 'POST' });
        return result(true);
      }
      case 'rename': {
        entity = pick(all.filter((e) => docLike(e) && e.access !== 'revoked'));
        if (!entity) return result(false, { note: 'no document' });
        const owner = userOf(ctx, entity.owner);
        const name = ctx.rng.bool(0.5) ? `${ctx.rng.pick(ODD_NAMES)} r${ctx.rng.int(1, 999)}` : `Renamed ${ctx.rng.int(1, 99999)}`;
        await call(ctx.stack, owner, `/dss/documents/${entity.id}`, { method: 'PATCH', body: { documentName: name.slice(0, 200) } });
        return result(true);
      }
      case 'move': {
        entity = pick(all.filter((e) => docLike(e) && e.owner === ctx.viewer && e.access !== 'deleted'));
        const project = pick(all.filter((e) => e.kind === 'project' && e.owner === ctx.viewer));
        if (!entity || !project) return result(false, { note: 'nothing to move' });
        await call(ctx.stack, viewer, `/dss/documents/${entity.id}`, {
          method: 'PATCH',
          body: { projectId: ctx.rng.bool(0.7) ? project.id : null },
        });
        return result(true);
      }
      case 'delete':
      case 'restore': {
        entity = pick(all.filter((e) => docLike(e) && e.owner !== 'd'));
        if (!entity) return result(false, { note: 'no document' });
        const owner = userOf(ctx, entity.owner);
        if (kind === 'delete') await call(ctx.stack, owner, `/dss/documents/${entity.id}`, { method: 'DELETE' });
        else await call(ctx.stack, owner, `/dss/documents/${entity.id}/revert_delete`, { method: 'PUT' });
        return result(true);
      }
      case 'share-public':
      case 'revoke':
      case 'role': {
        entity = pick(all.filter((e) => e.kind === 'document' && e.owner !== ctx.viewer));
        if (!entity) return result(false, { note: 'no shared document' });
        const owner = userOf(ctx, entity.owner);
        const sharePermission =
          kind === 'share-public'
            ? { linkShare: 'PUBLIC', linkShareAccessLevel: 'view' }
            : kind === 'revoke'
              ? { linkShare: null }
              : { linkShare: 'PUBLIC', linkShareAccessLevel: ctx.rng.pick(['view', 'comment', 'edit']) };
        await call(ctx.stack, owner, `/dss/documents/${entity.id}`, { method: 'PATCH', body: { sharePermission } });
        return result(true);
      }
      case 'team-share':
      case 'team-unshare': {
        entity = pick(all.filter((e) => e.kind === 'document' && (e.owner === 'b' || e.owner === 'c')));
        if (!entity) return result(false, { note: 'no team document' });
        const owner = userOf(ctx, entity.owner);
        await call(ctx.stack, owner, `/dss/documents/${entity.id}/team_share`, {
          method: 'PUT',
          body: { shareWithTeam: kind === 'team-share' },
        });
        return result(true);
      }
      case 'participant-remove':
      case 'participant-add': {
        entity = pick(all.filter((e) => e.kind === 'channel' && (e.channel?.type === 'public' || e.channel?.type === 'private')));
        if (!entity?.channel) return result(false, { note: 'no channel' });
        // The channel's owner changes its members: 'b' owns the seeded ones, and
        // a created channel belongs to whoever created it.
        const owner = userOf(ctx, entity.owner);
        await call(ctx.stack, owner, `/dss/channels/${entity.channel.id}/participants`, {
          method: kind === 'participant-add' ? 'POST' : 'DELETE',
          body: { participants: [viewer.macroUserId] },
        });
        return result(true);
      }
      case 'create': {
        // Another user starts a private channel with the viewer and posts in
        // it (a document upload needs S3, which the local stack refuses).
        const owner = userOf(ctx, ctx.rng.pick(['b', 'c']));
        const name = ctx.rng.bool(0.4) ? `${ctx.rng.pick(ODD_NAMES)} new` : `Created ${ctx.rng.int(1, 99999)}`;
        const created = await call<{ id: string }>(ctx.stack, owner, '/dss/channels', {
          method: 'POST',
          body: { name: name.slice(0, 60), channel_type: 'private', participants: [viewer.macroUserId, owner.macroUserId] },
        });
        entity = {
          key: `${ctx.viewer}-created-${created.id.slice(0, 8)}`,
          kind: 'channel',
          itemType: 'channel',
          id: created.id,
          name,
          owner: owner.key,
          access: 'member',
          viewer: ctx.viewer,
          channel: { key: `created-${created.id}`, id: created.id, type: 'private' },
        };
        ctx.created.push(entity);
        await queueNotify(ctx.stack, ctx.queueUrl, entity, [viewer.macroUserId], owner.macroUserId, ctx.rng);
        return result(true);
      }
    }
  } catch (error) {
    if (error instanceof HttpError) return result(false, { status: error.status, note: error.message.slice(0, 200) });
    return result(false, { note: String(error).slice(0, 200) });
  }
}
