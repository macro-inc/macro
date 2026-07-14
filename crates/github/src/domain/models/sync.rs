//! Domain models for github sync operations (webhooks and sync app).

use std::collections::HashSet;
use std::fmt;
use std::sync::LazyLock;

use regex::Regex;
use serde::Deserialize;

/// Github key used for tracking tasks
#[derive(Debug, Clone)]
pub struct GithubKey(String);

impl GithubKey {
    /// Create a new github key
    pub fn new(org: &str, repo: &str, pr: u64) -> Self {
        Self(format!("{org}/{repo}/pull/{pr}"))
    }
}

impl fmt::Display for GithubKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl AsRef<str> for GithubKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// GitHub App installation access token response
#[derive(Debug, Clone, Deserialize)]
pub struct GithubInstallationAccessToken {
    /// The installation access token
    pub token: String,
    /// When the token expires
    pub expires_at: String,
}

/// Source that grants a GitHub App installation access to Macro sync data.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum GithubAppInstallationSource {
    /// A Macro team source.
    Team(uuid::Uuid),
    /// A Macro user source.
    User(String),
}

impl GithubAppInstallationSource {
    /// Returns the value persisted in `github_app_installation.source_id`.
    pub fn source_id(&self) -> String {
        match self {
            Self::Team(team_id) => team_id.to_string(),
            Self::User(user_id) => user_id.clone(),
        }
    }

    /// Returns the value persisted in `github_app_installation.source_type`.
    pub fn source_type(&self) -> &'static str {
        match self {
            Self::Team(_) => "team",
            Self::User(_) => "user",
        }
    }
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
            GithubWebhookEventType::CheckRun
            | GithubWebhookEventType::Installation
            | GithubWebhookEventType::Unknown(_) => {}
        }
        texts
    }

    /// Extract the `action` field from the webhook payload (e.g. "opened", "closed", "created").
    pub fn action(&self) -> Option<&str> {
        self.payload.get("action").and_then(|v| v.as_str())
    }

    /// Whether the pull request was merged (only meaningful for `closed` actions).
    pub fn is_merged(&self) -> bool {
        self.payload
            .get("pull_request")
            .and_then(|pr| pr.get("merged"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    }

    /// Derive the task status string based on the event, if applicable.
    ///
    /// For `pull_request` events: `opened`/`reopened` → `"In Review"`,
    /// `closed` + merged → `"Completed"`, `closed` without merge →
    /// `"Not Started"` (the TODO status).
    ///
    /// For comment/review events that newly associate a task with an open PR,
    /// returns `"In Review"`.
    ///
    /// Returns `None` when no status change is warranted.
    pub fn task_status_for_event(&self) -> Option<&'static str> {
        match self.parsed_event_type() {
            GithubWebhookEventType::PullRequest => match self.action() {
                Some("opened" | "reopened" | "edited") => Some("In Review"),
                Some("closed") if self.is_merged() => Some("Completed"),
                Some("closed") => Some("Not Started"),
                _ => None,
            },
            GithubWebhookEventType::IssueComment
            | GithubWebhookEventType::PullRequestReview
            | GithubWebhookEventType::PullRequestReviewComment => {
                // A comment/review that introduces a new task association on an
                // open PR should mark the task as "In Review".
                let is_open = self
                    .payload
                    .get("pull_request")
                    .or_else(|| self.payload.get("issue"))
                    .and_then(|pr| pr.get("state"))
                    .and_then(|v| v.as_str())
                    == Some("open");

                if is_open { Some("In Review") } else { None }
            }
            GithubWebhookEventType::CheckRun
            | GithubWebhookEventType::Installation
            | GithubWebhookEventType::Unknown(_) => None,
        }
    }

    /// Extract the pull request / issue number from the webhook payload.
    pub fn pull_number(&self) -> Option<u64> {
        self.payload
            .get("pull_request")
            .and_then(|pr| pr.get("number"))
            .or_else(|| {
                self.payload
                    .get("issue")
                    .and_then(|issue| issue.get("number"))
            })
            .or_else(|| {
                self.payload
                    .get("check_run")
                    .and_then(|check_run| check_run.get("pull_requests"))
                    .and_then(|pull_requests| pull_requests.as_array())
                    .and_then(|pull_requests| pull_requests.first())
                    .and_then(|pull_request| pull_request.get("number"))
            })
            .and_then(|v| v.as_u64())
    }

    /// Returns whether this webhook payload is associated with a pull request.
    pub fn is_associated_with_pull_request(&self) -> bool {
        match self.parsed_event_type() {
            GithubWebhookEventType::PullRequest => self.payload.get("pull_request").is_some(),
            GithubWebhookEventType::IssueComment => self
                .payload
                .get("issue")
                .and_then(|issue| issue.get("pull_request"))
                .is_some(),
            GithubWebhookEventType::PullRequestReview
            | GithubWebhookEventType::PullRequestReviewComment => {
                self.payload.get("pull_request").is_some()
            }
            GithubWebhookEventType::CheckRun => self.pull_number().is_some(),
            GithubWebhookEventType::Installation | GithubWebhookEventType::Unknown(_) => false,
        }
    }

    /// Extract the repository owner login from the webhook payload.
    pub fn repo_owner(&self) -> Option<&str> {
        self.payload
            .get("repository")
            .and_then(|r| r.get("owner"))
            .and_then(|o| o.get("login"))
            .and_then(|v| v.as_str())
    }

    /// Extract the repository name from the webhook payload.
    pub fn repo_name(&self) -> Option<&str> {
        self.payload
            .get("repository")
            .and_then(|r| r.get("name"))
            .and_then(|v| v.as_str())
    }

    /// Extract the GitHub App installation ID from the webhook payload.
    pub fn installation_id(&self) -> Option<u64> {
        self.payload
            .get("installation")
            .and_then(|i| i.get("id"))
            .and_then(|v| v.as_u64())
    }

    /// Extract the sender's GitHub user ID from the webhook payload.
    ///
    /// Uses the numeric `sender.id` rather than `sender.login` because
    /// GitHub usernames can change but user IDs are stable.
    pub fn sender_github_user_id(&self) -> Option<String> {
        self.payload
            .get("sender")
            .and_then(|s| s.get("id"))
            .and_then(|v| v.as_u64())
            .map(|id| id.to_string())
    }

    /// Extract text from the PR context (title, body, branch) regardless of
    /// event type. For comment/review events this returns the surrounding PR
    /// info so callers can determine which task IDs are already associated
    /// with the PR itself. Returns empty for `PullRequest` events (since the
    /// event *is* the PR context) and unknown events.
    pub fn extract_pr_context_text(&self) -> Vec<String> {
        let mut texts = Vec::new();

        let pr = match self.parsed_event_type() {
            // For PR events, the event itself is the context — nothing to compare against.
            GithubWebhookEventType::PullRequest
            | GithubWebhookEventType::CheckRun
            | GithubWebhookEventType::Installation
            | GithubWebhookEventType::Unknown(_) => {
                return texts;
            }
            // issue_comment payloads embed the issue (which contains PR title/body).
            GithubWebhookEventType::IssueComment => self.payload.get("issue"),
            // review / review_comment payloads embed the full pull_request object.
            GithubWebhookEventType::PullRequestReview
            | GithubWebhookEventType::PullRequestReviewComment => self.payload.get("pull_request"),
        };

        if let Some(pr) = pr {
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
    /// `check_run` events
    CheckRun,
    /// `installation` events (app installed/uninstalled)
    Installation,
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
            "check_run" => Self::CheckRun,
            "installation" => Self::Installation,
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

/// Regex matching `{team_slug}-{team_task_id}` references.
///
/// The slug follows the team slug format used in generated branch names
/// (letters/numbers/underscores, matched case-insensitively). The numeric
/// portion is the per-team task number.
static TEAM_TASK_REFERENCE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:^|[^a-z0-9_])([a-z][a-z0-9_]{0,19})-([1-9][0-9]*)(?:$|[^a-z0-9_])")
        .expect("valid regex")
});

