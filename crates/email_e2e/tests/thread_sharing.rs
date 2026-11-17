//! One thread shared with someone who has no access to its inbox: opening
//! it, and replying on it from an inbox of one's own.

#![expect(
    clippy::disallowed_methods,
    reason = "a scenario seeds the channel a thread is shared in, which a service not started here would create"
)]

use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, ProviderMessage, Report, Stack, StackOptions, User,
    eventually,
};
use reqwest::Method;
use serde_json::{Value, json};
use uuid::Uuid;

/// A stack that also serves the routes sharing goes through.
async fn stack_with_sharing() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await
}

/// Shares the thread at `access` (`view` or `edit`) in a new channel of
/// `owner`'s that `member` is in, as sending the thread to someone does:
/// the owner changes the thread's share permissions. The channel's rows are
/// written here, because the service that keeps channels is not started.
async fn share_thread(
    stack: &Stack,
    owner: &User,
    member: &User,
    thread_id: &str,
    access: &str,
) -> Result<(), Report> {
    let channel = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO comms_channels (id, channel_type, owner_id) \
         VALUES ($1, 'private'::comms_channel_type, $2)",
    )
    .bind(channel)
    .bind(owner.macro_id())
    .execute(stack.db())
    .await?;
    for (user, role) in [(owner, "owner"), (member, "member")] {
        sqlx::query(
            "INSERT INTO comms_channel_participants (channel_id, user_id, role) \
             VALUES ($1, $2, $3::comms_participant_role)",
        )
        .bind(channel)
        .bind(user.macro_id())
        .bind(role)
        .execute(stack.db())
        .await?;
    }

    owner
        .document_storage_request(
            Method::PATCH,
            &format!("/threads/{thread_id}"),
            Some(&json!({
                "sharePermission": {
                    "channelSharePermissions": [{
                        "operation": "add",
                        "channelId": channel,
                        "accessLevel": access,
                    }],
                },
            })),
        )
        .await?
        .ok()?;
    Ok(())
}

/// Whether the API refused to show the user a thread.
fn refused(status: u16) -> bool {
    matches!(status, 401 | 403 | 404)
}

/// Waits until the user can open the thread and returns it. What a user
/// may see is remembered for a few seconds, so a share shows by a moment.
async fn wait_until_opened(user: &User, thread_id: &str) -> Result<Value, Report> {
    eventually(
        &format!("{} to open the shared thread", user.email()),
        DEFAULT_TIMEOUT,
        async || {
            let opened = user
                .get(&format!("/email/threads/{thread_id}?limit=100"))
                .await?;
            if refused(opened.status) {
                return Ok(None);
            }
            Ok(Some(opened.ok()?["thread"].clone()))
        },
    )
    .await
}

