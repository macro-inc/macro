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
        text.push_str(&format!(" for {}", list(ids, "or", |id| quoted(id))));
    }
    // Beside another condition, a choice of values is bracketed, so "or"
    // never reads as joining two conditions.
    let several = clause.all_of.len() > 1;
    let conditions: Vec<String> = clause
        .all_of
        .iter()
        .map(|each| {
            let text = condition(each, &clause.events);
            if several && each.one_of.len() > 1 {
                format!("({text})")
            } else {
                text
            }
        })
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
        McpFilterValue::Literal { value } => quoted(value),
        McpFilterValue::Me => "you".to_owned(),
    }
}

/// A value as a JSON string in a code span, with every character outside
/// printable ASCII escaped as `\uXXXX`: edge spaces, line breaks and
/// characters that render as nothing stay visible, so two values that differ
/// never read the same.
fn quoted(text: &str) -> String {
    let json = serde_json::Value::from(text).to_string();
    let mut shown = String::with_capacity(json.len());
    for character in json.chars() {
        if character.is_ascii_graphic() || character == ' ' {
            shown.push(character);
        } else {
            let mut units = [0_u16; 2];
            for unit in character.encode_utf16(&mut units) {
                shown.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    code(&shown)
}

/// `text` as a code span whose fence is longer than any run of backticks
/// inside it, so a value holding backticks still reads as one value.
fn code(text: &str) -> String {
    let longest = text
        .split(|character| character != '`')
        .map(str::len)
        .max()
        .unwrap_or(0);
    let fence = "`".repeat(longest + 1);
    let pad = if longest > 0 { " " } else { "" };
    format!("{fence}{pad}{text}{pad}{fence}")
}

fn list<T>(items: &[T], conjunction: &str, show: impl Fn(&T) -> String) -> String {
    let shown: Vec<String> = items.iter().map(show).collect();
    match shown.split_last() {
        None => String::new(),
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} {conjunction} {last}", rest.join(", ")),
    }
}
