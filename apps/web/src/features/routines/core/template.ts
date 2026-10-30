import type {
  ActionTrigger,
  TemplateVariable,
  VariableFill,
} from '@service-scheduled-action/generated/schemas';
import { match } from 'ts-pattern';

const MENTION_PATTERN =
  /<m-(user|document)-mention>([\s\S]*?)<\/m-\1-mention>/g;

type Mention =
  | { kind: 'user'; id: string; label: string; email?: string }
  | { kind: 'item'; id: string; label: string; blockName: string };

function parseMention(kind: string, json: string): Mention | undefined {
  try {
    const data: unknown = JSON.parse(json);
    if (!data || typeof data !== 'object') return undefined;
    const field = (name: string) => {
      const value = (data as Record<string, unknown>)[name];
      return typeof value === 'string' ? value : undefined;
    };
    if (kind === 'user') {
      const id = field('userId');
      if (!id) return undefined;
      const email = field('email');
      return {
        kind: 'user',
        id,
        email,
        label: field('displayName') || email?.split('@')[0] || id,
      };
    }
    const id = field('documentId');
    if (!id) return undefined;
    return {
      kind: 'item',
      id,
      label: field('documentName') || 'Untitled',
      blockName: field('blockName') ?? 'md',
    };
  } catch {
    return undefined;
  }
}

/** `macro|<email>` principals and bare emails name the same person. */
function isSameUser(mention: { id: string; email?: string }, userId: string) {
  return (
    mention.id === userId ||
    (mention.email !== undefined && `macro|${mention.email}` === userId)
  );
}

/** The ID a variable is keyed by within one template. */
export function variableKey(variable: TemplateVariable): string {
  return match(variable)
    .with({ kind: 'user' }, { kind: 'item' }, (reference) => reference.id)
    .with({ kind: 'time_zone' }, () => 'time_zone')
    .exhaustive();
}

/**
 * The user-specific parts of a routine, as the defaults its owner starts from
 * when sharing it: the owner's own mentions and the schedule's time zone fill
 * in as whoever activates it, and every other reference stays the same.
 */
export function extractTemplateVariables(args: {
  prompt: string;
  /** The time zone its schedules run in; absent for event-only routines. */
  timezone: string | undefined;
  authorId: string;
}): TemplateVariable[] {
  const variables = new Map<string, TemplateVariable>();
  for (const [, kind, json] of args.prompt.matchAll(MENTION_PATTERN)) {
    const mention = parseMention(kind, json);
    if (!mention || variables.has(mention.id)) continue;
    variables.set(
      mention.id,
      mention.kind === 'user'
        ? {
            kind: 'user',
            id: mention.id,
            label: mention.label,
            fill: isSameUser(mention, args.authorId) ? 'activator' : 'shared',
          }
        : {
            kind: 'item',
            id: mention.id,
            block_name: mention.blockName,
            label: mention.label,
            fill: 'shared',
          }
    );
  }
  if (args.timezone) {
    variables.set('time_zone', {
      kind: 'time_zone',
      timezone: args.timezone,
      fill: 'activator',
    });
  }
  return [...variables.values()];
}

/** Keep the referenced item, or drop it and leave its name as plain text. */
export type ReferenceChoice = 'keep' | 'leave_out';

export type Activator = {
  userId: string;
  email: string;
  displayName?: string;
  timezone: string;
};

/**
 * The template's instructions as the activator's routine will run them:
 * mentions that fill in as the activator name them instead, and references
 * the activator left out become plain text.
 */
export function fillTemplatePrompt(args: {
  prompt: string;
  variables: readonly TemplateVariable[];
  activator: Activator;
  choices: ReadonlyMap<string, ReferenceChoice>;
}): string {
  const fills = new Map(
    args.variables.map((variable) => [variableKey(variable), variable.fill])
  );
  return args.prompt.replace(MENTION_PATTERN, (tag, kind, json) => {
    const mention = parseMention(kind, json);
    if (!mention) return tag;
    const fill: VariableFill = fills.get(mention.id) ?? 'shared';
    if (mention.kind === 'user' && fill === 'activator') {
      const data = JSON.stringify({
        userId: args.activator.userId,
        email: args.activator.email,
        displayName: args.activator.displayName,
      });
      return `<m-user-mention>${data}</m-user-mention>`;
    }
    const choice =
      args.choices.get(mention.id) ??
      (fill === 'choice' ? 'leave_out' : 'keep');
    return choice === 'leave_out' ? mention.label : tag;
  });
}

/** The template's triggers, on the activator's time zone when it fills in. */
export function fillTemplateTrigger(args: {
  trigger: ActionTrigger;
  variables: readonly TemplateVariable[];
  activator: Activator;
}): ActionTrigger {
  const zone = args.variables.find((variable) => variable.kind === 'time_zone');
  if (zone?.fill !== 'activator') return args.trigger;
  const timezone = args.activator.timezone;
  return match(args.trigger)
    .returnType<ActionTrigger>()
    .with({ type: 'cron' }, (cron) => ({ ...cron, timezone }))
    .with({ type: 'events' }, (events) => events)
    .with({ type: 'multiple' }, (multiple) => ({
      ...multiple,
      triggers: multiple.triggers.map((item) =>
        item.type === 'cron' ? { ...item, timezone } : item
      ),
    }))
    .exhaustive(() => args.trigger);
}

/**
 * How a reference reads to someone activating a template: it fills in as
 * them, works as it is, or needs their decision because they can't open it or
 * the author left it for each person to choose.
 */
export type ReferenceState = 'fills_in' | 'works' | 'unavailable' | 'choose';

export function referenceState(
  variable: TemplateVariable,
  canOpen: boolean | undefined
): ReferenceState {
  if (variable.fill === 'activator') return 'fills_in';
  if (variable.fill === 'choice') return 'choose';
  return variable.kind === 'item' && canOpen === false
    ? 'unavailable'
    : 'works';
}

export function needsDecision(state: ReferenceState) {
  return state === 'unavailable' || state === 'choose';
}