/// Someone a thread was shared with opens it, with its messages, at the
/// access they were given, although the inbox is not theirs; someone it was
/// not shared with cannot.
///
/// When it fails: a thread sent to a teammate shows them "not found", or
/// sharing one thread opens it to everybody.
async fn a_thread_shared_by_someone_else_opens(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_sharing().await?;
    let grace = stack.user("grace").await?;
    let ada = stack.user("ada").await?;
    let mallory = stack.user("mallory").await?;
    let inbox = grace.link(provider, grace.email()).await?;
    let ada_inbox = ada.link(provider, ada.email()).await?;
    mallory.link(provider, mallory.email()).await?;
    inbox.deliver(&Mail::new(
        "Carol <carol@example.net>",
        "Contract",
        "The signed copy is attached.",
    ))?;
    let preview = inbox.wait_for_preview("inbox", "Contract").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default();
    let path = format!("/email/threads/{thread_id}?limit=100");

    let before = ada.get(&path).await?;
    assert!(refused(before.status), "{} {}", before.status, before.text);

    share_thread(&stack, &grace, &ada, thread_id, "view").await?;

    let shared = wait_until_opened(&ada, thread_id).await?;
    assert_eq!(shared["db_id"], thread_id);
    assert_eq!(shared["access_level"], "view", "{shared}");
    let messages = shared["messages"].as_array().cloned().unwrap_or_default();
    assert_eq!(messages.len(), 1, "{shared}");
    assert_eq!(
        messages[0]["body_text"].as_str().map(str::trim),
        Some("The signed copy is attached.")
    );
    assert_eq!(messages[0]["subject"], "Contract");

    let owned = inbox.get(&path).await?.ok()?;
    assert_eq!(owned["thread"]["access_level"], "owner", "{owned}");
    // Sharing copies nothing: the mail is in its owner's mailbox only.
    assert_eq!(copies(&inbox, "Contract")?.len(), 1);
    assert_eq!(copies(&ada_inbox, "Contract")?.len(), 0);
    let outsider = mallory.get(&path).await?;
    assert!(
        refused(outsider.status),
        "{} {}",
        outsider.status,
        outsider.text
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_thread_shared_by_someone_else_opens() -> Result<(), Report> {
    a_thread_shared_by_someone_else_opens(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_thread_shared_by_someone_else_opens() -> Result<(), Report> {
    a_thread_shared_by_someone_else_opens(Provider::Outlook).await
}

/// The mailbox's messages at the provider with this subject that are not
/// drafts.
fn copies(inbox: &Inbox, subject: &str) -> Result<Vec<ProviderMessage>, Report> {
    Ok(inbox
        .provider_messages()?
        .into_iter()
        .filter(|message| {
            message.subject == subject
                && !message
                    .labels
                    .iter()
                    .any(|label| label == "DRAFT" || label.eq_ignore_ascii_case("drafts"))
        })
        .collect())
}

/// The composer's reply to the message `replying_to`, to `to`.
fn reply(replying_to: &Value, to: &str) -> Value {
    json!({
        "draftId": Uuid::now_v7(),
        "subject": "Re: Plans",
        "to": [{ "email": to }],
        "bodyText": "Count me in.",
        "replyingToId": replying_to,
    })
}

/// A reply to a message in a thread a teammate shared at edit access goes
/// out from the replier's own inbox, once, as an answer to that message:
/// it starts a thread there, and the teammate's mailbox sends nothing.
/// Someone the thread is not shared with cannot reply to it.
///
/// When it fails: replying on a shared thread answers "message not found",
/// the reply leaves from the wrong mailbox, or anyone who learns a
/// message's id can answer it.
async fn a_reply_on_a_shared_thread_leaves_from_the_repliers_inbox(
    provider: Provider,
) -> Result<(), Report> {
    let stack = stack_with_sharing().await?;
    let grace = stack.user("grace").await?;
    let ada = stack.user("ada").await?;
    let carol = stack.user("carol").await?;
    let mallory = stack.user("mallory").await?;
    let grace_inbox = grace.link(provider, grace.email()).await?;
    let ada_inbox = ada.link(provider, ada.email()).await?;
    let carol_inbox = carol.link(provider, carol.email()).await?;
    let mallory_inbox = mallory.link(provider, mallory.email()).await?;

    carol_inbox
        .send(&json!({
            "subject": "Plans",
            "to": [{ "email": grace.email() }],
            "body_text": "Shall we meet?",
        }))
        .await?;
    let asked = carol_inbox.wait_for_preview("sent", "Plans").await?;
    let arrived = grace_inbox.wait_for_preview("inbox", "Plans").await?;
    let thread_id = arrived["id"].as_str().unwrap_or_default();
    let question = grace_inbox.thread(thread_id).await?["messages"][0]["db_id"].clone();
    assert!(question.is_string(), "the thread has no first message");

    share_thread(&stack, &grace, &ada, thread_id, "edit").await?;
    wait_until_opened(&ada, thread_id).await?;

    let refused = mallory_inbox
        .send_attempt(Uuid::now_v7(), &reply(&question, carol.email()), &json!({}))
        .await;
    assert!(
        refused.is_err(),
        "someone without the share replied: {refused:?}"
    );

    let attempt_id = Uuid::now_v7();
    let accepted = ada_inbox
        .send_attempt(attempt_id, &reply(&question, carol.email()), &json!({}))
        .await?;
    assert_eq!(accepted["status"], "ACCEPTED", "{accepted}");
    let sent = ada_inbox.wait_for_send_attempt(attempt_id, "SENT").await?;
    assert_eq!(sent["message"]["isSent"], true, "{sent}");
    assert_eq!(
        sent["message"]["linkId"],
        ada_inbox.link_id().to_string().as_str(),
        "{sent}"
    );
    assert_eq!(sent["message"]["replyingToId"], question, "{sent}");
    // The shared thread stays its owner's: the reply has a thread of its
    // own in the replier's inbox.
    let in_sent = ada_inbox.wait_for_preview("sent", "Re: Plans").await?;
    assert_eq!(in_sent["id"], sent["threadId"], "{sent}");
    assert_ne!(in_sent["id"], thread_id);

    // The asker gets it once, under the message it answers.
    let two_messages = |thread: &Value| {
        thread["messages"]
            .as_array()
            .is_some_and(|messages| messages.iter().filter(|m| m["is_draft"] != true).count() == 2)
    };
    let at_carol = carol_inbox
        .wait_for_thread(
            asked["id"].as_str().unwrap_or_default(),
            "the reply to join the thread it answers at the asker",
            two_messages,
        )
        .await?;
    assert!(
        at_carol["messages"]
            .as_array()
            .is_some_and(|messages| messages
                .iter()
                .any(|m| m["body_text"].as_str().map(str::trim) == Some("Count me in."))),
        "{at_carol}"
    );
    let question_at_carol = copies(&carol_inbox, "Plans")?;
    let answer_at_carol = copies(&carol_inbox, "Re: Plans")?;
    assert_eq!(answer_at_carol.len(), 1, "{answer_at_carol:?}");
    assert!(
        question_at_carol
            .iter()
            .any(|message| message.thread_id == answer_at_carol[0].thread_id),
        "the provider filed the reply apart from the message it answers: \
         {question_at_carol:?} {answer_at_carol:?}"
    );
    assert_eq!(
        answer_at_carol[0].from.as_deref().map(address),
        Some(ada.email())
    );

    // It left from the replier's mailbox and from nobody else's.
    assert_eq!(copies(&ada_inbox, "Re: Plans")?.len(), 1);
    assert_eq!(copies(&grace_inbox, "Re: Plans")?.len(), 0);
    assert_eq!(copies(&mallory_inbox, "Re: Plans")?.len(), 0);

    stack.finish().await
}

/// The address of a sender the provider reports as `Name <address>` or bare.
fn address(from: &str) -> &str {
    from.rsplit_once('<')
        .map_or(from, |(_, rest)| rest.trim_end_matches('>'))
        .trim()
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_reply_on_a_shared_thread_leaves_from_the_repliers_inbox() -> Result<(), Report> {
    a_reply_on_a_shared_thread_leaves_from_the_repliers_inbox(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_reply_on_a_shared_thread_leaves_from_the_repliers_inbox() -> Result<(), Report> {
    a_reply_on_a_shared_thread_leaves_from_the_repliers_inbox(Provider::Outlook).await
}
