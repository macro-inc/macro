/**
 * What started a prompt, read from the `<m-agent-context>` block the harness
 * puts before it. The block is XML written for the model by
 * `composeAgentContextPrompt` in `@macro-inc/lexical-core`; this reads back
 * the few facts a person needs: what called the agent, where, when, and where
 * to go to see it.
 */

import { Result } from 'neverthrow';
import { match, P } from 'ts-pattern';

const parseJson = Result.fromThrowable(
  (text: string): unknown => JSON.parse(text),
  () => 'invalid json' as const
);

const OPEN = '<m-agent-context>';
const CLOSE = '</m-agent-context>';

/** Somewhere in the app a prompt came from. */
export type OriginDestination =
  | {
      kind: 'channel_message';
      channelId: string;
      messageId: string | undefined;
      threadId: string | undefined;
    }
  | { kind: 'document'; documentId: string; commentId: string | undefined }
  | { kind: 'project'; projectId: string; commentId: string | undefined }
  | { kind: 'crm_company'; companyId: string; commentId: string | undefined }
  | { kind: 'crm_contact'; contactId: string; commentId: string | undefined }
  | { kind: 'call'; callId: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'routine'; routineId: string }
  | { kind: 'email_thread'; threadId: string }
  | { kind: 'agent_session'; sessionId: string }
  | { kind: 'external'; url: string };

/**
 * One line under the prompt: `{lead} {place} {tail}`, with `place` set
 * brighter.
 */
export type PromptOrigin = {
  lead: string;
  place: string | undefined;
  tail: string | undefined;
  destination: OriginDestination | undefined;
};

/** The context text of a prompt part, when the part opens with one. */
export function agentContextText(markdown: string): string | undefined {
  if (!markdown.startsWith(OPEN)) return undefined;
  const end = markdown.indexOf(CLOSE);
  if (end < 0) return undefined;
  const data = parseJson(markdown.slice(OPEN.length, end)).unwrapOr(undefined);
  if (
    typeof data === 'object' &&
    data !== null &&
    'text' in data &&
    typeof data.text === 'string'
  )
    return data.text;
  return undefined;
}

function children(element: Element, tag: string): Element[] {
  return [...element.children].filter((child) => child.tagName === tag);
}

function child(element: Element, tag: string): Element | undefined {
  return children(element, tag)[0];
}

function attribute(
  element: Element | undefined,
  name: string
): string | undefined {
  return element?.getAttribute(name) ?? undefined;
}

/** The message whose `marker` attribute is set, anywhere in `element`. */
function markedMessage(element: Element): Element | undefined {
  return [...element.getElementsByTagName('message')].find((message) =>
    [...message.attributes].some(
      (item) =>
        item.value === 'true' &&
        [
          'mentioned_you',
          'replied_to_you',
          'addressed_to_you',
          'wrote_to_you',
          'fired_routine',
        ].includes(item.name)
    )
  );
}

type Discussion = {
  /** Where, as a reader names it: `#eng`, `a comment on Launch plan`. */
  place: string;
  destination: OriginDestination | undefined;
};

/** The surface and message of a `<discussion>`. */
function readDiscussion(discussion: Element): Discussion | undefined {
  const message = markedMessage(discussion);
  const messageId = attribute(message, 'id');
  const sender = attribute(child(discussion, 'sender'), 'name');
  const surface = [...discussion.children].find((element) =>
    [
      'channel',
      'document',
      'project',
      'crm_company',
      'crm_contact',
      'call',
    ].includes(element.tagName)
  );
  if (!surface) return undefined;
  const id = attribute(surface, 'id') ?? '';
  const name = attribute(surface, 'name');
  const commentOn = (place: string | undefined) =>
    place ? `a comment on ${place}` : 'a comment';

  return match(surface.tagName)
    .with('channel', () => {
      const thread =
        message?.parentElement?.tagName === 'thread'
          ? attribute(message.parentElement, 'root')
          : undefined;
      return {
        place: name
          ? `#${name}`
          : sender
            ? `a DM with ${sender}`
            : 'a direct message',
        destination: {
          kind: 'channel_message' as const,
          channelId: id,
          messageId,
          threadId: thread === messageId ? undefined : thread,
        },
      };
    })
    .with('document', () => ({
      place: commentOn(name),
      destination: {
        kind: 'document' as const,
        documentId: id,
        commentId: messageId,
      },
    }))
    .with('project', () => ({
      place: commentOn(name),
      destination: {
        kind: 'project' as const,
        projectId: id,
        commentId: messageId,
      },
    }))
    .with('crm_company', () => ({
      place: commentOn(name),
      destination: {
        kind: 'crm_company' as const,
        companyId: id,
        commentId: messageId,
      },
    }))
    .with('crm_contact', () => ({
      place: commentOn(name),
      destination: {
        kind: 'crm_contact' as const,
        contactId: id,
        commentId: messageId,
      },
    }))
    .with('call', () => ({
      place: `${attribute(surface, 'title') ?? 'a call'} call chat`,
      destination: { kind: 'call' as const, callId: id },
    }))
    .otherwise(() => undefined);
}

