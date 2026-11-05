import type { FacetSelection, TagFacetContext } from '@app/features/soup';
import { DOMAIN_PATTERN } from '@core/util/domain';
import { startOfDay, subDays } from 'date-fns';
import { err, ok, type Result } from 'neverthrow';
import { match } from 'ts-pattern';
import { z } from 'zod';
import type { EmailSavedViewScope } from '../queries/email-query';
import {
  EMAIL_RECEIVED_WITHIN_DAYS,
  type EmailParticipantField,
  type EmailTab,
  type EmailViewConditions,
  type EmailViewState,
} from '../types';

export const EMAIL_SAVED_VIEW_KIND = 'email';

const EMAIL_PARTICIPANT_FIELDS = [
  'from',
  'to',
  'cc',
  'bcc',
] as const satisfies readonly EmailParticipantField[];
const DEFAULT_PARTICIPANT_FIELDS: EmailParticipantField[] = [
  'from',
  'to',
  'cc',
];
const ATTACHMENT_OPTION_IDS = [
  'attachment-pdf',
  'attachment-image',
  'attachment-document',
] as const;
const CALENDAR_OPTION_ID = 'has-calendar-invite';
const SAVED_FACET_IDS: readonly string[] = [
  'read',
  'done',
  'attachments',
  'calendar',
  'tags',
];

const identifierSchema = z
  .string()
  .guid()
  .transform((id) => id.toLowerCase());
const participantSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('address'),
      email: z
        .email()
        .max(320)
        .transform((email) => email.toLowerCase()),
    })
    .strict(),
  z
    .object({
      type: z.literal('domain'),
      domain: z
        .string()
        .max(253)
        .regex(DOMAIN_PATTERN)
        .transform((domain) => domain.toLowerCase()),
    })
    .strict(),
]);
// The server accepts 1-200 characters per subject condition.
const keywordSchema = z.string().trim().min(1).max(200);
const tagSchema = z
  .object({
    propertyDefinitionId: identifierSchema,
    optionId: identifierSchema,
  })
  .strict();

const filtersSchema = z
  .object({
    /** Empty means every inbox. */
    inboxIds: z.array(identifierSchema).max(100),
    importance: z.enum(['signal', 'noise']).optional(),
    participants: z.array(participantSchema).max(100),
    participantFields: z.array(z.enum(EMAIL_PARTICIPANT_FIELDS)).min(1).max(4),
    subject: z.array(keywordSchema).max(20),
    receivedWithinDays: z.literal([...EMAIL_RECEIVED_WITHIN_DAYS]).optional(),
    starred: z.boolean(),
    read: z.enum(['unread', 'read']).optional(),
    done: z.enum(['not-done', 'done']).optional(),
    attachments: z.array(z.enum(ATTACHMENT_OPTION_IDS)).max(3),
    calendarInvite: z.boolean(),
    tags: z.array(tagSchema).max(100),
  })
  .strict();

const emailSavedViewSchema = z
  .object({
    kind: z.literal(EMAIL_SAVED_VIEW_KIND),
    version: z.literal(1),
    filters: filtersSchema,
  })
  .strict();

const readableEmailSavedViewSchema = emailSavedViewSchema
  .pick({ kind: true, version: true })
  .extend({ filters: z.record(z.string(), z.unknown()) })
  .loose();

export type EmailSavedViewConfig = z.infer<typeof emailSavedViewSchema>;
export type EmailSavedViewFilters = EmailSavedViewConfig['filters'];

export type EmailSavedViewIssue = { path: string[]; message: string };

export type EmailSavedViewRead = {
  config: EmailSavedViewConfig;
  issues: EmailSavedViewIssue[];
};

/** No restriction at all: every inbox, every thread. */
export const EMPTY_EMAIL_SAVED_VIEW_FILTERS: EmailSavedViewFilters = {
  inboxIds: [],
  participants: [],
  participantFields: DEFAULT_PARTICIPANT_FIELDS,
  subject: [],
  starred: false,
  attachments: [],
  calendarInvite: false,
  tags: [],
};

