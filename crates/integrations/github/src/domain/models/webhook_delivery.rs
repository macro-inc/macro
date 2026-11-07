//! A verified delivery from Macro's GitHub App, as other domains receive it.
//!
//! Every delivery the App verifies is published, whatever its event, so a
//! subscriber can act on events this crate never handles itself. A delivery is
//! untrusted content from GitHub and grants nothing.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Largest payload carried, in bytes of JSON once API links are removed. A
/// larger delivery travels without its payload, never truncated into
/// something that reads as a different event.
pub const MAX_WEBHOOK_PAYLOAD_BYTES: usize = 64 * 1024;

/// One delivery from Macro's GitHub App.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GithubWebhookReceived {
    /// GitHub's `X-GitHub-Delivery` id. A redelivery from GitHub's settings
    /// repeats it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_id: Option<String>,
    /// The `X-GitHub-Event` header, such as `workflow_run`.
    pub event: String,
    /// The payload's `action`, such as `completed`; absent for events like `push`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// The App installation the delivery came through.
    pub installation_id: u64,
    /// The repository it is about, when it is about one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<GithubWebhookRepository>,
    /// Who caused it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender: Option<GithubWebhookSender>,
    /// The body without API links, node ids and the installation. Absent when
    /// it is still larger than [`MAX_WEBHOOK_PAYLOAD_BYTES`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

/// A repository named in a delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GithubWebhookRepository {
    /// GitHub's numeric id, which survives renames and transfers.
    pub id: u64,
    /// `owner/name` at the time of the delivery.
    pub full_name: String,
}

/// The account that caused a delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GithubWebhookSender {
    /// GitHub login, such as `octocat` or `dependabot[bot]`.
    pub login: String,
    /// Whether GitHub calls the account a bot, including apps acting for themselves.
    pub bot: bool,
}

#[derive(Deserialize)]
struct DeliveryFields {
    action: Option<String>,
    installation: Option<IdField>,
    repository: Option<RepositoryFields>,
    sender: Option<SenderFields>,
}

#[derive(Deserialize)]
struct IdField {
    id: u64,
}

#[derive(Deserialize)]
struct RepositoryFields {
    id: u64,
    full_name: String,
}

#[derive(Deserialize)]
struct SenderFields {
    login: String,
    #[serde(rename = "type")]
    kind: String,
}

impl GithubWebhookReceived {
    /// Read a verified delivery. None when it came through no installation,
    /// as App-level events such as `github_app_authorization` do: nobody in
    /// Macro can be shown those.
    pub fn from_delivery(delivery_id: Option<String>, event: String, body: &Value) -> Option<Self> {
        let fields = DeliveryFields::deserialize(body).ok()?;
        let installation_id = fields.installation?.id;
        Some(Self {
            delivery_id,
            event,
            action: fields.action,
            installation_id,
            repository: fields.repository.map(|repository| GithubWebhookRepository {
                id: repository.id,
                full_name: repository.full_name,
            }),
            sender: fields.sender.map(|sender| GithubWebhookSender {
                bot: sender.kind == "Bot",
                login: sender.login,
            }),
            payload: compact_payload(body),
        })
    }
}

/// GitHub repeats an API link for nearly every object it sends, which is
/// most of a payload's size and none of its meaning. Web links (`html_url`)
/// stay: they are what a reader follows.
fn compact_payload(body: &Value) -> Option<Value> {
    let mut payload = body.clone();
    if let Value::Object(fields) = &mut payload {
        fields.remove("installation");
    }
    strip_links(&mut payload);
    let size = serde_json::to_vec(&payload).ok()?.len();
    (size <= MAX_WEBHOOK_PAYLOAD_BYTES).then_some(payload)
}

fn strip_links(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            fields.retain(|key, _| {
                key == "html_url"
                    || !(key == "url"
                        || key.ends_with("_url")
                        || key == "node_id"
                        || key == "gravatar_id")
            });
            fields.values_mut().for_each(strip_links);
        }
        Value::Array(items) => items.iter_mut().for_each(strip_links),
        _ => {}
    }
}
