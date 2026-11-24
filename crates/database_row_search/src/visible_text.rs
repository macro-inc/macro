//! A row's searchable text, from its cells as Postgres stores them.

use std::fmt::Formatter;

use mention_utils::parse::{
    ParsedAgentSessionMention, ParsedBookingLinkMention, ParsedContactMention, ParsedDateMention,
    ParsedDocumentMention, ParsedGroupMention, ParsedLink, ParsedPullRequestMention,
    ParsedUserMention, ParsedXmlText, PlainTextFormatter, XmlFormatter,
};

/// A column type whose cells are searchable. Every other type (numbers,
/// percentages, booleans, dates, date ranges, derived values, entity and
/// relation references) never is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SearchableKind {
    /// Markdown text; mentions in it read as their visible label.
    Text,
    /// Links, as written.
    Link,
    /// Select, number select and tag cells, as their options' labels.
    Options,
}

impl SearchableKind {
    /// The kind of a `property_data_type`, or `None` when it is not searchable.
    pub(crate) fn of(data_type: &str) -> Option<Self> {
        match data_type {
            "STRING" => Some(Self::Text),
            "LINK" => Some(Self::Link),
            "SELECT_STRING" | "SELECT_NUMBER" | "TAG" => Some(Self::Options),
            _ => None,
        }
    }
}

/// One cell of a row, in its table's column order.
#[derive(Debug, Clone)]
pub(crate) struct CellInput {
    /// `None` for a column whose type is not searchable.
    pub(crate) kind: Option<SearchableKind>,
    /// The stored `entity_properties.values`, if the cell holds one.
    pub(crate) values: Option<serde_json::Value>,
    /// Labels of the options the cell picks, in the order it picks them.
    pub(crate) option_labels: Vec<String>,
}

/// A row's title and its other searchable cells.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RowText {
    pub(crate) title: String,
    pub(crate) cell_text: Vec<String>,
}

/// Build a row's text from its cells, the first being the title column.
///
/// The title is the first column's text when that column is searchable, and
/// empty otherwise: a number or a reference in the first column is no more
/// searchable there than anywhere else.
pub(crate) fn row_text(cells: &[CellInput]) -> RowText {
    let mut cells = cells.iter();

    let title = cells
        .next()
        .map(|cell| cell_strings(cell).join(", "))
        .unwrap_or_default();

    let cell_text = cells.flat_map(cell_strings).collect();

    RowText { title, cell_text }
}

/// The non-empty strings a cell contributes.
fn cell_strings(cell: &CellInput) -> Vec<String> {
    let Some(kind) = cell.kind else {
        return Vec::new();
    };

    let strings = match kind {
        SearchableKind::Text => cell
            .values
            .as_ref()
            .and_then(|values| values.get("value"))
            .and_then(serde_json::Value::as_str)
            .map(visible_text)
            .into_iter()
            .collect(),
        SearchableKind::Link => cell
            .values
            .as_ref()
            .and_then(|values| values.get("value"))
            .and_then(serde_json::Value::as_array)
            .map(|links| {
                links
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        SearchableKind::Options => cell.option_labels.clone(),
    };

    strings
        .into_iter()
        .map(|string| string.trim().to_owned())
        .filter(|string| !string.is_empty())
        .collect()
}

/// Text cell markdown as a reader sees it: every mention reduced to its
/// visible label, with no ids.
pub(crate) fn visible_text(markdown: &str) -> String {
    VisibleLabelFormatter::format_xml_text(ParsedXmlText::parse_lenient(markdown)).0
}

/// Writes each mention as the label the app shows for it. It differs from
/// [`PlainTextFormatter`] only for people: a person reads as their display
/// name, or the start of their address when they have none, never as an id
/// or a full address.
struct VisibleLabelFormatter;

impl XmlFormatter for VisibleLabelFormatter {
    fn format_plain_text(s: &str, f: &mut Formatter<'_>) -> std::fmt::Result {
        PlainTextFormatter::format_plain_text(s, f)
    }

    fn format_link(link: &ParsedLink<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        PlainTextFormatter::format_link(link, f)
    }

    fn format_doc(doc: &ParsedDocumentMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", doc.document_name)
    }

    fn format_user(user: &ParsedUserMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        let display_name = user
            .display_name
            .as_deref()
            .filter(|name| !name.trim().is_empty());
        if let Some(name) = display_name {
            return write!(f, "{name}");
        }

        let address_start = user
            .email
            .as_deref()
            .and_then(|email| email.split('@').next());
        write!(f, "{}", address_start.unwrap_or_default())
    }

    fn format_contact(
        contact: &ParsedContactMention<'_>,
        f: &mut Formatter<'_>,
    ) -> std::fmt::Result {
        PlainTextFormatter::format_contact(contact, f)
    }

    fn format_date(date: &ParsedDateMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        PlainTextFormatter::format_date(date, f)
    }

    fn format_group(group: &ParsedGroupMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        PlainTextFormatter::format_group(group, f)
    }

    fn format_agent_session(
        session: &ParsedAgentSessionMention<'_>,
        f: &mut Formatter<'_>,
    ) -> std::fmt::Result {
        PlainTextFormatter::format_agent_session(session, f)
    }

    fn format_pull_request(
        pr: &ParsedPullRequestMention<'_>,
        f: &mut Formatter<'_>,
    ) -> std::fmt::Result {
        PlainTextFormatter::format_pull_request(pr, f)
    }

    fn format_booking_link(
        link: &ParsedBookingLinkMention<'_>,
        f: &mut Formatter<'_>,
    ) -> std::fmt::Result {
        PlainTextFormatter::format_booking_link(link, f)
    }
}

#[cfg(test)]
mod test;
