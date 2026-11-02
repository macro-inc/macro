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

/**
 * The complete model-facing contract for `execution.views.present` in agent
 * sessions: the same view as `displayResultsToolSchema`, with guidance on
 * presenting without being asked. ExecuteCode's description includes the
 * generated JSON, and the harness checks every presented view against it.
 */
export function presentViewToolSchema() {
  return z.toJSONSchema(
    z.object({ view: ViewSchema }).meta({
      title: 'PresentView',
      description: [
        'Inside ExecuteCode, `await execution.views.present(view)` presents the user a rich, interactive view (lists, timelines, channel messages) in the conversation, where `view` is the `view` property below. Nothing is saved and nothing comes back.',
        'Decide for yourself when to present something: the user will not ask. When a turn made, changed or sent something the user will want to open, end it by presenting that item.',
        'Present the smallest set that does the job: the items that matter, never every item a step touched. Leave out what you only read along the way, supporting or intermediate items, and items you already presented unless this turn changed them. Do not present a view when the answer is a sentence or two, or when nothing in the turn is worth opening.',
        'For questions about workspace data - summaries of tasks, documents or activity, lists of items, anything that would otherwise need a markdown table or a long list - the view is the answer. Typical triggers: "what did I get done this week?", "what is a teammate working on?", "my open tasks", "summarize this project", and "what happened in this channel?".',
        'Keep accompanying prose to a one-line lead-in that says what you did, and do not restate what the view shows. Never add a mention or link in your reply for an item the view shows: the view already opens it.',
        'Entity-backed widgets take real workspace entity ids obtained from other tools such as ListEntities or search; never invent ids. Prefer list sources with kind "items" and those entity references.',
        'In a direct message with the user, the view is posted with your reply.',
        'The view is checked against this schema before it is presented: a view that does not match throws with what to fix. Present it again rather than running the program again.',
      ].join(' '),
    }),
    // The existing soup Query schema is an opaque pass-through owned by the
    // filter store. All widget/layout/entity fields retain their full schema.
    { unrepresentable: 'any' }
  );
}
