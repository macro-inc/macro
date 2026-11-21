//! A compiled filter read back in words. Derived from the filter alone, never
//! from the model, so it says exactly what delivery will evaluate.

use webhook::domain::mcp::filter::{
    McpEventFilter, McpFieldCondition, McpFilterClause, McpFilterField, McpFilterValue,
};

/// The filter in words: one sentence per alternative.
pub(crate) fn describe(filter: &McpEventFilter) -> String {
    let clauses: Vec<String> = filter.any_of.iter().map(clause).collect();
    match clauses.as_slice() {
        [only] => format!("{only}."),
        _ => format!("Any of: {}.", clauses.join("; or ")),
    }
}

fn clause(clause: &McpFilterClause) -> String {
    let mut text = format!("{} events", list(&clause.events, "or", |event| code(event)));
    if let Some(ids) = &clause.ids {
        text.push_str(&format!(" for {}", list(ids, "or", |id| code(id))));
    }
    let conditions: Vec<String> = clause
        .all_of
        .iter()
        .map(|each| condition(each, &clause.events))
        .collect();
    if !conditions.is_empty() {
        text.push_str(" where ");
        text.push_str(&conditions.join(" and "));
    }
    text
}

/// Events whose `actor` is the message's sender; every other message event
/// names whoever acted on it, who need not be its author.
const SENT_EVENTS: [&str; 2] = ["message.posted", "message.mentioned"];

fn condition(condition: &McpFieldCondition, events: &[String]) -> String {
    let field = match condition.field {
        McpFilterField::ParentType => "the message is in a",
        McpFilterField::ParentId => "the message is in",
        McpFilterField::Actor
            if events
                .iter()
                .all(|event| SENT_EVENTS.contains(&event.as_str())) =>
        {
            "the sender is"
        }
        McpFilterField::Actor => {
            "whoever acted (sent it, or for an edit, deletion or attachment change, \
             whoever made that change, not necessarily its author) is"
        }
        McpFilterField::MentionedType => "the mentioned item is a",
        McpFilterField::MentionedId => "the mentioned item is",
    };
    format!("{field} {}", list(&condition.one_of, "or", value))
}

fn value(value: &McpFilterValue) -> String {
    match value {
        McpFilterValue::Literal { value } => code(value),
        McpFilterValue::Me => "you".to_owned(),
    }
}

fn code(text: &str) -> String {
    format!("`{text}`")
}

fn list<T>(items: &[T], conjunction: &str, show: impl Fn(&T) -> String) -> String {
    let shown: Vec<String> = items.iter().map(show).collect();
    match shown.split_last() {
        None => String::new(),
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} {conjunction} {last}", rest.join(", ")),
    }
}
