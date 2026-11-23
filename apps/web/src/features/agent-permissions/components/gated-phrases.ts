import { formatLocale, t } from '@app/lib/i18n';
import type {
  GatedOperation,
  PermissionAction,
} from '@service-agent-harness/generated/schemas';
import { match } from 'ts-pattern';
import { type GatedThing, gatedThings } from '../core/gated-operations';
import { actionVerb, entityPhrase, pairPhrase } from './gated-thing-phrases';

/** Phrases named before "and N more things". */
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
 * What the things let a program do, one phrase per entity: the actions it
 * says with a verb share the entity ("create, edit, and delete tasks"), and
 * a pair with its own phrase stands alone ("search your workspace"). Each
 * verb and noun is in an `<em>` the request card accents.
 */
function markedThingPhrases(things: readonly GatedThing[]): string[] {
  const verbs = new Intl.ListFormat(formatLocale(), {
    style: 'long',
    type: 'conjunction',
  });
  const phrases: string[] = [];
  // Things come grouped by entity (`gatedThings`), each group in action order.
  for (const [index, thing] of things.entries()) {
    if (index > 0 && things[index - 1].group === thing.group) continue;
    const group = things.filter((other) => other.group === thing.group);
    const plain: GatedThing[] = [];
    let mergedAt: number | undefined;
    for (const member of group) {
      const own = pairPhrase(member.group, member.action);
      if (own) {
        phrases.push(own);
        continue;
      }
      mergedAt ??= phrases.push('') - 1;
      plain.push(member);
    }
    if (mergedAt === undefined) continue;
    phrases[mergedAt] = t('agentPermissionsChat.thing', {
      verbs: verbs.format(
        plain.map((member) => `<em>${actionVerb(member.action)}</em>`)
      ),
      entity:
        entityPhrase(thing.group) ??
        t('agentPermissionsChat.entityOther', {
          group: groupInSentence(thing.groupName),
        }),
    });
  }
  return phrases;
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
  const phrases = markedThingPhrases(gatedThings(operations));
  const named = phrases.slice(0, MAX_THINGS);
  const rest = phrases.length - named.length;
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
  // A record whose operations this build can't read still names the step.
  if (operations.length === 0) return t('agentPermissionsChat.runProgram');
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
