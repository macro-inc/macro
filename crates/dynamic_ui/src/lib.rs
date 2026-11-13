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
    "To present calendar events, use an events widget with the eventIds a calendar tool returned: it renders an agenda loaded live from the calendar, so never restate the times in prose. Present one to four specific items - a document or spreadsheet, an email thread, an event, a routine - in a cards widget, and a longer set in a list widget. ",
    "To present tags - the user's own, or a taxonomy or ontology of any depth - use a tags widget, never a table or a list in markdown. Nest narrower tags under the tags they belong to, and give a tag that exists the tagId a tag tool returned. ",
    "In a direct message with the user, the view is posted with your reply. ",
    "The view is checked against this schema before it is presented: a view that does not match throws with what to fix. Present it again rather than running the program again.",
);

/// What a dashboard view adds, for the model: only people with agent
/// dashboards read it.
const DASHBOARD_DESCRIPTION: &str = concat!(
    " A dashboard is a view built from panes that read live data as whoever opens it, so it stays current: never copy numbers into it. ",
    "Agent panes show an agent account's work: sessions (its sessions and sub-agents with live status and waiting questions), activity (what it did, or what one session did), routines (the routines it owns with next run and last result) and spend (its AI cost by day, week, month or year). ",
    "Each takes the agent's user id; omit it on a dashboard that belongs to an agent to show that agent. ",
    "A pane its viewer cannot read says so, and panes below the fold load when scrolled to, so a dashboard may hold many.",
);

/// The arguments of `execution.views.present`, as the model reads them.
#[derive(JsonSchema)]
#[schemars(title = "PresentView", description = PRESENT_VIEW_DESCRIPTION)]
#[expect(dead_code, reason = "only describes the arguments to the model")]
struct PresentViewArguments {
    #[schemars(with = "ViewWithoutDashboards")]
    view: View,
}

/// [`PresentViewArguments`] for people with agent dashboards.
#[derive(JsonSchema)]
#[schemars(
    title = "PresentView",
    description = format!("{PRESENT_VIEW_DESCRIPTION}{DASHBOARD_DESCRIPTION}")
)]
#[expect(dead_code, reason = "only describes the arguments to the model")]
struct PresentDashboardArguments {
    view: View,
}

/// The `enable-agent-dashboards` feature flag, identical on web and
/// backend. Hosts read it per person to choose an [`Offer`].
pub const AGENT_DASHBOARDS_FLAG: &str = "enable-agent-dashboards";

/// Which widgets the model is told about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Offer {
    /// The widgets every view may hold.
    Views,
    /// Those and the dashboard layouts and panes, for people with agent
    /// dashboards.
    Dashboards,
}

/// The `PresentView` schema, as compact JSON since ExecuteCode's description
/// includes it on every turn: a view, and when to present one.
pub fn present_view_schema(offer: Offer) -> String {
    let schema = match offer {
        Offer::Views => schemars::schema_for!(PresentViewArguments),
        Offer::Dashboards => schemars::schema_for!(PresentDashboardArguments),
    };
    serde_json::to_string(&schema).expect("a generated schema serializes")
}

/// The widget types only dashboards are offered.
pub(crate) const DASHBOARD_WIDGETS: [&str; 4] = ["sessions", "activity", "routines", "spend"];

/// The definitions only dashboard widgets use.
/// Their schema names carry `Dashboard` so no other type's definition shares
/// one in a generator that holds many tools.
const DASHBOARD_DEFINITIONS: [&str; 1] = ["DashboardSpendBucket"];

/// A [`View`]'s schema without the dashboard layouts and panes: what a model
/// reads when its person does not have agent dashboards. Use it for a view
/// field with `#[schemars(with = "dynamic_ui::ViewWithoutDashboards")]`.
pub struct ViewWithoutDashboards;

impl JsonSchema for ViewWithoutDashboards {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        View::schema_name()
    }

    fn schema_id() -> std::borrow::Cow<'static, str> {
        "dynamic_ui::ViewWithoutDashboards".into()
    }

    fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        // A generator that inlines subschemas puts the widget variants in the
        // view's own schema, one that does not in its definitions: prune both.
        let mut schema = View::json_schema(generator).to_value();
        without_dashboard_variants(&mut schema);
        let definitions = generator.definitions_mut();
        for name in DASHBOARD_DEFINITIONS {
            definitions.remove(name);
        }
        if let Some(widget) = definitions.get_mut("Widget") {
            without_dashboard_variants(widget);
        }
        schemars::Schema::try_from(schema).expect("a pruned schema is still a schema")
    }
}

/// Drop every `oneOf`/`anyOf` alternative tagged as a dashboard widget,
/// wherever the schema holds one.
fn without_dashboard_variants(schema: &mut serde_json::Value) {
    use serde_json::Value;

    match schema {
        Value::Object(fields) => {
            for key in ["oneOf", "anyOf"] {
                if let Some(Value::Array(variants)) = fields.get_mut(key) {
                    variants.retain(|variant| {
                        let tag = variant["properties"]["type"]["const"].as_str();
                        !tag.is_some_and(|tag| DASHBOARD_WIDGETS.contains(&tag))
                    });
                }
            }
            for value in fields.values_mut() {
                without_dashboard_variants(value);
            }
        }
        Value::Array(items) => {
            for item in items {
                without_dashboard_variants(item);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod test;
