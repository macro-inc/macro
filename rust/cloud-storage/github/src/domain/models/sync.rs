//! Domain models for github sync operations (webhooks and sync app).

use std::collections::HashSet;
use std::fmt;
use std::sync::LazyLock;

use regex::Regex;
use serde::Deserialize;

/// GitHub App installation access token response
#[derive(Debug, Clone, Deserialize)]
pub struct GithubInstallationAccessToken {
    /// The installation access token
    pub token: String,
    /// When the token expires
    pub expires_at: String,
}

/// A validated github webhook event
#[derive(Debug)]
pub struct ValidatedGithubWebhookEvent {
    /// The event type from the `X-GitHub-Event` header
    pub event_type: String,
    /// The parsed JSON payload
    pub payload: serde_json::Value,
}

impl ValidatedGithubWebhookEvent {
    /// Create a new ValidatedGithubWebhookEvent
    pub fn new(event_type: String, payload: serde_json::Value) -> Self {
        Self {
            event_type,
            payload,
        }
    }

    /// Parse the raw event type string into a [`GithubWebhookEventType`].
    pub fn parsed_event_type(&self) -> GithubWebhookEventType {
        GithubWebhookEventType::from_event_header(&self.event_type)
    }

    /// Extract all text fields worth searching for task IDs, based on event type.
    pub fn extract_searchable_text(&self) -> Vec<String> {
        let mut texts = Vec::new();
        match self.parsed_event_type() {
            GithubWebhookEventType::PullRequest => {
                if let Some(pr) = self.payload.get("pull_request") {
                    if let Some(s) = pr.get("title").and_then(|v| v.as_str()) {
                        texts.push(s.to_string());
                    }
                    if let Some(s) = pr.get("body").and_then(|v| v.as_str()) {
                        texts.push(s.to_string());
                    }
                    if let Some(s) = pr
                        .get("head")
                        .and_then(|h| h.get("ref"))
                        .and_then(|v| v.as_str())
                    {
                        texts.push(s.to_string());
                    }
                }
            }
            GithubWebhookEventType::IssueComment
            | GithubWebhookEventType::PullRequestReviewComment => {
                if let Some(s) = self
                    .payload
                    .get("comment")
                    .and_then(|c| c.get("body"))
                    .and_then(|v| v.as_str())
                {
                    texts.push(s.to_string());
                }
            }
            GithubWebhookEventType::PullRequestReview => {
                if let Some(s) = self
                    .payload
                    .get("review")
                    .and_then(|r| r.get("body"))
                    .and_then(|v| v.as_str())
                {
                    texts.push(s.to_string());
                }
            }
            GithubWebhookEventType::Unknown(_) => {}
        }
        texts
    }
}

/// Known GitHub webhook event types we handle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubWebhookEventType {
    /// `pull_request` events
    PullRequest,
    /// `issue_comment` events (includes comments on PRs)
    IssueComment,
    /// `pull_request_review` events
    PullRequestReview,
    /// `pull_request_review_comment` events
    PullRequestReviewComment,
    /// Any event type we don't handle
    Unknown(String),
}

impl GithubWebhookEventType {
    /// Map the raw `X-GitHub-Event` header value to a variant.
    pub fn from_event_header(s: &str) -> Self {
        match s {
            "pull_request" => Self::PullRequest,
            "issue_comment" => Self::IssueComment,
            "pull_request_review" => Self::PullRequestReview,
            "pull_request_review_comment" => Self::PullRequestReviewComment,
            other => Self::Unknown(other.to_string()),
        }
    }
}

/// Regex matching `MACRO-{short_uuid}` (case-insensitive).
/// The capture group contains only the Flickr base58 short UUID portion.
static MACRO_TASK_ID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)macro-([123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ]+)")
        .expect("valid regex")
});

/// A Macro task ID in the form `MACRO-{short_uuid}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MacroTaskId {
    /// The Flickr base58 short UUID portion
    pub short_uuid: String,
}

impl MacroTaskId {
    /// Create from a raw short UUID string, validating that all characters
    /// are in the Flickr base58 alphabet.
    pub fn from_short_uuid(s: &str) -> Option<Self> {
        let converter = macro_uuid::ShortUuidConverter::default();
        if converter.is_short_uuid(s) {
            Some(Self {
                short_uuid: s.to_string(),
            })
        } else {
            None
        }
    }

    /// Create from a full UUID by converting to a short UUID.
    pub fn from_uuid(uuid: &uuid::Uuid) -> Self {
        let converter = macro_uuid::ShortUuidConverter::default();
        Self {
            short_uuid: converter.from_uuid(uuid),
        }
    }

    /// Convert back to a full UUID.
    pub fn to_uuid(&self) -> anyhow::Result<uuid::Uuid> {
        let converter = macro_uuid::ShortUuidConverter::default();
        converter.to_uuid(&self.short_uuid)
    }

    /// Returns the canonical `MACRO-{short_uuid}` string.
    pub fn to_task_id_string(&self) -> String {
        format!("MACRO-{}", self.short_uuid)
    }

    /// Extract all unique `MACRO-{short_uuid}` references from text.
    /// Matching is case-insensitive on the `MACRO-` prefix; the short UUID
    /// portion is preserved as captured.
    pub fn extract_from_text(text: &str) -> Vec<MacroTaskId> {
        let mut seen = HashSet::new();
        let mut results = Vec::new();

        for caps in MACRO_TASK_ID_RE.captures_iter(text) {
            let short = &caps[1];
            if seen.insert(short.to_string())
                && let Some(task_id) = Self::from_short_uuid(short)
            {
                results.push(task_id);
            }
        }

        results
    }
}

impl fmt::Display for MacroTaskId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "MACRO-{}", self.short_uuid)
    }
}
