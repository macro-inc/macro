//! State changes that meet a busy or throttling provider.

use email_e2e::{Mail, Provider, Report, Stack, gmail_emulator};
use serde_json::json;

/// A thread can be marked done and brought back while a reply sent in it
/// is still on its way out.
///
/// When it fails: marking a thread done right after replying answers a
/// server error, and works only once the send has settled.
async fn a_thread_can_be_archived_while_a_reply_is_sending(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Quick question",
        "Can you confirm?",
    ))?;
    let preview = inbox.wait_for_preview("inbox", "Quick question").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();
    let thread = inbox.thread(&thread_id).await?;
    let received = &thread["messages"][0];

    inbox
        .send(&json!({
            "subject": "Re: Quick question",
            "to": [{ "email": "grace@example.com" }],
            "body_text": "Confirmed.",
            "thread_db_id": thread_id,
            "provider_thread_id": received["provider_thread_id"],
            "replying_to_id": received["db_id"],
        }))
        .await?;

    // Done, back, done again, for as long as the reply takes to leave.
    let mut archived = false;
    email_e2e::eventually(
        "the reply to reach the provider",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            archived = !archived;
            let response = inbox
                .patch(
                    &format!("/email/threads/{thread_id}/archived"),
                    Some(&json!({ "value": archived })),
                )
                .await?;
            assert_eq!(response.status, 200, "{}", response.text);
            let sent = inbox
                .provider_messages()?
                .iter()
                .any(|message| message.subject == "Re: Quick question");
            Ok(sent.then_some(()))
        },
    )
    .await?;
    let response = inbox
        .patch(
            &format!("/email/threads/{thread_id}/archived"),
            Some(&json!({ "value": true })),
        )
        .await?;
    assert_eq!(response.status, 200, "{}", response.text);
    inbox
        .wait_for_thread(&thread_id, "the thread to be done", |thread| {
            thread["inbox_visible"] == false
        })
        .await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_thread_can_be_archived_while_a_reply_is_sending() -> Result<(), Report> {
    a_thread_can_be_archived_while_a_reply_is_sending(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_thread_can_be_archived_while_a_reply_is_sending() -> Result<(), Report> {
    a_thread_can_be_archived_while_a_reply_is_sending(Provider::Outlook).await
}

/// How long Gmail asks to be left alone in this scenario.
const RETRY_AFTER_SECONDS: i64 = 20;

/// After Gmail refuses a change for its rate limit, no other change is
/// sent to that mailbox until the time Gmail asked for has passed; then
/// both land.
///
/// When it fails: a throttled mailbox is hit again within the same second,
/// which keeps it throttled and makes a bulk action take many minutes.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_throttled_mailbox_is_left_alone_as_long_as_gmail_asks() -> Result<(), Report> {
    use gmail_emulator::{Fault, FaultError, Route};

    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;
    let first = inbox.deliver(&Mail::new("Grace <grace@example.com>", "First", "Hello."))?;
    let second = inbox.deliver(&Mail::new("Alan <alan@example.com>", "Second", "Hello."))?;
    let first_thread = inbox.wait_for_preview("inbox", "First").await?;
    let second_thread = inbox.wait_for_preview("inbox", "Second").await?;
    let mark_read = async |preview: &serde_json::Value| -> Result<(), Report> {
        let thread_id = preview["id"].as_str().unwrap_or_default();
        inbox
            .patch(
                &format!("/email/threads/{thread_id}/state"),
                Some(&json!({ "field": "read", "value": true })),
            )
            .await?
            .ok()?;
        Ok(())
    };
    let writes = [Route::MessagesModify, Route::MessagesBatchModify];
    let attempts = || -> Vec<gmail_emulator::RequestRecord> {
        stack
            .gmail()
            .requests()
            .into_iter()
            .filter(|request| request.route.is_some_and(|route| writes.contains(&route)))
            .collect()
    };

    for route in writes {
        stack.gmail().inject_fault(Fault {
            mailbox: Some(inbox.email().to_owned()),
            route: Some(route),
            error: Some(FaultError::RateLimit),
            retry_after_seconds: Some(RETRY_AFTER_SECONDS.unsigned_abs()),
            times: Some(1),
            ..Default::default()
        });
    }
    stack.gmail().clear_requests();
    mark_read(&first_thread).await?;
    let refused = email_e2e::eventually(
        "Gmail to refuse the first change",
        email_e2e::DEFAULT_TIMEOUT,
        async || Ok(attempts().into_iter().find(|request| request.status == 429)),
    )
    .await?;
    mark_read(&second_thread).await?;

    for delivered in [&first, &second] {
        inbox
            .wait_for_provider_message("both messages to be read at Gmail", |message| {
                message.id == delivered.id && message.read
            })
            .await?;
    }
    let too_early: Vec<_> = attempts()
        .into_iter()
        .filter(|request| {
            request.at > refused.at && (request.at - refused.at).num_seconds() < RETRY_AFTER_SECONDS
        })
        .collect();
    assert!(
        too_early.is_empty(),
        "changes were sent while Gmail asked to be left alone: {too_early:?}"
    );

    stack.finish().await
}
