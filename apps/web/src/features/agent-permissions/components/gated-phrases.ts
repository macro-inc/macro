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

/** "send email", "edit documents". */
function thingPhrase(thing: GatedThing): string {
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

/**
 * What the operations let a program do, as one list in the interface
 * language: "send email and edit documents", "delete email, send messages,
 * create tasks and 2 more things".
 */
export function describeGatedThings(
  operations: readonly GatedOperation[]
): string {
  const things = gatedThings(operations);
  const named = things.slice(0, MAX_THINGS).map(thingPhrase);
  const rest = things.length - named.length;
  if (rest > 0) {
    named.push(t('agentPermissionsChat.moreThings', { count: rest }));
  }
  return new Intl.ListFormat(formatLocale(), {
    style: 'long',
    type: 'conjunction',
  }).format(named);
}

/** "run a program that may send email and edit documents". */
export function describePermissionRun(
  operations: readonly GatedOperation[]
): string {
  return t('agentPermissionsChat.runProgram', {
    things: describeGatedThings(operations),
  });
}

/** "Run a program that may send email and edit documents", as a title. */
export function permissionRunTitle(
  operations: readonly GatedOperation[]
): string {
  return t('agentPermissionsChat.runProgramTitle', {
    things: describeGatedThings(operations),
  });
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
