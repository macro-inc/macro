//! A day in the web composer, end to end over the GraphQL API the web app
//! uses: open a thread, reply from a saved draft, send it, take back the
//! read and Done state, and throw away a second draft. Then a new message to
//! several people with a signature, through the same path.
//!
//! Every step is checked twice: as Macro answers it (GraphQL, as the app
//! reads it) and at the provider, where the user's other mail clients see it.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use email_e2e::{Inbox, Mail, Provider, ProviderMessage, Report, Stack, StackOptions};
use serde_json::{Value, json};
use uuid::Uuid;

/// What the app reads of a thread after each step.
const THREAD: &str = "query($threadId: ID!) { user { id emailThread(input: { threadId: $threadId }) { \
    id isRead inboxVisible \
    messages(offset: 0, limit: 50) { id threadId isRead isDraft isSent draftGeneration subject \
      bodyText bodyHtmlSanitized from { email } to { email } cc { email } bcc { email } } } } }";

/// The fields of a thread a mutation answers with.
const THREAD_FIELDS: &str = "id isRead inboxVisible \
    messages(offset: 0, limit: 50) { id isDraft isSent draftGeneration bodyText }";

/// The signature the composer froze at Send.
const SIGNATURE: &str = r#"<p style="margin:0">Ada Example, Operations</p>"#;

/// A stack that serves the GraphQL API.
async fn stack_with_graphql() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await
}

/// An HTML body the way the composer hands it over: base64, URL-safe,
/// unpadded.
fn html(body: &str) -> String {
    URL_SAFE_NO_PAD.encode(body)
}

/// The thread as the app reads it, or null once it is gone.
async fn thread(inbox: &Inbox, thread_id: &str) -> Result<Value, Report> {
    let data = inbox
        .user()
        .graphql(THREAD, &json!({ "threadId": thread_id }))
        .await?;
    Ok(data["user"]["emailThread"].clone())
}

/// The thread's messages, as the app reads them.
fn messages(thread: &Value) -> Vec<Value> {
    thread["messages"].as_array().cloned().unwrap_or_default()
}

/// A thread mutation that takes `{ threadId }` and answers the thread.
async fn thread_mutation(inbox: &Inbox, name: &str, input: &Value) -> Result<Value, Report> {
    let input_type = format!("{}Input", upper_first(name));
    let query = format!(
        "mutation($input: {input_type}!) {{ {name}(input: $input) {{ {THREAD_FIELDS} }} }}"
    );
    let data = inbox
        .user()
        .graphql(&query, &json!({ "input": input }))
        .await?;
    Ok(data[name].clone())
}

