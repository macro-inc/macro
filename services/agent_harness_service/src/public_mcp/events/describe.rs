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
        McpFilterValue::Literal { value } => quoted(value),
        McpFilterValue::Me => "you".to_owned(),
    }
}

/// A value as a JSON string in a code span, so edge spaces, line breaks and
/// other characters a Markdown renderer would fold stay visible and exact.
/// Characters that render as nothing, or as plain space, are escaped too, so
/// two values that differ never read the same.
fn quoted(text: &str) -> String {
    let json = serde_json::Value::from(text).to_string();
    let mut shown = String::with_capacity(json.len());
    for character in json.chars() {
        if invisible(character) {
            let mut units = [0_u16; 2];
            for unit in character.encode_utf16(&mut units) {
                shown.push_str(&format!("\\u{unit:04x}"));
            }
        } else {
            shown.push(character);
        }
    }
    code(&shown)
}

/// Control, format and non-ASCII space characters: the ones a reader cannot
/// tell apart from nothing or from a plain space.
fn invisible(character: char) -> bool {
    character.is_control()
        || (character.is_whitespace() && character != ' ')
        || matches!(
            character,
            '\u{00AD}'
                | '\u{034F}'
                | '\u{061C}'
                | '\u{115F}'
                | '\u{1160}'
                | '\u{17B4}'
                | '\u{17B5}'
                | '\u{180B}'..='\u{180F}'
                | '\u{200B}'..='\u{200F}'
                | '\u{202A}'..='\u{202E}'
                | '\u{2060}'..='\u{206F}'
                | '\u{3164}'
                | '\u{FE00}'..='\u{FE0F}'
                | '\u{FEFF}'
                | '\u{FFA0}'
                | '\u{FFF0}'..='\u{FFFB}'
                | '\u{1D173}'..='\u{1D17A}'
                | '\u{E0000}'..='\u{E0FFF}'
        )
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
