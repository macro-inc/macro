import { type FacetSelection, TAG_FACET_ID } from '@app/features/soup';
import type OpenAI from 'openai';
import { z } from 'zod';
import { TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS } from './task-facets';

type AiTaskFilterChoice = { id: string; label: string };

/** Everything the model may pick from when turning a request into filters. */
export type AiTaskFilterCatalog = {
  people: AiTaskFilterChoice[];
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

/** Keep prompts bounded for workspaces with very large address books. */
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
    '- assignees: person ids; the task must have at least one of them assigned. Available:',
    catalog.people.length > 0 ? formatChoices(catalog.people) : '(none)',
    '- createdBy: person ids; the task must have been created by one of them. Uses the same people as assignees.',
    '- tags: tag ids; the task must carry at least one of them. Available:',
    catalog.tags.length > 0 ? formatChoices(catalog.tags) : '(none)',
    '- search: free text matched against task titles and content. Use it only for subject matter the user wants to SEE that no filter group covers (e.g. "tasks about billing" → "billing"). Otherwise return an empty string.',
    '',
    'Rules:',
    '- Groups are ANDed: a task must satisfy every non-empty group.',
    '- Filters can only include options, never exclude them. To express an exclusion on status or priority, select every other option in that group (e.g. "not completed" → every status except completed; "no low priority" → urgent, high, medium).',
    '- Exclusions on assignees, createdBy, or tags cannot be expressed. Leave that group empty and mention the request in "unresolved".',
    '- Never put a negated or excluded term into "search" (e.g. "no dev tasks" must not search for "dev"); never use "search" to stand in for a person or tag that is not listed. Report those in "unresolved" instead.',
    '- Terms like "open", "active", or "unfinished" mean not-started, in-progress, and in-review. "Done" or "finished" means completed. "Important" or "critical" means urgent and high.',
    '- The person marked "(me)" is the user making the request; "my tasks" or "assigned to me" refers to them.',
    '- Match people and tags by name, tolerating typos, partial names, and casing. When a name matches nobody, leave it out and mention it in "unresolved".',
    '- Always answer with option ids exactly as listed, never with labels.',
    '- "unresolved" is one short sentence addressed to the user naming the part of the request that was skipped and why. Only describe what was actually skipped; do not mention filters that were applied. Empty string when everything was mapped.',
    '- If the request has nothing to do with filtering tasks, return empty lists, an empty search, and explain in "unresolved".',
  ].join('\n');
}

/**
 * The model's reply, shared by the strict JSON schema sent with the request
 * and the parser. Status and priority are enums, so strict mode rejects any
 * other value at decode time; people and tags stay free strings so one
 * unknown id drops alone instead of failing the whole reply.
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
  | { ok: false; error: 'INVALID_JSON' }
  /** The reply was well-formed but mapped to nothing; `unresolved` says why. */
  | { ok: false; error: 'NO_FILTERS'; unresolved?: string };

/**
 * Turns the model's JSON reply into a facet selection. Unknown ids are
 * dropped rather than failing the whole request so one hallucinated option
 * does not discard the rest of an otherwise good answer.
 */
export function parseAiTaskFilterResponse(
  content: string | null | undefined,
  catalog: AiTaskFilterCatalog
): AiTaskFilterParseResult {
  if (!content) return { ok: false, error: 'INVALID_JSON' };

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }
  const reply = AiTaskFilterReply.safeParse(json);
  if (!reply.success) return { ok: false, error: 'INVALID_JSON' };
  const data = reply.data;

  const facets: FacetSelection = {};
  const status = [...new Set(data.status)];
  if (status.length > 0) facets.status = status;
  const priority = [...new Set(data.priority)];
  if (priority.length > 0) facets.priority = priority;
  const assignees = resolveChoices(data.assignees, catalog.people);
  if (assignees.length > 0) facets.assignees = assignees;
  const createdBy = resolveChoices(data.createdBy, catalog.people);
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
