import type { TriggerOrigin } from '../../../generated/agent-harness/types.gen';
import type { MacroClient } from '../../utils/client';
import { Agent } from '../agents/agent';
import { Message } from '../channels/message';
import { Initiative } from '../initiatives/initiative';
import { Routine } from '../routines/routine';
import { Task } from '../tasks/task';
import { User } from '../users/user';
import { AgentSession } from './agent-session';

/** The first non-agent cause of an agent's work. */
export type SessionOriginRoot =
  | { type: 'person'; user: User }
  | { type: 'routine'; routine: Routine };

/** Where an acting agent's own work came from. */
export type SessionOriginLineage =
  | {
      type: 'session';
      /** The session the agent acted from. */
      session: AgentSession;
      /** Where the chain of agents started. */
      root: SessionOriginRoot;
    }
  /** An agent acted, but its session was not captured. */
  | { type: 'unattributed' };

/** Who did something that opened a session. */
export type SessionOriginCaller =
  | { type: 'person'; user: User }
  | {
      type: 'agent';
      /** The agent that acted. */
      agent: Agent;
      /** The person it acted for. */
      onBehalfOf: User;
      /** Where the agent's own work came from. */
      lineage: SessionOriginLineage;
    };

/** What opened a session. */
export type SessionOrigin =
  /** A message mentioned the agent. `message` is set for channel messages. */
  | { kind: 'mentioned'; by: SessionOriginCaller; message?: Message }
  /** A person wrote in their private conversation with the agent. */
  | { kind: 'conversation'; by: User; message?: Message }
  /** The agent was added to a task's assignees. */
  | { kind: 'task_assigned'; by: SessionOriginCaller; task: Task }
  /** The task joined a project, and inherited the project's agents. */
  | {
      kind: 'project_inherited';
      by: SessionOriginCaller;
      task: Task;
      project: Initiative;
    }
  /** A person opened the session directly, from the composer. */
  | { kind: 'requested'; by: User }
  /** A tool handed the agent work, under this user's authority. */
  | { kind: 'dispatched'; onBehalfOf: User }
  /**
   * A routine fired: a schedule came due, its owner ran it, an event it
   * watches happened, or its owner's phone arrived at or left one of its places.
   */
  | {
      kind: 'routine';
      routine: Routine;
      firing: 'scheduled' | 'manual' | 'event' | 'location';
    }
  /** Nothing recorded it: an older session, or an unclaimed warm one. */
  | { kind: 'unknown' };

type RawCaller = Extract<TriggerOrigin, { origin: 'mentioned' }>['by'];

type RawLineage = Extract<RawCaller, { type: 'agent' }>['lineage'];

function originLineage(
  client: MacroClient,
  lineage: RawLineage
): SessionOriginLineage {
  if (lineage.type === 'unattributed') {
    return { type: 'unattributed' };
  }

  return {
    type: 'session',
    session: AgentSession.byId(client, lineage.session),
    root:
      lineage.root.type === 'person'
        ? { type: 'person', user: User.byId(client, lineage.root.user) }
        : {
            type: 'routine',
            routine: Routine.byId(client, lineage.root.routine),
          },
  };
}

function originCaller(
  client: MacroClient,
  caller: RawCaller
): SessionOriginCaller {
  if (caller.type === 'person') {
    return { type: 'person', user: User.byId(client, caller.user) };
  }

  return {
    type: 'agent',
    agent: Agent.byId(client, caller.bot),
    onBehalfOf: User.byId(client, caller.on_behalf_of),
    lineage: originLineage(client, caller.lineage),
  };
}

/**
 * A session's origin as handles. A message handle needs its channel, which is
 * the session's own thread channel; other parents leave `message` unset.
 */
export function sessionOrigin(
  client: MacroClient,
  origin: TriggerOrigin,
  channelId: string | undefined
): SessionOrigin {
  const message = (id: string) =>
    channelId ? Message.byId(client, channelId, id) : undefined;

  switch (origin.origin) {
    case 'mentioned':
      return {
        kind: 'mentioned',
        by: originCaller(client, origin.by),
        message: message(origin.message_id),
      };

    case 'conversation':
      return {
        kind: 'conversation',
        by: User.byId(client, origin.by),
        message: message(origin.message_id),
      };

    case 'task_assigned':
      return {
        kind: 'task_assigned',
        by: originCaller(client, origin.by),
        task: Task.byId(client, origin.task),
      };

    case 'project_inherited':
      return {
        kind: 'project_inherited',
        by: originCaller(client, origin.by),
        task: Task.byId(client, origin.task),
        project: Initiative.byId(client, origin.project),
      };

    case 'requested':
      return { kind: 'requested', by: User.byId(client, origin.by) };

    case 'dispatched':
      return {
        kind: 'dispatched',
        onBehalfOf: User.byId(client, origin.on_behalf_of),
      };

    case 'routine':
      return {
        kind: 'routine',
        routine: Routine.byId(client, origin.routine),
        firing: origin.firing.type,
      };

    case 'unknown':
      return { kind: 'unknown' };
  }
}
