//! Typed, bounded conversion evidence. Resolution is a separate authorized,
//! source-scoped read-only use case; a Slack hostname alone is not source proof.

use std::ops::Range;

use macro_user_id::user_id::MacroUserIdStr;
use mention_utils::serialize::{ChannelMentionParams, channel_mention};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::models::{ConversationId, SlackTimestamp};

/// Read-only, source-proven and authorized canonical resolution.
#[cfg(feature = "ports")]
pub mod resolve;

#[cfg(test)]
mod test;

/// Maximum source text and cumulative generated token/fallback bytes accepted
/// by the additive reference conversion API (separate budgets).
pub const MAX_SOURCE_BYTES: usize = 1024 * 1024;
/// Maximum reference occurrences and emitted user-mention occurrences per body.
pub const MAX_REFERENCES: usize = 256;

/// Exact source identity, never an inferred Macro target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SourceReference {
    /// Slack channel token in this archive's bound source.
    Channel {
        /// Source channel identifier.
        channel: ConversationId,
    },
    /// A syntactically supported Slack permalink, not yet trusted source evidence.
    Message {
        /// URL hostname. Must match independently established source/domain evidence.
        hostname: String,
        /// Source channel identifier.
        channel: ConversationId,
        /// Exact message timestamp from the path (not thread_ts).
        timestamp: SlackTimestamp,
        /// Optional source root hint. Never a Macro root ID.
        thread_timestamp: Option<SlackTimestamp>,
    },
}

/// A reference occurrence in an immutable fallback body. Byte ranges are produced
/// during rendering, not discovered by searching or parsing serialized tags.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReferenceIntent {
    /// Identity to look up with team, bound source, and requester read access.
    pub source: SourceReference,
    /// Byte range in `ConvertedText::body` occupied by the fallback.
    pub range: Range<usize>,
    /// Source-only fallback; no inaccessible Macro names/IDs may enrich it.
    pub fallback: String,
}

/// Additive converter result. Persist this alongside the original imported body
/// when deferring resolution; never parse the body to recover mention identities.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConvertedText {
    /// Safe initially rendered body, including code verbatim.
    pub body: String,
    /// Only user mentions actively emitted outside code, in occurrence order.
    pub user_mentions: Vec<MacroUserIdStr<'static>>,
    /// Bounded source reference occurrences, in body order.
    pub references: Vec<ReferenceIntent>,
}

/// Canonical authorized targets supplied by a subsequent resolver. Constructing
/// these values does not grant access; the caller must verify read access and
/// matching source identity first. The UI still enforces per-viewer access.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedTarget {
    /// Authorized Macro channel.
    Channel {
        /// Canonical channel UUID.
        channel_id: Uuid,
        /// Authorized entity name, not an arbitrary source label.
        name: String,
    },
    /// Authorized Macro message; never downgrade a missing message to a channel.
    Message {
        /// Canonical channel UUID (the mention's documentId).
        channel_id: Uuid,
        /// Authorized channel name.
        name: String,
        /// Canonical message UUID.
        message_id: Uuid,
        /// Persisted root UUID, if known.
        thread_id: Option<Uuid>,
    },
}

/// Invalid or oversized conversion/template input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ReferenceError {
    /// Reject rather than silently dropping reference or mention evidence.
    #[error("source text or reference count exceeds conversion limits")]
    LimitExceeded,
    /// A persisted template was modified or has invalid/overlapping ranges.
    #[error("invalid reference template")]
    InvalidTemplate,
}

