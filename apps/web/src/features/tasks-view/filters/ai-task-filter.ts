import {
  type FacetSelection,
  TAG_FACET_ID,
} from '@app/features/soup/filters/facets';
import type OpenAI from 'openai';
import { z } from 'zod';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  TASK_VIEWER,
} from './task-facets';

type AiTaskFilterChoice = { id: string; label: string };

/** Scoped tag choices and the target for an explicit request for "me".
 * Personal names are resolved after extraction, never sent as a catalog. */
export type AiTaskFilterCatalog = {
  viewer: string;
  tags: AiTaskFilterChoice[];
};

export type AiTaskFilterPlan = {
  facets: FacetSelection;
  /** Free-text search to apply when the request names task content. */
  search?: string;
  /** Short explanation of the parts of the request that have no matching filter. */
  unresolved?: string;
};

const AI_TASK_FILTER_MODEL = 'gpt-4o-mini';

/** Keep scoped tag prompts bounded. People never enter the prompt. */
const MAX_CHOICES_PER_GROUP = 400;

const RESPONSE_SCHEMA_NAME = 'task_filters';

const optionIds = (options: { id: string }[]) => options.map(({ id }) => id);

const formatChoices = (choices: AiTaskFilterChoice[]) =>
  choices
    .slice(0, MAX_CHOICES_PER_GROUP)
    .map((choice) => `- ${choice.id}: ${choice.label}`)
    .join('\n');

const formatOptions = (options: { id: string; label: string }[]) =>
  options.map((option) => `- ${option.id}: ${option.label}`).join('\n');

export function buildAiTaskFilterSystemPrompt(
  catalog: AiTaskFilterCatalog
): string {
  return [
    'You translate a plain-English description of which tasks to show into a set of task list filters.',
    '',
    'Filter groups (each is a list of option ids; an empty list means "no filter on this group"):',
    '- status: options selected are ORed together. Available:',
    formatOptions(TASK_STATUS_OPTIONS),
    '- priority: options selected are ORed together. Available:',
    formatOptions(TASK_PRIORITY_OPTIONS),
    '- assignees: person references copied from the request; the task must have at least one of them assigned.',
    '- createdBy: person references copied from the request; the task must have been created by one of them.',
    `- Use "${TASK_VIEWER}" for "me" or "my tasks". Keep an explicitly supplied email or user id literal, even when it belongs to the requester.`,
    '- No people catalog is provided. Copy each full name, email or user id verbatim as one array entry; do not guess identities, correct names, or split a comma-bearing name. The app resolves these references independently.',
    '- tags: tag ids; the task must carry at least one of them. Available:',
    catalog.tags.length > 0 ? formatChoices(catalog.tags) : '(none)',
    '- search: free text matched against task titles and content. Use it only for subject matter the user wants to SEE that no filter group covers (e.g. "tasks about billing" → "billing"). Otherwise return an empty string.',
    '',
    'Rules:',
    '- Groups are ANDed: a task must satisfy every non-empty group.',
    '- Filters can only include options, never exclude them. To express an exclusion on status or priority, select every other option in that group (e.g. "not completed" → every status except completed; "no low priority" → urgent, high, medium).',
    '- Exclusions on assignees, createdBy, or tags cannot be expressed. Leave that group empty and mention the request in "unresolved".',
    '- Never put a negated or excluded term into "search" (e.g. "no dev tasks" must not search for "dev"); never use "search" to stand in for a person or tag. Report unsupported requests in "unresolved" instead.',
    '- Terms like "open", "active", or "unfinished" mean not-started, in-progress, and in-review. "Done" or "finished" means completed. "Important" or "critical" means urgent and high.',
    '- Match tags by name, tolerating typos, partial names, and casing. When a tag matches nothing listed, leave it out and mention it in "unresolved".',
    '- Status, priority and tags use option ids exactly as listed. People use the original references, not invented ids.',
    '- "unresolved" is one short sentence addressed to the user naming the part of the request that was skipped and why. Only describe what was actually skipped; do not mention filters that were applied. Empty string when everything was mapped.',
    '- If the request has nothing to do with filtering tasks, return empty lists, an empty search, and explain in "unresolved".',
  ].join('\n');
}

/**
 * The model's reply, shared by the strict JSON schema sent with the request
 * and the parser. Status and priority are enums, so strict mode rejects any
 * other value at decode time. People remain references for a separate complete
 * lookup; unknown people must not silently broaden an otherwise valid plan.
 */
