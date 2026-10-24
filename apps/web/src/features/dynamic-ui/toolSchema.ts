import { z } from 'zod';
import { ViewSchema } from './schema';

/**
 * The complete model-facing Show contract, generated from the same Zod schema
 * the renderer validates. The Rust tool includes the generated JSON
 * directly, so every host that advertises the tool also supplies its schema.
 */
export function showToolSchema() {
  return z.toJSONSchema(
    z.object({ view: ViewSchema }).meta({
      title: 'Show',
      description: [
        'Show the user a rich, interactive view (item cards, lists, timelines, calendar agendas, tags, channel messages) directly in the conversation.',
        'Decide for yourself when to show something: the user will not ask. Nothing you create, change or send reaches the user as a card unless you show it, so end a turn that made, changed or sent something the user will want to open by showing it. Their cards say what you did to them, so the rest of the view need not.',
        'Show the smallest set that does the job: usually one to four cards for the items that matter, never every item a step touched. Leave out what you only read along the way, supporting or intermediate items, and items you already showed unless this turn changed them. Do not call Show when the answer is a sentence or two, or when nothing in the turn is worth opening.',
        'For questions about workspace data - summaries of tasks, documents or activity, lists of items, anything that would otherwise need a markdown table or a long list - the view is the answer. Typical triggers: "what did I get done this week?", "what is a teammate working on?", "my open tasks", "summarize this project", and "what happened in this channel?".',
        'What ReadActivity returns is not shown to the user by itself: answer an activity question by showing the few items or events that matter, not by summarizing them in prose.',
        'Keep accompanying prose to a one-line lead-in at most and do not restate what the view shows.',
        'Never mention, link or name in your reply an item the view shows - no mention chip, no "I created X": its card or row already opens it and says what you did to it.',
        'Entity-backed widgets take real workspace entity ids obtained from other tools such as ListEntities or search; never invent ids. Prefer list sources with kind "items" and those entity references.',
        'To show calendar events, use an events widget with the eventIds a calendar tool returned: it renders an agenda loaded live from the calendar, so never restate the times in prose. Show one to four specific items - a document or spreadsheet, an email thread, an event, a routine - in a cards widget, and a longer set in a list widget; mention items in passing as chips instead.',
        "To show tags - the user's own, or a taxonomy or ontology of any depth - use a tags widget, never a table or a list in markdown. Nest narrower tags under the tags they belong to, and give a tag that exists the tagId a tag tool returned.",
        'In a channel or a private conversation with the user, the view is posted with your reply.',
        'The view is checked against this schema before it is shown: a view that does not match is not shown, and the error says what to fix.',
      ].join(' '),
    }),
    // The existing soup Query schema is an opaque pass-through owned by the
    // filter store. All widget/layout/entity fields retain their full schema.
    { unrepresentable: 'any' }
  );
}
