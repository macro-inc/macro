#[cfg(test)]
mod test;

use std::{collections::HashMap, fmt::Display};

use chrono::{DateTime, Utc};
use models_opensearch::SearchEntityType;

use crate::search::query::Keys;

/// Injects `fragment_size` into every highlight field config in the query JSON.
/// The `opensearch_query_builder` crate doesn't support `fragment_size` natively,
/// so we patch the serialized JSON after building.
pub(crate) fn inject_fragment_size(query: &mut serde_json::Value, fragment_size: u32) {
    if let Some(fields) = query
        .pointer_mut("/highlight/fields")
        .and_then(|v| v.as_object_mut())
    {
        for (_name, config) in fields.iter_mut() {
            if let Some(obj) = config.as_object_mut() {
                obj.insert(
                    "fragment_size".to_string(),
                    serde_json::json!(fragment_size),
                );
            }
        }
    }
}

/// Excludes `content` from `_source` in the query JSON. The content field is
/// only needed in highlights, not in the raw source — excluding it cuts ~40%
/// of the OpenSearch response payload.
pub(crate) fn exclude_source_content(query: &mut serde_json::Value) {
    if let Some(obj) = query.as_object_mut() {
        obj.insert(
            "_source".to_string(),
            serde_json::json!({"excludes": ["content"]}),
        );
    }
}

const MAX_VISIBLE_FRAGMENT_CHARS: usize = 1000;
const OPEN_TAG: &str = "<macro_em>";
const CLOSE_TAG: &str = "</macro_em>";
const CHARS_BEFORE_HIGHLIGHT: usize = 200;

fn normalize_highlight_fragment(fragment: &str) -> String {
    let stripped: String = fragment
        .chars()
        .filter(|&c| {
            !matches!(c,
                '\u{2800}'..='\u{28FF}' | '\u{200B}'..='\u{200F}' |
                '\u{2028}'..='\u{202F}' | '\u{2060}'..='\u{206F}' |
                '\u{FEFF}' | '\u{00AD}' | '\u{034F}'
            )
        })
        .collect();

    let mut prev_space = false;
    let normalized: String = stripped
        .chars()
        .filter_map(|c| {
            if c == '\n' || c == '\r' || c.is_whitespace() {
                if prev_space {
                    return None;
                }
                prev_space = true;
                Some(' ')
            } else {
                prev_space = false;
                Some(c)
            }
        })
        .collect();

    let trimmed = normalized.trim();
    window_around_highlight(trimmed, MAX_VISIBLE_FRAGMENT_CHARS)
}

/// Returns a window of `max_chars` visible characters around the first
/// `<macro_em>` highlight tag. If the highlight is near the start, the window
/// starts from the beginning. Otherwise, the front is trimmed (on a word
/// boundary) to keep the highlight visible. If no highlight tag is found,
/// truncates from the start.
fn window_around_highlight(s: &str, max_chars: usize) -> String {
    let tag_byte_pos = match s.find(OPEN_TAG) {
        Some(pos) => pos,
        None => return truncate_preserving_tags(s, max_chars),
    };

    let visible_before_tag = s[..tag_byte_pos]
        .replace(CLOSE_TAG, "")
        .replace(OPEN_TAG, "")
        .chars()
        .count();

    if visible_before_tag <= CHARS_BEFORE_HIGHLIGHT {
        return truncate_preserving_tags(s, max_chars);
    }

    let target_visible_skip = visible_before_tag.saturating_sub(CHARS_BEFORE_HIGHLIGHT);
    let prefix = &s[..tag_byte_pos];
    let no_tags = prefix.replace(OPEN_TAG, "").replace(CLOSE_TAG, "");
    let skip_byte_len: usize = no_tags
        .chars()
        .take(target_visible_skip)
        .map(|c| c.len_utf8())
        .sum();

    let cut_point = find_tag_aware_byte_offset(prefix, skip_byte_len);

    let after_cut = &s[cut_point..];
    let word_break = after_cut
        .find(|c: char| c.is_whitespace())
        .map(|i| i + 1)
        .unwrap_or(0);

    let windowed = &after_cut[word_break..];
    let truncated = truncate_preserving_tags(windowed, max_chars);
    format!("...{truncated}")
}

/// Maps a visible-char byte length to the actual byte offset in text that may
/// contain `<macro_em>` / `</macro_em>` tags (skipping tag bytes).
fn find_tag_aware_byte_offset(s: &str, visible_byte_len: usize) -> usize {
    let mut visible_bytes = 0;
    let mut byte_offset = 0;
    while byte_offset < s.len() {
        if s[byte_offset..].starts_with(OPEN_TAG) {
            byte_offset += OPEN_TAG.len();
            continue;
        }
        if s[byte_offset..].starts_with(CLOSE_TAG) {
            byte_offset += CLOSE_TAG.len();
            continue;
        }
        if visible_bytes >= visible_byte_len {
            break;
        }
        let c = s[byte_offset..].chars().next().unwrap();
        visible_bytes += c.len_utf8();
        byte_offset += c.len_utf8();
    }
    byte_offset
}