/** Whether a filter the builder keeps under Advanced settings is set. */
export function hasAdvancedEmailFilters(
  filters: EmailSavedViewFilters
): boolean {
  return (
    filters.importance !== undefined ||
    filters.read !== undefined ||
    filters.done !== undefined ||
    filters.receivedWithinDays !== undefined ||
    filters.inboxIds.length > 0 ||
    filters.starred ||
    filters.calendarInvite ||
    filters.attachments.length > 0
  );
}

function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function inOrder<T extends string>(values: readonly T[], order: readonly T[]) {
  return order.filter((value) => values.includes(value));
}

/** Set-valued filters compare without order or duplicates. */
function canonical(config: EmailSavedViewConfig): EmailSavedViewConfig {
  const filters = config.filters;
  return {
    kind: EMAIL_SAVED_VIEW_KIND,
    version: 1,
    filters: {
      inboxIds: uniqueSorted(filters.inboxIds, String),
      ...(filters.importance && { importance: filters.importance }),
      participants: uniqueSorted(filters.participants, JSON.stringify),
      participantFields: inOrder(
        filters.participantFields,
        EMAIL_PARTICIPANT_FIELDS
      ),
      subject: uniqueSorted(filters.subject, (keyword) =>
        keyword.toLowerCase()
      ),
      ...(filters.receivedWithinDays && {
        receivedWithinDays: filters.receivedWithinDays,
      }),
      starred: filters.starred,
      ...(filters.read && { read: filters.read }),
      ...(filters.done && { done: filters.done }),
      attachments: inOrder(filters.attachments, ATTACHMENT_OPTION_IDS),
      calendarInvite: filters.calendarInvite,
      tags: uniqueSorted(filters.tags, (tag) => tag.optionId),
    },
  };
}

/** Rejects unknown fields and conflicting tag bindings rather than dropping them. */
export function decodeEmailSavedView(
  value: unknown
): Result<EmailSavedViewConfig, string> {
  const parsed = emailSavedViewSchema.safeParse(value);
  if (!parsed.success)
    return err('This view contains unsupported or invalid email filters.');
  const definitions = new Map<string, string>();
  for (const tag of parsed.data.filters.tags) {
    const previous = definitions.get(tag.optionId);
    if (previous && previous !== tag.propertyDefinitionId)
      return err('This view contains conflicting tag filters.');
    definitions.set(tag.optionId, tag.propertyDefinitionId);
  }
  return ok(canonical(parsed.data));
}

function issuesOf(error: z.ZodError): EmailSavedViewIssue[] {
  return error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({
          path: [...issue.path.map(String), key],
          message: 'This field is not supported.',
        }))
      : [{ path: issue.path.map(String), message: issue.message }]
  );
}

/**
 * Applies the filters this version understands and reports the rest, so a
 * definition from a newer client still opens; it is never rewritten here.
 */
