//! Gmail's `q` search syntax, as far as the emulator understands it:
//! space-separated terms that must all match, `-` to negate one, quoted
//! phrases, and the operators `rfc822msgid:`, `from:`, `to:`, `subject:`,
//! `label:`, `is:`, `in:` and `has:attachment`. `OR`, braces and parentheses
//! are not understood; they match as plain words.

use std::collections::BTreeSet;

use nom::branch::alt;
use nom::bytes::complete::{take_until, take_while1};
use nom::character::complete::{char, multispace0};
use nom::combinator::opt;
use nom::multi::many0;
use nom::sequence::{delimited, preceded, terminated};
use nom::{IResult, Parser};
use serde_json::Value;

use crate::mailbox::{Label, StoredMessage};
use crate::mime::Parsed;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Predicate {
    MessageId(String),
    From(String),
    To(String),
    Subject(String),
    Label(String),
    /// A state such as `unread`, `read` or `starred`.
    Is(String),
    /// A place such as `inbox`, `trash` or `anywhere`.
    In(String),
    HasAttachment,
    Text(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Term {
    negated: bool,
    predicate: Predicate,
}

/// A parsed `q` value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Query {
    terms: Vec<Term>,
}

fn value(input: &str) -> IResult<&str, &str> {
    alt((
        delimited(char('"'), take_until("\""), char('"')),
        take_while1(|character: char| !character.is_whitespace()),
    ))
    .parse(input)
}

fn term(input: &str) -> IResult<&str, Term> {
    let (input, negated) = opt(char('-')).parse(input)?;
    let (input, operator) = opt(terminated(
        take_while1(|character: char| character.is_ascii_alphanumeric()),
        char(':'),
    ))
    .parse(input)?;
    let (input, value) = value(input)?;

    let lowered = value.to_lowercase();
    let predicate = match operator.map(str::to_lowercase).as_deref() {
        Some("rfc822msgid") => Predicate::MessageId(
            value
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_string(),
        ),
        Some("from") => Predicate::From(lowered),
        Some("to") => Predicate::To(lowered),
        Some("subject") => Predicate::Subject(lowered),
        Some("label") => Predicate::Label(lowered),
        Some("is") => Predicate::Is(lowered),
        Some("in") => Predicate::In(lowered),
        Some("has") if lowered == "attachment" => Predicate::HasAttachment,
        Some(other) => Predicate::Text(format!("{other}:{lowered}")),
        None => Predicate::Text(lowered),
    };

    Ok((
        input,
        Term {
            negated: negated.is_some(),
            predicate,
        },
    ))
}

impl Query {
    /// Parses a `q` value. Anything not understood matches as plain words.
    pub(crate) fn parse(input: &str) -> Self {
        let terms = many0(preceded(multispace0, term))
            .parse(input)
            .map(|(_, terms)| terms)
            .unwrap_or_default();
        Self { terms }
    }

    /// Whether the query asks for spam or trash, which a list otherwise hides.
    pub(crate) fn names_spam_or_trash(&self) -> bool {
        self.terms.iter().any(|term| {
            !term.negated
                && match &term.predicate {
                    Predicate::In(place) | Predicate::Label(place) => {
                        ["spam", "trash", "anywhere"].contains(&place.as_str())
                    }
                    _ => false,
                }
        })
    }

    pub(crate) fn matches(&self, message: &StoredMessage, labels: &[Label]) -> bool {
        self.matches_parsed(&message.parsed, &message.labels, labels)
    }

    fn matches_parsed(&self, parsed: &Parsed, held: &BTreeSet<String>, labels: &[Label]) -> bool {
        self.terms
            .iter()
            .all(|term| predicate_matches(&term.predicate, parsed, held, labels) != term.negated)
    }
}

fn header_contains(parsed: &Parsed, names: &[&str], needle: &str) -> bool {
    names
        .iter()
        .filter_map(|name| parsed.header(name))
        .any(|value| value.to_lowercase().contains(needle))
}

fn predicate_matches(
    predicate: &Predicate,
    parsed: &Parsed,
    held: &BTreeSet<String>,
    labels: &[Label],
) -> bool {
    match predicate {
        Predicate::MessageId(id) => parsed.message_id.as_deref() == Some(id.as_str()),
        Predicate::From(needle) => header_contains(parsed, &["From"], needle),
        Predicate::To(needle) => header_contains(parsed, &["To", "Cc", "Bcc"], needle),
        Predicate::Subject(needle) => header_contains(parsed, &["Subject"], needle),
        Predicate::Label(name) => labels
            .iter()
            .filter(|label| {
                label.id.eq_ignore_ascii_case(name)
                    || label.name.to_lowercase().replace(' ', "-") == *name
            })
            .any(|label| held.contains(&label.id)),
        Predicate::Is(state) => match state.as_str() {
            "read" => !held.contains("UNREAD"),
            other => held.contains(&other.to_uppercase()),
        },
        Predicate::In(place) => match place.as_str() {
            "anywhere" => true,
            "drafts" => held.contains("DRAFT"),
            other => held.contains(&other.to_uppercase()),
        },
        Predicate::HasAttachment => parsed.has_attachment,
        Predicate::Text(needle) => parsed.search_text.contains(needle),
    }
}

/// Whether an arriving message meets a Gmail filter's `criteria`.
pub(crate) fn filter_matches(criteria: &Value, parsed: &Parsed) -> bool {
    let text = |key: &str| criteria[key].as_str().map(str::to_lowercase);
    let no_labels = BTreeSet::new();

    let from = text("from").is_none_or(|needle| header_contains(parsed, &["From"], &needle));
    let to = text("to").is_none_or(|needle| header_contains(parsed, &["To", "Cc"], &needle));
    let subject =
        text("subject").is_none_or(|needle| header_contains(parsed, &["Subject"], &needle));
    let attachment = criteria["hasAttachment"]
        .as_bool()
        .is_none_or(|wanted| !wanted || parsed.has_attachment);
    let query = criteria["query"]
        .as_str()
        .is_none_or(|query| Query::parse(query).matches_parsed(parsed, &no_labels, &[]));
    let negated_query = criteria["negatedQuery"]
        .as_str()
        .is_none_or(|query| !Query::parse(query).matches_parsed(parsed, &no_labels, &[]));

    from && to && subject && attachment && query && negated_query
}

#[cfg(test)]
mod test;