const AiTaskFilterReply = z.strictObject({
  status: z.array(z.enum(optionIds(TASK_STATUS_OPTIONS))),
  priority: z.array(z.enum(optionIds(TASK_PRIORITY_OPTIONS))),
  assignees: z.array(z.string()),
  createdBy: z.array(z.string()),
  tags: z.array(z.string()),
  search: z.string(),
  unresolved: z.string(),
});
export type AiTaskFilterReply = z.infer<typeof AiTaskFilterReply>;

/** Decode without resolving names against a truncated prompt or suggestion page. */
export function parseAiTaskFilterResponse(
  content: string | null | undefined
): AiTaskFilterReply | undefined {
  if (!content) return;
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return;
  }
  const parsed = AiTaskFilterReply.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

export function buildAiTaskFilterResponseFormat(): OpenAI.ResponseFormatJSONSchema {
  const { $schema: _, ...schema } = z.toJSONSchema(AiTaskFilterReply, {
    target: 'draft-07',
    unrepresentable: 'throw',
  });
  return {
    type: 'json_schema',
    json_schema: { name: RESPONSE_SCHEMA_NAME, strict: true, schema },
  };
}

export function buildAiTaskFilterRequest(
  query: string,
  catalog: AiTaskFilterCatalog
): Omit<OpenAI.ChatCompletionCreateParamsNonStreaming, 'stream'> {
  return {
    model: AI_TASK_FILTER_MODEL,
    temperature: 0,
    max_tokens: 400,
    response_format: buildAiTaskFilterResponseFormat(),
    messages: [
      { role: 'system', content: buildAiTaskFilterSystemPrompt(catalog) },
      { role: 'user', content: query.trim() },
    ],
  };
}

const trimmedString = (value: string): string | undefined =>
  value.trim() || undefined;

/**
 * Resolves model output against the known choices. Ids are preferred, but a
 * label match (case-insensitive) is accepted so a model that echoes a name
 * instead of an id still produces the right filter.
 */
function resolveChoices(
  values: string[],
  choices: AiTaskFilterChoice[]
): string[] {
  const byId = new Map(choices.map((choice) => [choice.id, choice.id]));
  const byLabel = new Map(
    choices.map((choice) => [choice.label.trim().toLowerCase(), choice.id])
  );
  const resolved = new Set<string>();
  for (const value of values) {
    const id = byId.get(value) ?? byLabel.get(value.trim().toLowerCase());
    if (id) resolved.add(id);
  }
  return [...resolved];
}

export type AiTaskFilterParseResult =
  | { ok: true; plan: AiTaskFilterPlan }
  | { ok: false; error: 'UNRESOLVED_PEOPLE' }
  /** The reply was well-formed but mapped to nothing; `unresolved` says why. */
  | { ok: false; error: 'NO_FILTERS'; unresolved?: string };

/** Resolve only complete, unique person evidence. Reject the whole plan when a
 * person is unresolved, rather than broadening its OR or AND constraints. */
export function resolveAiTaskFilterPlan(
  data: AiTaskFilterReply,
  catalog: AiTaskFilterCatalog,
  person: (label: string) => string | undefined
): AiTaskFilterParseResult {
  let missingPerson = false;
  const resolvePeople = (values: string[]) => [
    ...new Set(
      values.flatMap((value) => {
        const label = value.trim();
        const id = label === TASK_VIEWER ? catalog.viewer : person(label);
        if (!id) missingPerson = true;
        return id ? [id] : [];
      })
    ),
  ];

  const facets: FacetSelection = {};
  const status = [...new Set(data.status)];
  if (status.length > 0) facets.status = status;
  const priority = [...new Set(data.priority)];
  if (priority.length > 0) facets.priority = priority;
  const assignees = resolvePeople(data.assignees);
  if (assignees.length > 0) facets.assignees = assignees;
  const createdBy = resolvePeople(data.createdBy);
  if (missingPerson) return { ok: false, error: 'UNRESOLVED_PEOPLE' };
  if (createdBy.length > 0) facets['created-by'] = createdBy;
  const tags = resolveChoices(data.tags, catalog.tags);
  if (tags.length > 0) facets[TAG_FACET_ID] = tags;

  const search = trimmedString(data.search);
  const unresolved = trimmedString(data.unresolved);

  if (Object.keys(facets).length === 0 && !search) {
    return { ok: false, error: 'NO_FILTERS', unresolved };
  }

  return { ok: true, plan: { facets, search, unresolved } };
}
