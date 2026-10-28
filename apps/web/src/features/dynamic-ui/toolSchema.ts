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
 * The complete model-facing PresentView contract, for agent sessions: the same
 * view as `displayResultsToolSchema`, with guidance on presenting without
 * being asked. The Rust tool includes the generated JSON directly.
 */
export function presentViewToolSchema() {
  return z.toJSONSchema(
    z.object({ view: ViewSchema }).meta({
      title: 'PresentView',
      description: [
        'Present the user a rich, interactive view (item cards, lists, timelines, calendar agendas, tags, channel messages) in the conversation. The view is drawn from these arguments; nothing is saved.',
        'Decide for yourself when to present something: the user will not ask. When a turn made, changed or sent something the user will want to open, end it by presenting that item.',
        'Present the smallest set that does the job: usually one to four cards for the items that matter, never every item a step touched. Leave out what you only read along the way, supporting or intermediate items, and items you already presented unless this turn changed them. Do not present a view when the answer is a sentence or two, or when nothing in the turn is worth opening.',
        'For questions about workspace data - summaries of tasks, documents or activity, lists of items, anything that would otherwise need a markdown table or a long list - the view is the answer. Typical triggers: "what did I get done this week?", "what is a teammate working on?", "my open tasks", "summarize this project", and "what happened in this channel?".',
        'Keep accompanying prose to a one-line lead-in that says what you did, and do not restate what the view shows. Never add a mention or link in your reply for an item the view shows: the view already opens it.',
        'Entity-backed widgets take real workspace entity ids obtained from other tools such as ListEntities or search; never invent ids. Prefer list sources with kind "items" and those entity references.',
        'To present calendar events, use an events widget with the eventIds a calendar tool returned: it renders an agenda loaded live from the calendar, so never restate the times in prose. Present one to four specific items - a document or spreadsheet, an email thread, an event, a routine - in a cards widget, and a longer set in a list widget.',
        "To present tags - the user's own, or a taxonomy or ontology of any depth - use a tags widget, never a table or a list in markdown. Nest narrower tags under the tags they belong to, and give a tag that exists the tagId a tag tool returned.",
        'In a direct message with the user, the view is posted with your reply.',
        'The view is checked against this schema before it is presented: a view that does not match is not presented, and the error says what to fix.',
      ].join(' '),
    }),
    // The existing soup Query schema is an opaque pass-through owned by the
    // filter store. All widget/layout/entity fields retain their full schema.
    { unrepresentable: 'any' }
  );
}
