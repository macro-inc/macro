//! The view an agent presents to a person, as the web's dynamic-UI renderer
//! draws it. [`View`] is the source of truth: decoding into it is the check,
//! and the JSON Schema the model reads and the TypeScript the web renders are
//! generated from it.
#![deny(missing_docs)]

mod decode;
// A doc comment on a field or variant becomes a description in the schema the
// model reads on every turn; these name what they are.
#[expect(missing_docs, reason = "doc comments grow the model's schema")]
mod query;
#[expect(missing_docs, reason = "doc comments grow the model's schema")]
mod view;

pub use decode::{decode_view, deserialize_view};
pub use query::*;
pub use view::*;

use schemars::JsonSchema;

/// When and how to present a view, for the model.
const PRESENT_VIEW_DESCRIPTION: &str = concat!(
    "Inside ExecuteCode, `await execution.views.present(view)` presents the user a rich, interactive view (item cards, lists, timelines, calendar agendas, tags, channel messages) in the conversation, where `view` is the `view` property below. Nothing is saved and nothing comes back. ",
    "Decide for yourself when to present something: the user will not ask. When a turn made, changed or sent something the user will want to open, end it by presenting that item. ",
    "Present the smallest set that does the job: usually one to four cards for the items that matter, never every item a step touched. Leave out what you only read along the way, supporting or intermediate items, and items you already presented unless this turn changed them. Do not present a view when the answer is a sentence or two, or when nothing in the turn is worth opening. ",
    "For questions about workspace data - summaries of tasks, documents or activity, lists of items, anything that would otherwise need a markdown table or a long list - the view is the answer. Typical triggers: \"what did I get done this week?\", \"what is a teammate working on?\", \"my open tasks\", \"summarize this project\", and \"what happened in this channel?\". ",
    "Keep accompanying prose to a one-line lead-in that says what you did, and do not restate what the view shows. Never add a mention or link in your reply for an item the view shows: the view already opens it. ",
    "Entity-backed widgets take real workspace entity ids obtained from other tools such as ListEntities or search; never invent ids. Prefer list sources with kind \"items\" and those entity references. ",
    "To present calendar events, use an events widget with the eventIds a calendar tool returned: it renders an agenda loaded live from the calendar, so never restate the times in prose. Present one to four specific items - a document or spreadsheet, a database, an email thread, an event, a routine - in a cards widget, and a longer set in a list widget. ",
    "To present tags - the user's own, or a taxonomy or ontology of any depth - use a tags widget, never a table or a list in markdown. Nest narrower tags under the tags they belong to, and give a tag that exists the tagId a tag tool returned. ",
    "In a direct message with the user, the view is posted with your reply. ",
    "The view is checked against this schema before it is presented: a view that does not match throws with what to fix. Present it again rather than running the program again.",
);

/// The arguments of `execution.views.present`, as the model reads them.
#[derive(JsonSchema)]
#[schemars(title = "PresentView", description = PRESENT_VIEW_DESCRIPTION)]
#[expect(dead_code, reason = "only describes the arguments to the model")]
struct PresentViewArguments {
    view: View,
}

/// The `PresentView` schema, as compact JSON since ExecuteCode's description
/// includes it on every turn: a view, and when to present one.
pub fn present_view_schema() -> String {
    serde_json::to_string(&schemars::schema_for!(PresentViewArguments))
        .expect("a generated schema serializes")
}

#[cfg(test)]
mod test;
