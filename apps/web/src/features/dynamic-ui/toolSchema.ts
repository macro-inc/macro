import { z } from 'zod';
import { ViewSchema } from './schema';

/**
 * The complete model-facing DisplayResults contract, generated from the same
 * Zod schema the renderer validates. The Rust tool includes the generated JSON
 * directly, so every host that advertises the tool also supplies its schema.
 */
export function displayResultsToolSchema() {
  return z.toJSONSchema(
    z.object({ view: ViewSchema }).meta({
      title: 'DisplayResults',
      description: [
        'Present results as a rich, interactive view (lists, timelines, channel messages) directly in the conversation.',
        'Prefer this tool when answering questions about workspace data: summaries of tasks/docs/activity, lists of entities, and information that would otherwise need a markdown table or long bulleted list. The user does not need to ask for a dashboard.',
        'Typical triggers: "what did I get done this week?", "what is a teammate working on?", "show my open tasks", "summarize this project", and "what happened in this channel?".',
        'ReadActivity already renders a complete activity timeline: do not call DisplayResults to repeat its events; add at most one short textual takeaway.',
        'The view is the answer. Keep accompanying prose to a one-line lead-in at most and do not restate the same data.',
        'Entity-backed widgets take real workspace entity ids obtained from other tools such as ListEntities or search; never invent ids. Prefer list sources with kind "items" and those entity references.',
        'The frontend renders the view from the tool arguments immediately; this tool only acknowledges it.',
      ].join(' '),
    }),
    // The existing soup Query schema is an opaque pass-through owned by the
    // filter store. All widget/layout/entity fields retain their full schema.
    { unrepresentable: 'any' }
  );
}
