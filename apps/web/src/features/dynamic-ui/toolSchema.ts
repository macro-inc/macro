import { z } from 'zod';
import { ViewSchema } from './schema';

/**
 * Prompt text describing the `displayResults` tool's `view` argument.
 *
 * The backend tool input is `any` (so the schema isn't duplicated in Rust), so
 * the model learns the shape from here instead: we convert the Zod `ViewSchema`
 * to JSON Schema and embed it in the chat request's `additional_instructions`
 * (see `buildRequest.ts`). Kept in its own module so importing it only pulls the
 * Zod schema, not the dynamic-ui component tree.
 *
 * `unrepresentable: "any"` lets opaque schemas (the soup `Query` `z.custom`) fall
 * back to "accepts anything" rather than throwing during conversion.
 */
let cached: string | undefined;

export function displayResultsInstructions(): string {
  if (cached !== undefined) return cached;
  const jsonSchema = z.toJSONSchema(ViewSchema, { unrepresentable: 'any' });
  cached = [
    '# displayResults',
    '`displayResults` renders a rich, interactive view (cards, lists, timelines, stats, channel messages) directly in the chat. PREFER it over a plain-text answer whenever your response is largely about the user\'s workspace data — summaries of tasks/docs/activity, lists of entities, anything you would otherwise format as a markdown table or a long bulleted list. You do NOT need the user to ask for a "dashboard" or a "view": proactively call `displayResults` whenever it presents the information more clearly than text would.',
    'Typical triggers — call it even though the user never said "dashboard": "what did I get done this week?", "what\'s <teammate> working on?", "show me my open tasks", "summarize this project", "what happened in <channel>?". When in doubt and the answer is mostly workspace entities or metrics, render a view.',
    'When you DO render a view, keep any accompanying chat text short (a one-line lead-in at most) — the view IS the answer; do not also restate it in prose.',
    'Its `view` argument MUST be a JSON object matching this JSON Schema (a `title` plus an ordered `widgets` array; layout is flexbox via the `container` widget):',
    '```json',
    JSON.stringify(jsonSchema, null, 2),
    '```',
    'Entity-backed widgets (`card`, `list`, `timeline`, `channelMessage`) take real workspace entity ids — use ids you obtained from other tools (ListEntities, search, etc.), never invented ones.',
  ].join('\n');
  return cached;
}
