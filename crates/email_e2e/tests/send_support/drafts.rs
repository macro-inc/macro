//! What the draft scenarios share: saving and discarding a draft as the
//! composer does, and waiting for the Drafts view and the mailbox to follow.

use crate::support::{message_in_thread, wait_for_provider_draft};
use email_e2e::{ApiResponse, DEFAULT_TIMEOUT, Inbox, Provider, Report, eventually};
use rootcause::prelude::*;
use serde_json::{Value, json};

/// The state of a draft whose content the mailbox holds.
pub const SYNCHRONIZED: &str = "SYNCHRONIZED";
/// The state of a draft the provider refused for good.
pub const FAILED: &str = "FAILED";

/// The id of a saved draft or a message.
pub fn id_of(message: &Value) -> String {
    message["db_id"].as_str().unwrap_or_default().to_owned()
}

/// The generation a client must name on its next write to a draft.
pub fn generation_of(message: &Value) -> i64 {
    message["draft_generation"].as_i64().unwrap_or_default()
}

/// `POST /email/drafts`, answered or refused.
pub async fn try_save(inbox: &Inbox, draft: &Value) -> Result<ApiResponse, Report> {
    inbox
        .post("/email/drafts", Some(&json!({ "draft": draft })))
        .await
}

/// `DELETE /email/drafts/{id}` naming a generation, answered or refused.
pub async fn try_discard(inbox: &Inbox, id: &str, generation: i64) -> Result<ApiResponse, Report> {
    inbox
        .delete(
            &format!("/email/drafts/{id}?draft_generation={generation}"),
            None,
        )
        .await
}

/// Whether the API refused a request as the client's mistake.
pub fn refused(response: &ApiResponse) -> bool {
    (400..500).contains(&response.status)
}

/// The threads named `subject` in the inbox's Drafts view.
pub async fn draft_previews(inbox: &Inbox, subject: &str) -> Result<Vec<Value>, Report> {
    Ok(inbox
        .previews("drafts")
        .await?
        .into_iter()
        .filter(|preview| preview["name"] == subject)
        .collect())
}

/// Waits until the Drafts view lists no thread named `subject`.
pub async fn wait_for_no_draft_preview(inbox: &Inbox, subject: &str) -> Result<(), Report> {
    eventually(
        &format!("the Drafts view to stop listing {subject:?}"),
        DEFAULT_TIMEOUT,
        async || {
            Ok(draft_previews(inbox, subject)
                .await?
                .is_empty()
                .then_some(()))
        },
    )
    .await
}

/// The state of a draft's mailbox operation, or `None` when it has none
/// (every Gmail draft).
pub async fn operation_state(inbox: &Inbox, id: &str) -> Result<Option<String>, Report> {
    let read = inbox
        .get(&format!("/email/drafts/{id}/operation"))
        .await?
        .ok()?;
    Ok(read["operation"]["state"].as_str().map(str::to_owned))
}

/// Waits until the mailbox holds the draft as Macro has it. A Gmail draft is
/// not written to the mailbox, so there is nothing to wait for.
pub async fn wait_until_in_mailbox(inbox: &Inbox, id: &str, subject: &str) -> Result<(), Report> {
    if inbox.provider() == Provider::Gmail {
        return Ok(());
    }
    wait_for_provider_draft(inbox, subject).await?;
    eventually(
        &format!("the draft {subject:?} to be synchronized with the mailbox"),
        DEFAULT_TIMEOUT,
        async || {
            let state = operation_state(inbox, id).await?;
            if state.as_deref() == Some(FAILED) {
                bail!("the mailbox refused the draft {subject:?}");
            }
            Ok((state.as_deref() == Some(SYNCHRONIZED)).then_some(()))
        },
    )
    .await
}

/// The draft as the thread view shows it, which is what a composer opens.
pub async fn reopened(inbox: &Inbox, draft: &Value) -> Result<Value, Report> {
    let thread = draft["thread_db_id"].as_str().unwrap_or_default();
    message_in_thread(inbox, thread, &id_of(draft)).await
}