/// Regex matching GitHub `@login` mentions in markdown-ish text.
///
/// The leading guard requires the `@` to start the text or follow a
/// non-login character, which also rejects email addresses (`a@b.com`).
/// The login follows GitHub's username grammar: 1-39 alphanumerics or
/// non-leading/non-trailing hyphens. Code spans are not treated specially.
static GITHUB_MENTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:^|[^a-z0-9-])@([a-z0-9](?:-?[a-z0-9]){0,38})").expect("valid regex")
});

/// Extract unique GitHub `@login` mentions from text, normalized to lowercase.
///
/// Results are sorted for determinism.
pub fn extract_github_mentions(text: &str) -> Vec<String> {
    let logins: std::collections::BTreeSet<String> = GITHUB_MENTION_RE
        .captures_iter(text)
        .map(|caps| caps[1].to_lowercase())
        .collect();

    logins.into_iter().collect()
}

/// A team-scoped task reference in the form `{team_slug}-{team_task_id}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TeamTaskReference {
    /// Team slug as it appears in the reference, normalized to lowercase.
    pub team_slug: String,
    /// Positive per-team task number.
    pub team_task_id: i32,
}

impl TeamTaskReference {
    /// Create a normalized team task reference.
    pub fn new(team_slug: &str, team_task_id: i32) -> Option<Self> {
        let team_slug = team_slug.trim().to_ascii_lowercase();
        if team_slug.is_empty() || team_task_id <= 0 {
            return None;
        }

        Some(Self {
            team_slug,
            team_task_id,
        })
    }

    /// Extract all unique `{team_slug}-{team_task_id}` references from text.
    pub fn extract_from_text(text: &str) -> Vec<Self> {
        let mut seen = HashSet::new();
        let mut results = Vec::new();

        for caps in TEAM_TASK_REFERENCE_RE.captures_iter(text) {
            let Some(task_num) = caps[2].parse::<i32>().ok() else {
                continue;
            };

            let Some(reference) = Self::new(&caps[1], task_num) else {
                continue;
            };

            if seen.insert((reference.team_slug.clone(), reference.team_task_id)) {
                results.push(reference);
            }
        }

        results
    }
}

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
