import { formatLocale, t } from '@app/lib/i18n';
import type {
  GatedOperation,
  PermissionAction,
} from '@service-agent-harness/generated/schemas';
import { match } from 'ts-pattern';
import { type GatedThing, gatedThings } from '../core/gated-operations';

/** Things named before "and N more things". */
const MAX_THINGS = 3;

/**
 * A group's name inside a sentence: lower case, keeping acronyms
 * ("Contacts & CRM" reads "contacts & CRM", "AI chats" reads "AI chats").
 */
function groupInSentence(groupName: string): string {
  return groupName
    .split(' ')
    .map((word) =>
      /\p{Lu}.*\p{Lu}/u.test(word)
        ? word
        : word.toLocaleLowerCase(formatLocale())
    )
    .join(' ');
}

/**
 * "send email", "edit documents", with the action and the entity each in an
 * `<em>` the request card accents.
 */
function markedThingPhrase(thing: GatedThing): string {
  const group = groupInSentence(thing.groupName);
  return match(thing.action)
    .with('create', () => t('agentPermissionsChat.createThing', { group }))
    .with('read', () => t('agentPermissionsChat.readThing', { group }))
    .with('update', () => t('agentPermissionsChat.updateThing', { group }))
    .with('destroy', () => t('agentPermissionsChat.destroyThing', { group }))
    .with('send', () => t('agentPermissionsChat.sendThing', { group }))
    .with(null, () => t('agentPermissionsChat.useThing', { group }))
    .exhaustive();
}

/** A run of a sentence; `accent` for the words a request card colors. */
export type PhrasePart = { text: string; accent: boolean };

const MARKED = /<em>(.*?)<\/em>/g;

function markedParts(text: string): PhrasePart[] {
  const parts: PhrasePart[] = [];
  let last = 0;
  for (const found of text.matchAll(MARKED)) {
    if (found.index > last) {
      parts.push({ text: text.slice(last, found.index), accent: false });
    }
    parts.push({ text: found[1], accent: true });
    last = found.index + found[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), accent: false });
  return parts;
}

/** The things as one marked list: "<em>send</em> <em>email</em> and …". */
function markedGatedThings(operations: readonly GatedOperation[]): string {
  const things = gatedThings(operations);
  const named = things.slice(0, MAX_THINGS).map(markedThingPhrase);
  const rest = things.length - named.length;
  if (rest > 0) {
    named.push(t('agentPermissionsChat.moreThings', { count: rest }));
  }
  return new Intl.ListFormat(formatLocale(), {
    style: 'long',
    type: 'conjunction',
  }).format(named);
}

/**
 * What the operations let a program do, as one list in the interface
 * language: "send email and edit documents", "delete email, send messages,
 * create tasks and 2 more things".
 */
export function describeGatedThings(
  operations: readonly GatedOperation[]
): string {
  return markedGatedThings(operations).replace(MARKED, '$1');
}

/** "Send email and edit documents", as a row's title. */
export function gatedThingsTitle(
  operations: readonly GatedOperation[]
): string {
  const things = describeGatedThings(operations);
  return things.charAt(0).toLocaleUpperCase(formatLocale()) + things.slice(1);
}

// The template's own placeholders, kept as they are so the sentence can be
// split around them: the agent's name is never read for marks.
const AGENT_SLOT = '{{agent}}';
const THINGS_SLOT = '{{things}}';
const SLOTS = /(\{\{agent\}\}|\{\{things\}\})/;

/**
 * "Allow Scout to send email and edit documents?", in parts: the agent's
 * name plain, each action and entity accented.
 */
export function permissionRequestParts(
  agent: string,
  operations: readonly GatedOperation[]
): PhrasePart[] {
  // A hold whose operations this build can't read still asks for something.
  if (operations.length === 0) {
    return [
      { text: t('agentPermissionsChat.allowRun', { agent }), accent: false },
    ];
  }
  const template = t('agentPermissionsChat.allowRequest', {
    agent: AGENT_SLOT,
    things: THINGS_SLOT,
  });
  return template.split(SLOTS).flatMap((piece): PhrasePart[] =>
    match(piece)
      .with(AGENT_SLOT, () => [{ text: agent, accent: false }])
      .with(THINGS_SLOT, () => markedParts(markedGatedThings(operations)))
      .with('', () => [])
      .otherwise(() => [{ text: piece, accent: false }])
  );
}

/** An action's name beside an operation: "Send", "Delete". */
export function gatedActionName(
  action: PermissionAction | null | undefined
): string {
  return match(action ?? null)
    .with('create', () => t('agentPermissionsChat.actionCreate'))
    .with('read', () => t('agentPermissionsChat.actionRead'))
    .with('update', () => t('agentPermissionsChat.actionUpdate'))
    .with('destroy', () => t('agentPermissionsChat.actionDestroy'))
    .with('send', () => t('agentPermissionsChat.actionSend'))
    .with(null, () => t('agentPermissionsChat.actionOther'))
    .exhaustive();
}