/** `a/b` from a GitHub URL, or the URL itself. */
function repoName(url: string): string {
  const found = /github\.com\/([^/]+\/[^/?#]+)/.exec(url);
  return found ? found[1].replace(/\.git$/, '') : url;
}

/** Why a routine ran, after its name: `every weekday at 9:00`. */
type Firing = {
  tail: string | undefined;
  destination: OriginDestination | undefined;
};

function readFiring(trigger: Element): Firing {
  const scheduled = child(trigger, 'scheduled');
  if (scheduled) {
    const schedule = attribute(scheduled, 'schedule');
    return {
      tail: schedule ? `· ${lowerFirst(schedule)}` : undefined,
      destination: undefined,
    };
  }
  const manual = child(trigger, 'manual');
  if (manual)
    return {
      tail: '· run by hand',
      destination: undefined,
    };
  const event = child(trigger, 'event');
  if (!event) return { tail: undefined, destination: undefined };

  const task = child(event, 'task');
  const taskTitle = attribute(task, 'title') ?? 'a task';
  const taskDestination = task
    ? { kind: 'task' as const, taskId: attribute(task, 'id') ?? '' }
    : undefined;
  const document = child(event, 'document');
  const documentName = attribute(document, 'name') ?? 'a document';
  const documentDestination = document
    ? {
        kind: 'document' as const,
        documentId: attribute(document, 'id') ?? '',
        commentId: undefined,
      }
    : undefined;
  const discussion = child(event, 'discussion');
  const read = discussion ? readDiscussion(discussion) : undefined;
  const sender = discussion
    ? attribute(child(discussion, 'sender'), 'name')
    : undefined;
  const call = child(event, 'call');
  const callTitle = attribute(call, 'title') ?? 'A call';
  const callDestination = call
    ? { kind: 'call' as const, callId: attribute(call, 'id') ?? '' }
    : undefined;
  const email = child(event, 'email');
  const channel = child(event, 'channel');

  return match(attribute(event, 'type'))
    .with('document_created', () => ({
      tail: `· ${documentName} created`,
      destination: documentDestination,
    }))
    .with('document_updated', () => ({
      tail: `· ${documentName} edited`,
      destination: documentDestination,
    }))
    .with('document_deleted', () => ({
      tail: `· ${documentName} deleted`,
      destination: undefined,
    }))
    .with('task_created', () => ({
      tail: `· ${taskTitle} created`,
      destination: taskDestination,
    }))
    .with(P.union('task_status_changed', 'task_priority_changed'), () => {
      const to = attribute(child(event, 'change'), 'to');
      return {
        tail: to ? `· ${taskTitle} moved to ${to}` : `· ${taskTitle} changed`,
        destination: taskDestination,
      };
    })
    .with('task_property_changed', () => ({
      tail: `· ${taskTitle} changed`,
      destination: taskDestination,
    }))
    .with('email_received', () => {
      const from = attribute(email, 'from');
      return {
        tail: from ? `· email from ${senderName(from)}` : '· email received',
        destination: email
          ? {
              kind: 'email_thread' as const,
              threadId: attribute(email, 'thread') ?? '',
            }
          : undefined,
      };
    })
    .with('channel_created', () => {
      const name = attribute(channel, 'name');
      return {
        tail: name ? `· #${name} created` : '· channel created',
        destination: channel
          ? {
              kind: 'channel_message' as const,
              channelId: attribute(channel, 'id') ?? '',
              messageId: undefined,
              threadId: undefined,
            }
          : undefined,
      };
    })
    .with(
      P.union(
        'channel_message_posted',
        'channel_mentioned',
        'channel_message_patched'
      ),
      (type) => {
        const what = match(type)
          .with('channel_message_posted', () => 'message')
          .with('channel_mentioned', () => 'mention')
          .with('channel_message_patched', () => 'edit')
          .exhaustive();
        return {
          tail: read ? `· ${what} in ${read.place}` : `· ${what}`,
          destination: read?.destination,
        };
      }
    )
    .with('channel_message_attachment_created', () => ({
      tail: sender ? `· file from ${sender}` : '· file shared',
      destination: read?.destination,
    }))
    .with('call_started', () => ({
      tail: `· ${callTitle} started`,
      destination: callDestination,
    }))
    .with('call_ended', () => ({
      tail: `· ${callTitle} ended`,
      destination: callDestination,
    }))
    .otherwise(() => ({ tail: undefined, destination: undefined }));
}

/** `Acme Billing` from `Acme Billing <billing@acme.test>`. */
function senderName(from: string): string {
  return from.replace(/\s*<[^>]*>\s*$/, '').trim() || from;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Where a prompt came from, or `undefined` when its context names no trigger
 * (a prompt typed in the session itself, or older unstructured context).
 */
export function promptOrigin(contextText: string): PromptOrigin | undefined {
  const parsed = new DOMParser().parseFromString(
    `<context>${contextText}</context>`,
    'application/xml'
  );
  if (parsed.getElementsByTagName('parsererror').length > 0) return undefined;
  const trigger = child(parsed.documentElement, 'trigger');
  if (!trigger) return undefined;
  const discussion = child(trigger, 'discussion');

  const fromDiscussion = (lead: string, tail?: string) => {
    const read = discussion ? readDiscussion(discussion) : undefined;
    return {
      lead,
      place: read?.place,
      tail,
      destination: read?.destination,
    };
  };

  return match(attribute(trigger, 'kind'))
    .with('mentioned', () => fromDiscussion('via @mention in'))
    .with('follow_up', () =>
      match(attribute(trigger, 'addressed_by'))
        .with('explicit_reply', () => fromDiscussion('via reply in'))
        .with('inferred', () => fromDiscussion('via message in', '(inferred)'))
        .otherwise(() => fromDiscussion('via @mention in'))
    )
    .with('conversation', () => fromDiscussion('via message in'))
    .with('task_assigned', () => {
      const task = child(trigger, 'task');
      const assigned = child(trigger, 'assigned');
      const by = attribute(assigned, 'by');
      return {
        lead: 'via task',
        place: attribute(task, 'title'),
        tail: by ? `from ${by}` : undefined,
        destination: task
          ? { kind: 'task' as const, taskId: attribute(task, 'id') ?? '' }
          : undefined,
      };
    })
    .with('requested', () => {
      const requested = child(trigger, 'requested');
      const repo = attribute(requested, 'repo');
      return {
        lead: repo ? 'via composer in' : 'via composer',
        place: repo ? repoName(repo) : undefined,
        tail: undefined,
        destination: repo
          ? { kind: 'external' as const, url: repo }
          : undefined,
      };
    })
    .with('dispatched', () => {
      const dispatched = child(trigger, 'dispatched');
      const by = attribute(dispatched, 'by');
      const session = attribute(dispatched, 'from_session');
      return {
        lead: 'via handoff from',
        place: 'another agent',
        tail: by ? `for ${by}` : undefined,
        destination: session
          ? { kind: 'agent_session' as const, sessionId: session }
          : undefined,
      };
    })
    .with('routine', () => {
      const routine = child(trigger, 'routine');
      const firing = readFiring(trigger);
      const routineId = attribute(routine, 'id');
      return {
        lead: 'via routine',
        place: attribute(routine, 'name'),
        tail: firing.tail,
        destination:
          firing.destination ??
          (routineId ? { kind: 'routine' as const, routineId } : undefined),
      };
    })
    .otherwise(() => undefined);
}
