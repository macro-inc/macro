//! Background jobs: a code execution that outlives the turn that started it.
//!
//! The job's record lives beside the session, like a review's. Its log keeps
//! one `_macro/job_updated` frame per state change (started, settled) so
//! viewers of the session know which jobs run without polling, and its end
//! reaches the agent as a `job.settled` notification.

use agent_client_protocol::{JsonRpcMessage as _, JsonRpcNotification, RawJsonRpcMessage};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::schema::v0::{AcpMessage, ToServerMessage};

#[cfg(test)]
mod test;

/// Where a background job is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, strum::IntoStaticStr)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum JobStatus {
    /// Waiting for a slot or running.
    Running,
    /// The program returned its result.
    Done,
    /// The program failed.
    Failed,
    /// Someone cancelled it.
    Cancelled,
    /// It reached its time limit.
    TimedOut,
    /// Its process stopped with the replica that ran it, so its outcome is
    /// unconfirmed.
    Interrupted,
}

impl JobStatus {
    /// Whether the job has ended.
    #[must_use]
    pub fn settled(self) -> bool {
        self != Self::Running
    }
}

/// A background job's state changed: started or settled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonRpcNotification, Type)]
#[notification(method = "_macro/job_updated")]
#[serde(rename_all = "camelCase")]
pub struct JobUpdatedNotification {
    /// The job, which is its code execution's id.
    #[specta(type = String)]
    pub job_id: Uuid,
    /// The title the agent gave it.
    pub title: String,
    /// Its new state.
    pub status: JobStatus,
}

impl JobUpdatedNotification {
    /// The frame to log.
    ///
    /// # Panics
    ///
    /// Never: the notification is plain data and always serializes.
    #[must_use]
    pub fn to_server_message(&self) -> ToServerMessage {
        let params = serde_json::to_value(self).expect("a job update serializes");
        let frame = RawJsonRpcMessage::notification(self.method().to_owned(), params)
            .expect("an object is valid notification params");
        ToServerMessage::Acp(AcpMessage(frame))
    }
}

/// How a background job ended, for the agent's next turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct JobSettlement {
    /// The job, which is its code execution's id.
    #[specta(type = String)]
    pub job_id: Uuid,
    /// The title the agent gave it.
    pub title: String,
    /// How it ended; never `running`.
    pub status: JobStatus,
    /// What `main` returned, when it succeeded and fits; otherwise absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<specta_typescript::Unknown>)]
    pub result: Option<serde_json::Value>,
    /// Why it did not succeed, or why the result is absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The program never started (the server stopped, or the job ran out of
    /// time, before it got a slot): nothing it would have done took effect.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub never_ran: bool,
}

/// A job the agent started, listed in its next prompts so it can say what
/// still runs and what ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundJobSummary {
    /// The job, which is its code execution's id.
    pub job_id: Uuid,
    /// The title the agent gave it.
    pub title: String,
    /// Where it is.
    pub status: JobStatus,
    /// When it started, RFC 3339.
    pub started_at: String,
}

/// The `<background_jobs>` element an invocation context carries.
#[must_use]
pub fn jobs_context(jobs: &[BackgroundJobSummary]) -> String {
    let mut xml = String::from("<background_jobs>");
    for job in jobs {
        let status: &'static str = job.status.into();
        xml.push_str(&format!(
            "<job id=\"{}\" status=\"{status}\" started=\"{}\">{}</job>",
            job.job_id,
            escape(&job.started_at),
            escape(&job.title),
        ));
    }
    xml.push_str("</background_jobs>");
    xml
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