export function readEmailSavedView(value: unknown): EmailSavedViewRead {
  const decoded = decodeEmailSavedView(value);
  if (decoded.isOk()) return { config: decoded.value, issues: [] };

  const parsed = emailSavedViewSchema.safeParse(value);
  const issues = parsed.success ? [] : issuesOf(parsed.error);
  const readable = readableEmailSavedViewSchema.safeParse(value);
  if (!readable.success)
    return {
      issues,
      config: {
        kind: EMAIL_SAVED_VIEW_KIND,
        version: 1,
        filters: EMPTY_EMAIL_SAVED_VIEW_FILTERS,
      },
    };

  const raw = readable.data.filters;
  const shape = filtersSchema.shape;
  const field = <T>(schema: z.ZodType<T>, input: unknown, fallback: T): T => {
    const result = schema.safeParse(input);
    return result.success ? result.data : fallback;
  };
  const entries = <T>(item: z.ZodType<T>, input: unknown, limit: number) =>
    Array.isArray(input)
      ? input
          .flatMap((entry) => {
            const result = item.safeParse(entry);
            return result.success ? [result.data] : [];
          })
          .slice(0, limit)
      : [];

  const tags = entries(tagSchema, raw.tags, 100);
  const definitions = new Map<string, Set<string>>();
  for (const tag of tags) {
    const ids = definitions.get(tag.optionId) ?? new Set<string>();
    ids.add(tag.propertyDefinitionId);
    definitions.set(tag.optionId, ids);
  }
  const conflicting = new Set(
    [...definitions].filter(([, ids]) => ids.size > 1).map(([id]) => id)
  );
  if (conflicting.size > 0)
    issues.push({
      path: ['filters', 'tags'],
      message: 'A tag has conflicting property definitions.',
    });

  return {
    issues,
    config: canonical({
      kind: EMAIL_SAVED_VIEW_KIND,
      version: 1,
      filters: {
        inboxIds: entries(identifierSchema, raw.inboxIds, 100),
        importance: field(shape.importance, raw.importance, undefined),
        participants: entries(participantSchema, raw.participants, 101),
        participantFields: field(
          shape.participantFields,
          raw.participantFields,
          DEFAULT_PARTICIPANT_FIELDS
        ),
        subject: entries(keywordSchema, raw.subject, 20),
        receivedWithinDays: field(
          shape.receivedWithinDays,
          raw.receivedWithinDays,
          undefined
        ),
        starred: field(shape.starred, raw.starred, false),
        read: field(shape.read, raw.read, undefined),
        done: field(shape.done, raw.done, undefined),
        attachments: entries(z.enum(ATTACHMENT_OPTION_IDS), raw.attachments, 3),
        calendarInvite: field(shape.calendarInvite, raw.calendarInvite, false),
        tags: tags.filter((tag) => !conflicting.has(tag.optionId)),
      },
    }),
  };
}

/** The restrictions a built-in tab adds; undefined for tabs a view can't hold. */
function tabFilters(tab: EmailTab): Partial<EmailSavedViewFilters> | undefined {
  return (
    match(tab)
      // Signal and Noise list only threads still in the inbox.
      .with('important', () => ({
        importance: 'signal' as const,
        done: 'not-done' as const,
      }))
      .with('noise', () => ({
        importance: 'noise' as const,
        done: 'not-done' as const,
      }))
      .with('all', () => ({}))
      .with('archived', () => ({ done: 'done' as const }))
      .with('favorites', () => ({ starred: true }))
      .with('calendar', () => ({ calendarInvite: true }))
      // These tabs list drafts, deliveries, reminders, ranked Focus threads,
      // or other people's shared threads, none of which a view selects.
      .with(
        'sent',
        'drafts',
        'scheduled',
        'reminders',
        'shared',
        'focus',
        () => undefined
      )
      .exhaustive(() => undefined)
  );
}

export function canSaveEmailTab(tab: EmailTab): boolean {
  return tabFilters(tab) !== undefined;
}

type CaptureInput = Pick<
  EmailViewState,
  'tab' | 'inboxIds' | 'aliasFilter' | 'facets' | 'conditions'
> & { context: TagFacetContext };