fn upper_first(name: &str) -> String {
    let mut chars = name.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// `saveEmailDraft` on this inbox; answers `{ draftId, draft, thread }`.
async fn save_draft(inbox: &Inbox, input: &Value) -> Result<Value, Report> {
    let mut input = input.clone();
    input["linkId"] = json!(inbox.link_id());
    let query = format!(
        "mutation($input: SaveEmailDraftInput!) {{ saveEmailDraft(input: $input) {{ \
         draftId draft {{ id isDraft draftGeneration bodyText }} thread {{ {THREAD_FIELDS} }} }} }}"
    );
    let data = inbox
        .user()
        .graphql(&query, &json!({ "input": input }))
        .await?;
    Ok(data["saveEmailDraft"].clone())
}

/// The message at the provider whose subject is `subject` and that is not a
/// draft, once there is one.
async fn delivered(inbox: &Inbox, subject: &str) -> Result<ProviderMessage, Report> {
    inbox
        .wait_for_provider_message(&format!("{subject:?} delivered"), |message| {
            message.subject == subject && !is_draft(message)
        })
        .await
}

/// Whether the provider holds the message as a draft.
fn is_draft(message: &ProviderMessage) -> bool {
    message
        .labels
        .iter()
        .any(|label| label == "DRAFT" || label.eq_ignore_ascii_case("drafts"))
}

/// The copies of `subject` the provider holds that are not drafts.
fn copies(inbox: &Inbox, subject: &str) -> Result<usize, Report> {
    Ok(inbox
        .provider_messages()?
        .iter()
        .filter(|message| message.subject == subject && !is_draft(message))
        .count())
}

/// Replying from the composer: the thread is marked seen, a reply is saved
/// as a draft and edited, Send delivers the edited reply once and leaves
/// the thread with the two messages and no draft; the thread is then marked
/// unread and Done, and a second draft is thrown away. Each change reaches
/// the provider.
///
/// When it fails, the web app's own path is broken: a draft does not keep
/// an edit, a reply goes out twice or not as written, read or Done does not
/// reach Gmail or Outlook, or a discarded draft stays behind.
async fn reply_from_the_composer_round_trip(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_graphql().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let correspondent = grace.link(provider, grace.email()).await?;

    let question = inbox.deliver(&Mail::new(
        &format!("Grace <{}>", grace.email()),
        "Venue for the offsite",
        "Which hall should we book?",
    ))?;
    let preview = inbox
        .wait_for_preview("inbox", "Venue for the offsite")
        .await?;
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();
    let opened = thread(&inbox, &thread_id).await?;
    assert_eq!(opened["isRead"], false, "{opened}");
    let received_id = messages(&opened)
        .first()
        .and_then(|message| message["id"].as_str().map(str::to_owned))
        .ok_or_else(|| rootcause::report!("the thread has no message: {opened}"))?;

    // Opening the thread marks it seen, in Macro and at the provider.
    let seen = thread_mutation(
        &inbox,
        "markEmailThreadSeen",
        &json!({ "threadId": thread_id }),
    )
    .await?;
    assert_eq!(seen["isRead"], true, "{seen}");
    inbox
        .wait_for_provider_message("the question to be read at the provider", |message| {
            message.id == question.id && message.read
        })
        .await?;

    // A reply is saved as a draft, then edited.
    let handle = Uuid::now_v7();
    let reply = |generation: i64, text: &str| {
        json!({
            "draftId": handle,
            "draftGeneration": generation,
            "replyingToId": received_id,
            "threadDbId": thread_id,
            "subject": "Re: Venue for the offsite",
            "to": [{ "email": grace.email() }],
            "bodyText": text,
            "bodyHtml": html(&format!("<html><body><div>{text}</div></body></html>")),
        })
    };
    let first = save_draft(&inbox, &reply(0, "The hall works.")).await?;
    let draft_id = first["draftId"].as_str().unwrap_or_default().to_owned();
    assert_eq!(first["draft"]["isDraft"], true, "{first}");
    assert_eq!(first["thread"]["id"], thread_id.as_str(), "{first}");
    let generation = first["draft"]["draftGeneration"]
        .as_i64()
        .unwrap_or_default();

    let edited_text = "The hall works. Booked for Friday.";
    let edited = save_draft(&inbox, &reply(generation, edited_text)).await?;
    assert_eq!(
        edited["draftId"],
        draft_id.as_str(),
        "the edit made another draft: {edited}"
    );
    let generation = edited["draft"]["draftGeneration"]
        .as_i64()
        .unwrap_or_default();
    let drafts: Vec<Value> = messages(&thread(&inbox, &thread_id).await?)
        .into_iter()
        .filter(|message| message["isDraft"] == true)
        .collect();
    assert_eq!(drafts.len(), 1, "one draft in the thread: {drafts:?}");
    assert_eq!(drafts[0]["bodyText"], edited_text, "{drafts:?}");
    if provider == Provider::Outlook {
        // Outlook keeps Macro's drafts in its Drafts folder.
        inbox
            .wait_for_provider_message("the reply draft in Outlook", |message| {
                message.subject == "Re: Venue for the offsite" && is_draft(message)
            })
            .await?;
    }

    // Send delivers the edited reply, once, in the same conversation.
    let attempt_id = Uuid::now_v7();
    let accepted = inbox
        .send_attempt(attempt_id, &reply(generation, edited_text), &json!({}))
        .await?;
    assert_eq!(accepted["status"], "ACCEPTED", "{accepted}");
    let sent = inbox.wait_for_send_attempt(attempt_id, "SENT").await?;
    assert_eq!(sent["message"]["threadId"], thread_id.as_str(), "{sent}");
    let arrived = correspondent
        .wait_for_preview("inbox", "Re: Venue for the offsite")
        .await?;
    let arrived = correspondent
        .thread(arrived["id"].as_str().unwrap_or_default())
        .await?;
    assert!(
        arrived["messages"][0]["body_text"]
            .as_str()
            .is_some_and(|text| text.contains("Booked for Friday")),
        "the recipient got another text: {arrived}"
    );
    let own_copy = delivered(&inbox, "Re: Venue for the offsite").await?;
    assert_eq!(
        own_copy.thread_id, question.thread_id,
        "the reply left its conversation"
    );

    let after_send = thread(&inbox, &thread_id).await?;
    let after_send = messages(&after_send);
    assert_eq!(
        after_send.len(),
        2,
        "the question and the reply: {after_send:?}"
    );
    assert!(
        after_send.iter().all(|message| message["isDraft"] == false),
        "a draft is left in the thread: {after_send:?}"
    );
    assert_eq!(
        after_send
            .iter()
            .filter(|message| message["isSent"] == true)
            .count(),
        1
    );

    // Mark unread, then Done.
    let unread = thread_mutation(
        &inbox,
        "markEmailThreadUnread",
        &json!({ "threadId": thread_id }),
    )
    .await?;
    assert_eq!(unread["isRead"], false, "{unread}");
    inbox
        .wait_for_provider_message("the question to be unread at the provider", |message| {
            message.id == question.id && !message.read
        })
        .await?;
    let done = thread_mutation(
        &inbox,
        "setEmailThreadArchived",
        &json!({ "threadId": thread_id, "archived": true }),
    )
    .await?;
    assert_eq!(done["inboxVisible"], false, "{done}");
    inbox
        .wait_for_provider_message(
            "the question to leave the inbox at the provider",
            |message| message.id == question.id && !message.in_inbox,
        )
        .await?;
    assert!(
        !inbox
            .previews("inbox")
            .await?
            .iter()
            .any(|listed| listed["id"] == thread_id.as_str()),
        "the thread is still listed in the inbox"
    );

    // A second draft, then Discard.
    let second_handle = Uuid::now_v7();
    let second = save_draft(
        &inbox,
        &json!({
            "draftId": second_handle,
            "subject": "Catering",
            "to": [{ "email": grace.email() }],
            "bodyText": "Not sure yet.",
        }),
    )
    .await?;
    let second_thread = second["thread"]["id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    inbox.wait_for_preview("drafts", "Catering").await?;
    if provider == Provider::Outlook {
        inbox
            .wait_for_provider_message("the second draft in Outlook", |message| {
                message.subject == "Catering" && is_draft(message)
            })
            .await?;
    }
    let deleted = inbox
        .user()
        .graphql(
            "mutation($input: DeleteEmailDraftInput!) { deleteEmailDraft(input: $input) { \
             draftId deleted threadDeleted threadId } }",
            &json!({ "input": {
                "draftId": second_handle,
                "draftGeneration": second["draft"]["draftGeneration"],
            } }),
        )
        .await?;
    let deleted = &deleted["deleteEmailDraft"];
    assert_eq!(deleted["deleted"], true, "{deleted}");
    assert!(
        !inbox
            .previews("drafts")
            .await?
            .iter()
            .any(|listed| listed["name"] == "Catering"),
        "the discarded draft is still under Drafts"
    );
    match provider {
        // Gmail drafts live only in Macro: the draft-only thread goes at once.
        Provider::Gmail => {
            assert_eq!(deleted["threadDeleted"], true, "{deleted}");
            assert!(thread(&inbox, &second_thread).await?.is_null());
        }
        // An Outlook draft is deleted at Outlook first; its thread goes once
        // the mailbox no longer holds it.
        Provider::Outlook => {
            email_e2e::eventually(
                "the discarded draft to leave Outlook",
                email_e2e::DEFAULT_TIMEOUT,
                async || {
                    let gone = inbox
                        .provider_messages()?
                        .iter()
                        .all(|message| message.subject != "Catering");
                    Ok(gone.then_some(()))
                },
            )
            .await?;
            email_e2e::eventually(
                "the draft-only thread to go",
                email_e2e::DEFAULT_TIMEOUT,
                async || {
                    Ok(thread(&inbox, &second_thread)
                        .await?
                        .is_null()
                        .then_some(()))
                },
            )
            .await?;
            assert!(
                inbox
                    .provider_messages()?
                    .iter()
                    .any(|message| message.subject == "Re: Venue for the offsite"),
                "the discard took the sent reply with it"
            );
        }
    }

    // Nothing else left: one reply at the recipient, and the discarded
    // draft never went anywhere. A later mail is the barrier.
    inbox
        .send(&json!({
            "subject": "Barrier",
            "to": [{ "email": grace.email() }],
            "body_text": "Later.",
        }))
        .await?;
    correspondent.wait_for_preview("inbox", "Barrier").await?;
    assert_eq!(copies(&correspondent, "Re: Venue for the offsite")?, 1);
    assert_eq!(copies(&correspondent, "Catering")?, 0);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_reply_from_the_composer_round_trip() -> Result<(), Report> {
    reply_from_the_composer_round_trip(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_reply_from_the_composer_round_trip() -> Result<(), Report> {
    reply_from_the_composer_round_trip(Provider::Outlook).await
}

/// A new message from the composer to one recipient, one copied and one
/// blind-copied: each gets it once, with the signature the composer froze
/// at Send under the text; the copied recipient sees the visible
/// recipients and not the blind one.
///
/// When it fails, a recipient is dropped, the blind copy leaks to the
/// others, or the signature is missing from what people receive.
async fn new_message_to_several_people_carries_the_signature(
    provider: Provider,
) -> Result<(), Report> {
    let stack = stack_with_graphql().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let alan = stack.user("alan").await?;
    let joan = stack.user("joan").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;
    let cc = alan.link(provider, alan.email()).await?;
    let bcc = joan.link(provider, joan.email()).await?;

    let attempt_id = Uuid::now_v7();
    let text = "The plan for next quarter is attached below.";
    let accepted = inbox
        .send_attempt(
            attempt_id,
            &json!({
                "draftId": Uuid::now_v7(),
                "subject": "Quarter plan",
                "to": [{ "email": grace.email(), "name": "Grace" }],
                "cc": [{ "email": alan.email(), "name": "Alan" }],
                "bcc": [{ "email": joan.email(), "name": "Joan" }],
                "bodyText": text,
                "bodyHtml": html(&format!("<html><body><div>{text}</div></body></html>")),
            }),
            &json!({ "signatureHtml": SIGNATURE, "includeSignature": true }),
        )
        .await?;
    assert_eq!(accepted["status"], "ACCEPTED", "{accepted}");
    let sent = inbox.wait_for_send_attempt(attempt_id, "SENT").await?;
    assert_eq!(sent["message"]["bcc"][0]["email"], joan.email(), "{sent}");

    for recipient in [&to, &cc, &bcc] {
        let preview = recipient.wait_for_preview("inbox", "Quarter plan").await?;
        assert_eq!(preview["senderEmail"], ada.email(), "{preview}");
        let received = recipient
            .thread(preview["id"].as_str().unwrap_or_default())
            .await?;
        let message = &received["messages"][0];
        let html = message["body_html_sanitized"].as_str().unwrap_or_default();
        let body = html.find("next quarter");
        let signature = html.find("Ada Example, Operations");
        assert!(
            body.is_some() && signature.is_some() && body < signature,
            "{} got no signature under the text: {message}",
            recipient.email()
        );
        assert_eq!(
            html.matches("Ada Example, Operations").count(),
            1,
            "the signature is there more than once: {message}"
        );
    }

    // What the copied recipient sees: who it was to and copied to, and no
    // blind copy.
    let at_cc = cc.wait_for_preview("inbox", "Quarter plan").await?;
    let at_cc = cc.thread(at_cc["id"].as_str().unwrap_or_default()).await?;
    let visible = at_cc["messages"][0].to_string();
    assert!(visible.contains(grace.email()), "{visible}");
    assert!(visible.contains(alan.email()), "{visible}");
    assert!(
        !visible.contains(joan.email()),
        "the blind copy leaked: {visible}"
    );

    // One copy each, and the sender's own copy is in Sent.
    inbox.wait_for_preview("sent", "Quarter plan").await?;
    for recipient in [&to, &cc, &bcc] {
        assert_eq!(
            copies(recipient, "Quarter plan")?,
            1,
            "{}",
            recipient.email()
        );
    }

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_new_message_to_several_people_carries_the_signature() -> Result<(), Report> {
    new_message_to_several_people_carries_the_signature(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_new_message_to_several_people_carries_the_signature() -> Result<(), Report> {
    new_message_to_several_people_carries_the_signature(Provider::Outlook).await
}