impl ConvertedText {
    /// Render replacements by occurrence against the original template, never a
    /// live edited body. Missing or incompatible targets retain the exact fallback.
    /// Persistence must separately fence updates against live edits/deletion.
    pub fn render(&self, targets: &[Option<ResolvedTarget>]) -> Result<String, ReferenceError> {
        if self.references.len() > MAX_REFERENCES || self.user_mentions.len() > MAX_REFERENCES {
            return Err(ReferenceError::LimitExceeded);
        }
        let mut out = String::new();
        let mut cursor = 0;
        for (index, intent) in self.references.iter().enumerate() {
            let range = &intent.range;
            if range.start < cursor
                || self.body.get(range.clone()) != Some(intent.fallback.as_str())
            {
                return Err(ReferenceError::InvalidTemplate);
            }
            out.push_str(
                self.body
                    .get(cursor..range.start)
                    .ok_or(ReferenceError::InvalidTemplate)?,
            );
            let replacement = targets
                .get(index)
                .and_then(Option::as_ref)
                .and_then(|target| intent.source.render_target(target));
            out.push_str(replacement.as_deref().unwrap_or(&intent.fallback));
            cursor = range.end;
        }
        out.push_str(
            self.body
                .get(cursor..)
                .ok_or(ReferenceError::InvalidTemplate)?,
        );
        Ok(out)
    }
}

impl SourceReference {
    fn render_target(&self, target: &ResolvedTarget) -> Option<String> {
        let (channel_id, name, message_id, thread_id) = match (self, target) {
            (Self::Channel { .. }, ResolvedTarget::Channel { channel_id, name }) => {
                (channel_id, name, None, None)
            }
            (
                Self::Message { .. },
                ResolvedTarget::Message {
                    channel_id,
                    name,
                    message_id,
                    thread_id,
                },
            ) => (
                channel_id,
                name,
                Some(message_id.to_string()),
                thread_id.map(|id| id.to_string()),
            ),
            _ => return None,
        };
        Some(
            channel_mention(
                &channel_id.to_string(),
                name,
                ChannelMentionParams {
                    channel_message_id: message_id.as_deref(),
                    channel_thread_id: thread_id.as_deref(),
                },
            )
            .expect("serializing string fields cannot fail"),
        )
    }
}

/// Recognize HTTPS workspace Slack `/archives/C…/p<seconds><six micros>`
/// permalinks, including reply URLs with exact `thread_ts` and optional `cid`.
/// Reject credentials, custom ports, fragments, extra path segments, duplicate or
/// unknown query keys. This recognizes syntax only; it never authorizes resolution.
pub fn parse_permalink(input: &str) -> Option<SourceReference> {
    mention_utils::serialize::ExternalLink::new(input, "").ok()?;
    let url = url::Url::parse(input).ok()?;
    // WHATWG URL parsing normalizes dot segments. Do not expand our documented
    // permalink forms by accepting a different source path after normalization.
    let (_, authority_and_path) = input.split_once("://")?;
    let path_start = authority_and_path.find('/')?;
    if authority_and_path[..path_start].contains('@') {
        return None;
    }
    let raw_path = authority_and_path[path_start..].split(['?', '#']).next()?;
    if raw_path != url.path() {
        return None;
    }
    let hostname = url.host_str()?;
    let workspace = hostname.strip_suffix(".slack.com")?;
    if url.scheme() != "https"
        || workspace.is_empty()
        || workspace.contains('.')
        || !workspace
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let parts: Vec<_> = url.path().split('/').collect();
    let ["", "archives", channel, message] = parts.as_slice() else {
        return None;
    };
    let channel: ConversationId = channel.parse().ok()?;
    let digits = message.strip_prefix('p')?;
    if !(7..=18).contains(&digits.len()) || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (seconds, micros) = digits.split_at(digits.len() - 6);
    let timestamp = format!("{seconds}.{micros}").parse().ok()?;
    let mut thread_timestamp = None;
    let mut cid = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "thread_ts" if thread_timestamp.is_none() => {
                let (_, fraction) = value.split_once('.')?;
                if fraction.len() != 6 {
                    return None;
                }
                thread_timestamp = Some(value.parse().ok()?);
            }
            "cid" if cid.is_none() => {
                cid = Some(value.parse::<ConversationId>().ok()?);
                if cid.as_ref() != Some(&channel) {
                    return None;
                }
            }
            _ => return None,
        }
    }
    if thread_timestamp.is_some_and(|root| root > timestamp) {
        return None;
    }
    Some(SourceReference::Message {
        hostname: hostname.to_owned(),
        channel,
        timestamp,
        thread_timestamp,
    })
}