/** Captures what the list shows, except search text, as one definition. */
export function captureEmailSavedView(
  input: CaptureInput
): Result<EmailSavedViewConfig, string> {
  // An open view already holds its conditions on the All tab.
  const fromTab: Partial<EmailSavedViewFilters> | undefined = input.conditions
    ? {}
    : tabFilters(input.tab);
  if (!fromTab) return err('This tab cannot be saved as a view.');
  if (
    Object.entries(input.facets).some(
      ([id, selected]) => selected.length > 0 && !SAVED_FACET_IDS.includes(id)
    )
  )
    return err('These email filters cannot be saved yet.');
  if (input.inboxIds?.length === 0)
    return err('Select at least one inbox before saving.');

  const tags = [];
  for (const id of input.facets.tags ?? []) {
    const definition = input.context.tagPropertyDefinitionByOptionId.get(id);
    if (!definition)
      return err('A selected tag is unavailable. Remove it before saving.');
    tags.push({ optionId: id, propertyDefinitionId: definition });
  }

  const conditions = input.conditions ?? {
    ...EMPTY_EMAIL_SAVED_VIEW_FILTERS,
    ...fromTab,
  };
  let participants = conditions.participants;
  let participantFields = conditions.participantFields;
  if (input.aliasFilter) {
    if (participants.length > 0)
      return err('Choose an inbox instead of an alias to save this view.');
    participants = [{ type: 'address', email: input.aliasFilter.emailAddress }];
    participantFields = [...EMAIL_PARTICIPANT_FIELDS];
  }

  const facet = (id: string) => input.facets[id] ?? [];
  return decodeEmailSavedView({
    kind: EMAIL_SAVED_VIEW_KIND,
    version: 1,
    filters: {
      inboxIds: input.aliasFilter
        ? [input.aliasFilter.inboxId]
        : (input.inboxIds ?? []),
      importance: conditions.importance,
      participants,
      participantFields,
      subject: conditions.subject,
      receivedWithinDays: conditions.receivedWithinDays,
      starred: conditions.starred,
      read: facet('read')[0],
      // A selected Done filter replaces the tab's own inbox restriction.
      done: facet('done')[0] ?? fromTab.done,
      attachments: facet('attachments'),
      calendarInvite:
        facet('calendar').includes(CALENDAR_OPTION_ID) ||
        (fromTab.calendarInvite ?? false),
      tags,
    },
  });
}

export type MaterializedEmailSavedView = Pick<
  EmailViewState,
  'inboxIds' | 'facets'
> & {
  conditions: EmailViewConditions;
  tagBindings: ReadonlyMap<string, string>;
};

/** Restores a definition as the All tab's editable filters plus its conditions. */
export function materializeEmailSavedView(
  config: EmailSavedViewConfig
): MaterializedEmailSavedView {
  const filters = config.filters;
  const facets: FacetSelection = {
    read: filters.read ? [filters.read] : [],
    done: filters.done ? [filters.done] : [],
    attachments: [...filters.attachments],
    calendar: filters.calendarInvite ? [CALENDAR_OPTION_ID] : [],
    tags: filters.tags.map((tag) => tag.optionId),
  };
  return {
    inboxIds: filters.inboxIds.length > 0 ? [...filters.inboxIds] : undefined,
    facets,
    conditions: {
      importance: filters.importance,
      participants: filters.participants.map((person) => ({ ...person })),
      participantFields: [...filters.participantFields],
      subject: [...filters.subject],
      receivedWithinDays: filters.receivedWithinDays,
      starred: filters.starred,
    },
    tagBindings: new Map(
      filters.tags.map((tag) => [tag.optionId, tag.propertyDefinitionId])
    ),
  };
}

// Subjects match ignoring case, so spelling alone is not a change.
function comparable(config: EmailSavedViewConfig): string {
  const value = canonical(config);
  return JSON.stringify({
    ...value,
    filters: {
      ...value.filters,
      subject: value.filters.subject.map((keyword) => keyword.toLowerCase()),
    },
  });
}

export function emailSavedViewsEqual(
  left: EmailSavedViewConfig,
  right: EmailSavedViewConfig
): boolean {
  return comparable(left) === comparable(right);
}

/** Resolves a view's relative conditions (last N days) for one query. */
export function resolveEmailSavedViewScope(
  conditions: EmailViewConditions,
  today: Date
): EmailSavedViewScope {
  const days = conditions.receivedWithinDays;
  return {
    conditions: {
      importance: conditions.importance,
      participants: conditions.participants.map((person) => ({ ...person })),
      participantFields: [...conditions.participantFields],
      subject: [...conditions.subject],
      receivedWithinDays: days,
      starred: conditions.starred,
    },
    // Day boundaries keep the query stable while the view stays open.
    receivedSince: days
      ? subDays(startOfDay(today), days).toISOString()
      : undefined,
  };
}
