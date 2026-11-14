//! Drafts.

use email_e2e::{DEFAULT_TIMEOUT, Provider, Report, Stack, eventually};
use serde_json::json;

/// A draft is saved, shows under Drafts, keeps an edit, and is gone once
/// discarded, without ever reaching its recipient.
async fn draft_is_saved_edited_and_discarded(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let recipient = grace.link(provider, grace.email()).await?;

    let draft = inbox
        .save_draft(&json!({
            "subject": "Trip notes",
            "to": [{ "email": grace.email() }],
            "body_text": "First thoughts.",
        }))
        .await?;
    let draft_id = draft["db_id"].as_str().unwrap_or_default().to_owned();
    let preview = inbox.wait_for_preview("drafts", "Trip notes").await?;
    assert_eq!(preview["isDraft"], true);

    let edited = inbox
        .save_draft(&json!({
            "db_id": draft_id,
            "draft_generation": draft["draft_generation"],
            "subject": "Trip notes",
            "to": [{ "email": grace.email() }],
            "body_text": "Second thoughts.",
        }))
        .await?;
    assert_eq!(edited["db_id"], draft_id.as_str());
    let thread = inbox
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            "the draft to hold its edit",
            |thread| thread["messages"][0]["body_text"] == "Second thoughts.",
        )
        .await?;
    assert_eq!(thread["messages"].as_array().map(Vec::len), Some(1));

    let generation = edited["draft_generation"].as_i64().unwrap_or_default();
    inbox
        .delete(
            &format!("/email/drafts/{draft_id}?draft_generation={generation}"),
            None,
        )
        .await?
        .ok()?;
    eventually("the draft to leave Drafts", DEFAULT_TIMEOUT, async || {
        let drafts = inbox.previews("drafts").await?;
        Ok(drafts.is_empty().then_some(()))
    })
    .await?;
    // A send that started anyway would arrive before this later one does.
    inbox
        .send(&json!({
            "subject": "After the discard",
            "to": [{ "email": grace.email() }],
            "body_text": "Only this one.",
        }))
        .await?;
    recipient
        .wait_for_preview("inbox", "After the discard")
        .await?;
    assert_eq!(recipient.previews("inbox").await?.len(), 1);
    assert!(
        recipient
            .provider_messages()?
            .iter()
            .all(|message| message.subject != "Trip notes")
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_draft_is_saved_edited_and_discarded() -> Result<(), Report> {
    draft_is_saved_edited_and_discarded(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_draft_is_saved_edited_and_discarded() -> Result<(), Report> {
    draft_is_saved_edited_and_discarded(Provider::Outlook).await
}