/// Truncates a highlight fragment to `max_chars` visible characters (excluding
/// `<macro_em>`/`</macro_em>` tags from the count). If truncation lands inside
/// an open tag, the closing tag is appended. Adds "..." when truncated.
fn truncate_preserving_tags(s: &str, max_chars: usize) -> String {
    let mut result = String::new();
    let mut visible_count = 0;
    let mut inside_tag = false;
    let mut chars = s.chars().peekable();

    while let Some(&c) = chars.peek() {
        if visible_count >= max_chars {
            break;
        }

        if c == '<' {
            let rest: String = chars.clone().collect();
            if rest.starts_with(OPEN_TAG) {
                for _ in 0..OPEN_TAG.len() {
                    result.push(chars.next().unwrap());
                }
                inside_tag = true;
                continue;
            } else if rest.starts_with(CLOSE_TAG) {
                for _ in 0..CLOSE_TAG.len() {
                    result.push(chars.next().unwrap());
                }
                inside_tag = false;
                continue;
            }
        }

        result.push(c);
        visible_count += 1;
        chars.next();
    }

    if visible_count >= max_chars && chars.peek().is_some() {
        if inside_tag {
            result.push_str(CLOSE_TAG);
        }
        result.push_str("...");
    }

    result
}

/// macro open/close tags for highlight matches
#[derive(Debug, PartialEq)]
pub(crate) enum MacroEm {
    /// Open tag <macro_em>
    Open,
    /// Close tag </macro_em>
    Close,
}

impl Display for MacroEm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Open => write!(f, "<macro_em>"),
            Self::Close => write!(f, "</macro_em>"),
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Hit<T> {
    #[serde(rename = "_score")]
    pub score: Option<f64>,
    #[serde(rename = "_source")]
    pub source: T,
    /// Highlights may or may not be present since we could match
    /// purely on the title of the item
    pub highlight: Option<HashMap<String, Vec<String>>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Default, Clone)]
pub struct Highlight {
    /// The highlight name match if present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// The highlight content matches
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<String>,

    /// The highlight match on the user (owner) of the entity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// The highlight match on the sender (email only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender: Option<String>,
    /// The highlight match on the recipients (email only)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub recipients: Vec<String>,
    /// The highlight match on the cc (email only)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub cc: Vec<String>,
    /// The highlight match on the bcc (email only)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub bcc: Vec<String>,
}

pub(crate) fn parse_highlight_hit(
    highlight: HashMap<String, Vec<String>>,
    keys: Keys,
) -> Highlight {
    // The highlight on the user id
    let user_id = highlight
        .get("user_id")
        .and_then(|v| v.first())
        .map(|v| v.to_string());

    // If the user id is not present we should try the owner_id which is the
    // user field in documents index
    let user_id = if user_id.is_none() {
        highlight
            .get("owner_id")
            .and_then(|v| v.first())
            .map(|v| v.to_string())
    } else {
        user_id
    };

    Highlight {
        user_id,
        name: highlight
            .get(keys.title_key)
            .and_then(|v| v.first())
            .map(|v| v.to_string()),
        content: highlight
            .get(keys.content_key)
            .map(|v| v.iter().map(|f| normalize_highlight_fragment(f)).collect())
            .unwrap_or_default(),
        sender: highlight
            .get("sender_name")
            .or_else(|| highlight.get("sender"))
            .and_then(|v| v.first())
            .map(|v| v.to_string()),
        recipients: highlight
            .get("recipient_names")
            .or_else(|| highlight.get("recipients"))
            .map(|v| v.to_vec())
            .unwrap_or_default(),
        cc: highlight
            .get("cc_names")
            .or_else(|| highlight.get("cc"))
            .map(|v| v.to_vec())
            .unwrap_or_default(),
        bcc: highlight
            .get("bcc_names")
            .or_else(|| highlight.get("bcc"))
            .map(|v| v.to_vec())
            .unwrap_or_default(),
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Total {
    pub value: i64,
    pub relation: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Hits<T> {
    pub total: Total,
    pub max_score: Option<f64>,
    pub hits: Vec<Hit<T>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Shards {
    pub total: i32,
    pub successful: i32,
    pub skipped: i32,
    pub failed: i32,
}

pub(crate) type DefaultSearchResponse<T> = SearchResponse<T>;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct SearchResponse<T> {
    pub hits: Hits<T>,
    pub took: i32,
    pub timed_out: bool,
    pub _shards: Shards,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct SearchGotoDocument {
    /// The node id of the document.
    /// This is either a 0-indexed page number for pdfs (and docx since they are pdfs)
    /// or a uuid of a lexical node for md. This can be ignored for all other
    /// file types.
    pub node_id: String,
    /// The raw content of the document
    pub raw_content: Option<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct SearchGotoChat {
    /// The chat message id
    pub chat_message_id: uuid::Uuid,
    /// The role of the chat message
    pub role: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct SearchGotoEmail {
    /// The email message id
    pub email_message_id: uuid::Uuid,
    /// The bcc of the email
    pub bcc: Vec<String>,
    /// The cc of the email
    pub cc: Vec<String>,
    /// The labels of the email
    pub labels: Vec<String>,
    /// The sent_at timestamp of the email
    pub sent_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The sender of the email
    pub sender: String,
    /// The recipients of the email
    pub recipients: Vec<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct SearchGotoChannel {
    /// The channel message id
    pub channel_message_id: uuid::Uuid,
    pub thread_id: Option<uuid::Uuid>,
    pub sender_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Enum containing structs for all data needed to handle search "goto" in the frontend
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(untagged)]
pub enum SearchGotoContent {
    Documents(SearchGotoDocument),
    Chats(SearchGotoChat),
    Emails(SearchGotoEmail),
    Channels(SearchGotoChannel),
    // there is no goto needed for projects
}

/// This struct represents a single search hit for a given entity
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct SearchHit {
    /// The id of the entity
    pub entity_id: uuid::Uuid,
    /// The entity type
    pub entity_type: SearchEntityType,
    /// The score of the match
    pub score: Option<f64>,
    /// The highlight of the match
    pub highlight: Highlight,
    /// The goto content for the entity
    pub goto: Option<SearchGotoContent>,
    /// Timestamp for sorting across sources (None sorts to bottom)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}
