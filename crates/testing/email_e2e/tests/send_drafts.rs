//! Drafts: saving, updating, discarding and moving them, and what the
//! provider and the thread show of them.
//!
//! A Gmail draft lives in Macro only. An Outlook draft is also written to
//! the mailbox by the draft worker, so the Outlook scenarios check the
//! provider's Drafts folder as well.

#![expect(
    clippy::disallowed_methods,
    reason = "a scenario reads and changes its own database, which the query cache does not describe"
)]

#[path = "send_support/drafts.rs"]
mod drafts;
#[path = "send_support/support.rs"]
mod support;

use drafts::{
    draft_previews, generation_of, id_of, operation, refused, reopened, try_discard, try_save,
    wait_for_no_draft_preview, wait_until_in_mailbox,
};
use email_e2e::outlook_emulator::{Fault, FaultError, Route};
use email_e2e::{DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, eventually};
use rootcause::prelude::*;
use serde_json::{Value, json};
use support::{
    first_message, html, message_in_thread, provider_copies, provider_drafts,
    wait_for_no_provider_draft, wait_for_provider_draft, wait_for_wire, wire,
};
use uuid::Uuid;

/// The line a forward starts its quoted message with. The composer tells a
/// forward from a reply by this text standing outside any blockquote.
const FORWARD_HEADER: &str = "---------- Forwarded message ----------";

/// A saved draft shows in Drafts, an update with its id and generation
/// changes that one draft, and the composer reads the new content back. If
/// this fails, autosave makes a second draft per keystroke or loses edits.
async fn draft_is_saved_and_updated(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let draft = inbox
        .save_draft(&json!({
            "subject": "Plans",
            "to": [{ "email": "grace@example.com", "name": "Grace" }],
            "body_text": "First thoughts.",
            "body_html": html("<html><body><div>First thoughts.</div></body></html>"),
        }))
        .await?;
    let id = id_of(&draft);
    assert!(!id.is_empty(), "the save answered no draft id: {draft}");
    assert_eq!(draft["link_id"], inbox.link_id().to_string());
    let preview = inbox.wait_for_preview("drafts", "Plans").await?;
    assert_eq!(preview["id"], draft["thread_db_id"]);
    // Outlook keeps a draft as an item in Drafts. The first save has to be
    // there before the update: an update that overtakes it is written as the
    // item's first content, and nothing in the mailbox is changed.
    let first_in_mailbox = if provider == Provider::Outlook {
        wait_until_in_mailbox(&inbox, &id, "Plans").await?;
        Some(wait_for_provider_draft(&inbox, "Plans").await?.id)
    } else {
        None
    };

    let updated = inbox
        .save_draft(&json!({
            "db_id": id,
            "draft_generation": generation_of(&draft),
            "subject": "Plans for May",
            "to": [{ "email": "grace@example.com", "name": "Grace" }],
            "cc": [{ "email": "linus@example.com" }],
            "body_text": "Second thoughts.",
            "body_html": html("<html><body><div>Second thoughts.</div></body></html>"),
        }))
        .await?;
    assert_eq!(id_of(&updated), id, "the update made another draft");
    assert_eq!(updated["thread_db_id"], draft["thread_db_id"]);

    let read = reopened(&inbox, &updated).await?;
    assert_eq!(read["is_draft"], true, "{read}");
    assert_eq!(read["subject"], "Plans for May");
    assert_eq!(read["body_text"], "Second thoughts.");
    assert_eq!(read["to"][0]["email"], "grace@example.com");
    assert_eq!(read["cc"][0]["email"], "linus@example.com");
    assert_eq!(generation_of(&read), generation_of(&updated));

    inbox.wait_for_preview("drafts", "Plans for May").await?;
    assert!(
        draft_previews(&inbox, "Plans").await?.is_empty(),
        "the draft's first version is still listed"
    );
    if let Some(first_in_mailbox) = first_in_mailbox {
        wait_until_in_mailbox(&inbox, &id, "Plans for May").await?;
        let drafts = provider_drafts(&inbox)?;
        assert_eq!(drafts.len(), 1, "one draft, one item in Drafts: {drafts:?}");
        assert_eq!(
            drafts[0].id, first_in_mailbox,
            "the update put another item in Drafts instead of changing the first"
        );
        let in_mailbox = wire(&stack, &inbox, &drafts[0].id).await?;
        assert_eq!(in_mailbox.subject, "Plans for May");
        assert!(
            in_mailbox.html.contains("Second thoughts.")
                && !in_mailbox.html.contains("First thoughts."),
            "the item in Drafts does not hold the update: {}",
            in_mailbox.html
        );
        assert_eq!(in_mailbox.header("cc"), Some("linus@example.com"));
    }

    stack.finish().await
}

/// The addresses a recipient field of a stored message names, sorted.
fn addresses(message: &Value, field: &str) -> Vec<String> {
    let mut addresses: Vec<String> = message[field]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|recipient| recipient["email"].as_str().map(str::to_owned))
        .collect();
    addresses.sort();
    addresses
}

/// A recipient taken off a draft is gone, and one moved from To to Cc is
/// in Cc only: the draft reopens that way and is sent that way. The
/// removed recipient gets nothing. If this fails, a message reaches someone
/// its sender had removed, or keeps a recipient in the field it was moved
/// out of.
async fn removed_and_moved_recipients_are_what_is_sent(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let linus = stack.user("linus").await?;
    let joan = stack.user("joan").await?;
    let from = ada.link(provider, ada.email()).await?;
    let removed = grace.link(provider, grace.email()).await?;
    let moved = linus.link(provider, linus.email()).await?;
    let kept = joan.link(provider, joan.email()).await?;

    let first = json!({
        "subject": "Seating plan",
        "to": [{ "email": grace.email() }, { "email": linus.email() }, { "email": joan.email() }],
        "body_text": "As drawn.",
        "body_html": html("<html><body><div>As drawn.</div></body></html>"),
    });
    let draft = from.save_draft(&first).await?;
    let id = id_of(&draft);
    let read = reopened(&from, &draft).await?;
    let mut all = [grace.email(), linus.email(), joan.email()];
    all.sort_unstable();
    assert_eq!(addresses(&read, "to"), all, "{read}");

    // Grace is removed, Linus is moved from To to Cc.
    let mut changed = first.clone();
    changed["db_id"] = json!(id);
    changed["draft_generation"] = json!(generation_of(&draft));
    changed["to"] = json!([{ "email": joan.email() }]);
    changed["cc"] = json!([{ "email": linus.email() }]);
    let saved = from.save_draft(&changed).await?;
    assert_eq!(id_of(&saved), id, "the change made another draft");
    let read = reopened(&from, &draft).await?;
    assert_eq!(addresses(&read, "to"), [joan.email()], "{read}");
    assert_eq!(addresses(&read, "cc"), [linus.email()], "{read}");
    assert_eq!(addresses(&read, "bcc"), [""; 0], "{read}");
    wait_until_in_mailbox(&from, &id, "Seating plan").await?;

    let mut send = changed.clone();
    send["draft_generation"] = json!(generation_of(&saved));
    from.send(&send).await?;

    for inbox in [&kept, &moved] {
        let (_, received) = wait_for_wire(&stack, inbox, "Seating plan").await?;
        let to = received.header("to").unwrap_or_default();
        let cc = received.header("cc").unwrap_or_default();
        assert!(
            to.contains(joan.email()) && !to.contains(linus.email()),
            "To is not the one recipient left in it: {:?}",
            received.headers
        );
        assert!(
            cc.contains(linus.email()) && !cc.contains(joan.email()),
            "Cc is not the recipient moved to it: {:?}",
            received.headers
        );
        assert!(
            !received
                .headers
                .iter()
                .any(|(_, value)| value.contains(grace.email())),
            "the message still names the removed recipient: {:?}",
            received.headers
        );
        assert_eq!(provider_copies(inbox, "Seating plan")?.len(), 1);
    }
    // Both copies are delivered, so the removed recipient's would be too.
    assert!(
        provider_copies(&removed, "Seating plan")?.is_empty(),
        "the removed recipient got the message"
    );
    let sent = email_e2e::eventually(
        "Macro to show the message as sent",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let message = reopened(&from, &draft).await?;
            Ok((message["is_sent"] == true).then_some(message))
        },
    )
    .await?;
    assert_eq!(addresses(&sent, "to"), [joan.email()], "{sent}");
    assert_eq!(addresses(&sent, "cc"), [linus.email()], "{sent}");

    stack.finish().await
}

/// A discarded draft is gone from Drafts and from the mailbox, and a second
/// discard of it is harmless. If this fails, discarded drafts linger or a
/// replayed discard shows an error.
async fn discarded_draft_is_gone(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let draft = inbox
        .save_draft(&json!({
            "subject": "Never mind",
            "to": [{ "email": "grace@example.com" }],
            "body_text": "Forget it.",
        }))
        .await?;
    let id = id_of(&draft);
    inbox.wait_for_preview("drafts", "Never mind").await?;
    wait_until_in_mailbox(&inbox, &id, "Never mind").await?;

    let discarded = try_discard(&inbox, &id, generation_of(&draft)).await?;
    assert_eq!(discarded.status, 204, "{}", discarded.text);

    wait_for_no_draft_preview(&inbox, "Never mind").await?;
    assert_eq!(reopened(&inbox, &draft).await?, Value::Null);
    wait_for_no_provider_draft(&inbox).await?;

    let again = try_discard(&inbox, &id, generation_of(&draft)).await?;
    assert_eq!(again.status, 204, "{}", again.text);

    stack.finish().await
}

/// A reply draft belongs to the thread it answers: saved twice from a
/// composer that does not know its id yet it stays one draft, the mailbox
/// files it in the conversation, and once sent it is the thread's second
/// message. If this fails, replies start threads of their own or pile up as
/// duplicate drafts.
async fn reply_draft_stays_in_its_thread(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    let delivered = from.deliver(&Mail::new(
        &format!("Grace <{}>", grace.email()),
        "Lunch",
        "Noon?",
    ))?;
    let preview = from.wait_for_preview("inbox", "Lunch").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();
    let original = first_message(&from, &preview).await?;

    let reply = json!({
        "subject": "Re: Lunch",
        "to": [{ "email": grace.email() }],
        "replying_to_id": original["db_id"],
        "body_text": "Noon works.",
    });
    let draft = from.save_draft(&reply).await?;
    let id = id_of(&draft);
    assert_eq!(draft["thread_db_id"], thread_id.as_str());
    let again = from.save_draft(&reply).await?;
    assert_eq!(
        id_of(&again),
        id,
        "a second save of the reply made a second draft"
    );

    let thread = from.thread(&thread_id).await?;
    let messages = thread["messages"].as_array().cloned().unwrap_or_default();
    assert_eq!(messages.len(), 2, "{thread}");
    let in_thread = message_in_thread(&from, &thread_id, &id).await?;
    assert_eq!(in_thread["is_draft"], true, "{in_thread}");
    assert_eq!(in_thread["replying_to_id"], original["db_id"]);
    if provider == Provider::Outlook {
        let at_provider = wait_for_provider_draft(&from, "Re: Lunch").await?;
        assert_eq!(
            at_provider.thread_id, delivered.thread_id,
            "the mailbox filed the reply draft outside the conversation"
        );
        wait_until_in_mailbox(&from, &id, "Re: Lunch").await?;
    }

    let mut send = reply.clone();
    send["db_id"] = json!(id);
    send["draft_generation"] = json!(generation_of(&again));
    from.send(&send).await?;

    to.wait_for_preview("inbox", "Re: Lunch").await?;
    let sent = from
        .wait_for_provider_message("the sent reply", |message| {
            message.subject == "Re: Lunch" && !support::is_draft_at_provider(message)
        })
        .await?;
    assert_eq!(
        sent.thread_id, delivered.thread_id,
        "the reply left the conversation at the provider"
    );
    let thread = from
        .wait_for_thread(&thread_id, "the reply to show as sent", |thread| {
            thread["messages"].as_array().is_some_and(|messages| {
                messages
                    .iter()
                    .any(|message| message["db_id"] == id.as_str() && message["is_sent"] == true)
            })
        })
        .await?;
    assert_eq!(
        thread["messages"].as_array().map(Vec::len),
        Some(2),
        "the thread holds the reply more than once: {thread}"
    );
    wait_for_no_provider_draft(&from).await?;

    stack.finish().await
}

/// A queued send and its cancellation each advance the draft's generation.
/// A write that still names an old one is refused and changes nothing, a
/// write naming the current one is applied, and the thread read hands the
/// composer the generation it needs. If this fails, a stale tab overwrites
/// the restored draft, or a discard deletes nothing and autosave latches.
///
/// The generation is advanced in the database: the send that advances it is
/// the GraphQL outbox admission, which this stack does not serve.
async fn stale_generation_is_refused(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let content = json!({
        "subject": "Budget",
        "to": [{ "email": "grace@example.com" }],
        "body_text": "As restored after Undo.",
    });
    let draft = inbox.save_draft(&content).await?;
    let id = id_of(&draft);
    assert_eq!(generation_of(&draft), 0);
    wait_until_in_mailbox(&inbox, &id, "Budget").await?;

    let draft_id: Uuid = id.parse()?;
    sqlx::query("UPDATE email_messages SET draft_generation = 2 WHERE id = $1")
        .bind(draft_id)
        .execute(stack.db())
        .await?;

    let mut stale = content.clone();
    stale["db_id"] = json!(id);
    stale["draft_generation"] = json!(0);
    stale["body_text"] = json!("From a tab that missed the send.");
    let answer = try_save(&inbox, &stale).await?;
    assert_eq!(
        answer.status, 400,
        "a save naming an old generation was not refused: {}",
        answer.text
    );
    let mut unnamed = stale.clone();
    if let Some(fields) = unnamed.as_object_mut() {
        fields.remove("draft_generation");
    }
    let answer = try_save(&inbox, &unnamed).await?;
    assert_eq!(
        answer.status, 400,
        "a save naming no generation was not refused: {}",
        answer.text
    );
    let answer = try_discard(&inbox, &id, 0).await?;
    assert_eq!(
        answer.status, 409,
        "a discard naming an old generation was not refused: {}",
        answer.text
    );

    let read = reopened(&inbox, &draft).await?;
    assert_eq!(
        generation_of(&read),
        2,
        "the thread read does not carry the generation: {read}"
    );
    assert_eq!(read["body_text"], "As restored after Undo.");
    assert_eq!(read["is_draft"], true);

    let mut current = content.clone();
    current["db_id"] = json!(id);
    current["draft_generation"] = json!(2);
    current["body_text"] = json!("Edited after Undo.");
    let saved = inbox.save_draft(&current).await?;
    assert_eq!(generation_of(&saved), 2);
    assert_eq!(
        reopened(&inbox, &draft).await?["body_text"],
        "Edited after Undo."
    );

    let answer = try_discard(&inbox, &id, 2).await?;
    assert_eq!(answer.status, 204, "{}", answer.text);
    wait_for_no_draft_preview(&inbox, "Budget").await?;
    wait_for_no_provider_draft(&inbox).await?;

    stack.finish().await
}

/// A saved forward comes back with what the composer derives its kind from:
/// the message it forwards and the forwarded-message line outside any quote,
/// once, however often the draft is re-saved; and it is sent with one such
/// line. If this fails, a forward reopens as a reply or goes out with two
/// quoted blocks.
async fn forward_draft_keeps_what_tells_its_kind(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let linus = stack.user("linus").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = linus.link(provider, linus.email()).await?;

    from.deliver(&Mail::new(
        &format!("Grace <{}>", grace.email()),
        "Report",
        "Numbers inside.",
    ))?;
    let preview = from.wait_for_preview("inbox", "Report").await?;
    let original = first_message(&from, &preview).await?;

    let forward_body = format!(
        "<html><body><div>For you.</div><div><br></div>\
         <div>{FORWARD_HEADER}<br>From: Grace<br>Subject: Report</div>\
         <blockquote><div>Numbers inside.</div></blockquote></body></html>"
    );
    let reply_body = "<html><body><div>Thanks.</div>\
         <blockquote><div>Numbers inside.</div></blockquote></body></html>";
    let forward = json!({
        "subject": "Fwd: Report",
        "to": [{ "email": linus.email() }],
        "replying_to_id": original["db_id"],
        "body_text": "For you.",
        "body_html": html(&forward_body),
    });
    let draft = from.save_draft(&forward).await?;
    let id = id_of(&draft);

    let assert_forward = |read: &Value| {
        let body = read["body_html_sanitized"].as_str().unwrap_or_default();
        assert_eq!(read["replying_to_id"], original["db_id"], "{read}");
        assert_eq!(
            body.matches(FORWARD_HEADER).count(),
            1,
            "the forwarded-message line is missing or repeated: {body}"
        );
        assert!(
            body.find(FORWARD_HEADER) < body.find("<blockquote"),
            "the forwarded-message line is inside the quote: {body}"
        );
    };
    assert_forward(&reopened(&from, &draft).await?);

    // Switch the draft to Reply and back to Forward.
    let mut as_reply = forward.clone();
    as_reply["db_id"] = json!(id);
    as_reply["draft_generation"] = json!(generation_of(&draft));
    as_reply["subject"] = json!("Re: Report");
    as_reply["to"] = json!([{ "email": grace.email() }]);
    as_reply["body_html"] = json!(html(reply_body));
    let saved = from.save_draft(&as_reply).await?;
    let read = reopened(&from, &draft).await?;
    let body = read["body_html_sanitized"].as_str().unwrap_or_default();
    assert!(
        !body.contains(FORWARD_HEADER),
        "the reply kept the forward's quoted block: {body}"
    );

    let mut back = forward.clone();
    back["db_id"] = json!(id);
    back["draft_generation"] = json!(generation_of(&saved));
    let saved = from.save_draft(&back).await?;
    assert_eq!(id_of(&saved), id);
    assert_forward(&reopened(&from, &draft).await?);
    wait_until_in_mailbox(&from, &id, "Fwd: Report").await?;

    let mut send = back.clone();
    send["draft_generation"] = json!(generation_of(&saved));
    from.send(&send).await?;
    let (_, received) = wait_for_wire(&stack, &to, "Fwd: Report").await?;
    assert_eq!(
        received.html_count(FORWARD_HEADER),
        1,
        "the forward went out without, or with more than one, quoted block: {}",
        received.html
    );
    assert_eq!(
        received.html_count("Numbers inside."),
        1,
        "{}",
        received.html
    );

    stack.finish().await
}

/// A save that arrives after the discard of the same draft is refused and
/// brings nothing back, whichever generation it names. The composer queues
/// its last autosave and the discard in either order; if this fails, a
/// discarded draft reappears in Drafts and in the mailbox.
async fn save_after_discard_is_refused(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.deliver(&Mail::new(
        &format!("Grace <{}>", grace.email()),
        "Lunch",
        "Noon?",
    ))?;
    let preview = inbox.wait_for_preview("inbox", "Lunch").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();
    let original = first_message(&inbox, &preview).await?;

    let reply = json!({
        "subject": "Re: Lunch",
        "to": [{ "email": grace.email() }],
        "replying_to_id": original["db_id"],
        "body_text": "Noon works",
    });
    let draft = inbox.save_draft(&reply).await?;
    let id = id_of(&draft);
    wait_until_in_mailbox(&inbox, &id, "Re: Lunch").await?;

    let discarded = try_discard(&inbox, &id, generation_of(&draft)).await?;
    assert_eq!(discarded.status, 204, "{}", discarded.text);

    // The autosave of the last keystroke, sent before the discard, lands now.
    let mut late = reply.clone();
    late["db_id"] = json!(id);
    late["draft_generation"] = json!(generation_of(&draft));
    late["body_text"] = json!("Noon works.");
    let answer = try_save(&inbox, &late).await?;
    assert!(
        refused(&answer),
        "a save after the discard was accepted: {} {}",
        answer.status,
        answer.text
    );

    assert_eq!(
        message_in_thread(&inbox, &thread_id, &id).await?,
        Value::Null,
        "the discarded draft is back in its thread"
    );
    wait_for_no_draft_preview(&inbox, "Re: Lunch").await?;
    wait_for_no_provider_draft(&inbox).await?;
    // The mailbox settles asynchronously: a later change proves nothing came
    // back after it did.
    inbox.deliver(&Mail::new(
        &format!("Grace <{}>", grace.email()),
        "Dinner",
        "Eight?",
    ))?;
    inbox.wait_for_preview("inbox", "Dinner").await?;
    assert!(
        provider_drafts(&inbox)?.is_empty(),
        "the discarded draft is back in the mailbox"
    );
    let thread = inbox.thread(&thread_id).await?;
    assert_eq!(
        thread["messages"].as_array().map(Vec::len),
        Some(1),
        "{thread}"
    );

    stack.finish().await
}

/// Graph refuses `createReply` for some parents with 400
/// `ErrorInvalidOperation`. The reply is then created as a message of its
/// own and still sent in the thread. If this fails, replying to such a
/// message leaves a draft that is permanently failed and cannot be sent.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_reply_draft_survives_a_refused_create_reply() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link_outlook().await?;
    let to = grace.link_outlook().await?;

    from.deliver(&Mail::new(
        &format!("Grace <{}>", grace.email()),
        "Lunch",
        "Noon?",
    ))?;
    let preview = from.wait_for_preview("inbox", "Lunch").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();
    let original = first_message(&from, &preview).await?;

    stack.outlook().inject_fault(Fault {
        mailbox: Some(from.email().to_owned()),
        route: Some(Route::MessagesCreateReply),
        error: Some(FaultError::InvalidOperation),
        ..Fault::default()
    });

    let reply = json!({
        "subject": "Re: Lunch",
        "to": [{ "email": grace.email() }],
        "replying_to_id": original["db_id"],
        "body_text": "Noon works.",
        "body_html": html("<html><body><div>Noon works.</div></body></html>"),
    });
    let draft = from.save_draft(&reply).await?;
    let id = id_of(&draft);
    wait_until_in_mailbox(&from, &id, "Re: Lunch").await?;
    let refusals = stack
        .outlook()
        .requests()
        .into_iter()
        .filter(|request| {
            request.route == Some(Route::MessagesCreateReply) && request.status == 400
        })
        .count();
    assert!(
        refusals >= 1,
        "the reply draft was not created through createReply, so the scenario proved nothing"
    );
    let drafts = provider_drafts(&from)?;
    assert_eq!(drafts.len(), 1, "{drafts:?}");

    let mut send = reply.clone();
    send["db_id"] = json!(id);
    send["draft_generation"] = json!(generation_of(&draft));
    from.send(&send).await?;

    let (_, received) = wait_for_wire(&stack, &to, "Re: Lunch").await?;
    assert!(received.html.contains("Noon works."), "{}", received.html);
    let thread = from
        .wait_for_thread(&thread_id, "the reply to show as sent", |thread| {
            thread["messages"].as_array().is_some_and(|messages| {
                messages
                    .iter()
                    .any(|message| message["db_id"] == id.as_str() && message["is_sent"] == true)
            })
        })
        .await?;
    assert_eq!(
        thread["messages"].as_array().map(Vec::len),
        Some(2),
        "the reply is not the second message of its thread: {thread}"
    );
    let answered = to.wait_for_preview("inbox", "Re: Lunch").await?;
    assert_eq!(answered["senderEmail"], ada.email());

    stack.finish().await
}

/// A draft can be discarded while the draft worker is still writing its
/// autosave to Outlook: the discard is accepted, and the worker removes the
/// draft from the mailbox once its write returns. If this fails, trashing a
/// draft a moment after typing answers "invalid" and the draft stays.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_draft_can_be_discarded_while_it_is_being_saved() -> Result<(), Report> {
    /// How long Outlook holds the worker's write: long enough for the
    /// discard to arrive in the middle of it.
    const SLOW_WRITE_MS: u64 = 8_000;

    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;

    stack.outlook().inject_fault(Fault {
        mailbox: Some(inbox.email().to_owned()),
        route: Some(Route::MessagesCreate),
        delay_ms: Some(SLOW_WRITE_MS),
        times: Some(1),
        ..Fault::default()
    });
    let draft = inbox
        .save_draft(&json!({
            "subject": "Half a thought",
            "to": [{ "email": "grace@example.com" }],
            "body_text": "On second",
        }))
        .await?;
    let id = id_of(&draft);
    // Outlook has stored the draft and is holding its answer: the worker is
    // in the middle of the write, with its lease on the draft.
    wait_for_provider_draft(&inbox, "Half a thought").await?;

    let discarded = try_discard(&inbox, &id, generation_of(&draft)).await?;
    assert_eq!(
        discarded.status, 204,
        "the discard was refused while the autosave was being written: {}",
        discarded.text
    );
    // The emulator logs a request when it answers it.
    let answered = stack
        .outlook()
        .requests()
        .into_iter()
        .any(|request| request.route == Some(Route::MessagesCreate));
    assert!(
        !answered,
        "the write had already finished, so the scenario proved nothing"
    );

    wait_for_no_draft_preview(&inbox, "Half a thought").await?;
    wait_for_no_provider_draft(&inbox).await?;
    assert_eq!(reopened(&inbox, &draft).await?, Value::Null);

    stack.finish().await
}

/// Rewrites a draft in Outlook itself, as its owner does in another mail
/// client, and returns the version Outlook then holds.
async fn rewrite_in_outlook(
    stack: &Stack,
    inbox: &Inbox,
    provider_id: &str,
    subject: &str,
    text: &str,
) -> Result<String, Report> {
    let response = reqwest::Client::new()
        .patch(format!(
            "{}/me/messages/{provider_id}",
            stack.outlook().graph_url()
        ))
        .bearer_auth(stack.outlook().access_token(inbox.email())?)
        .json(&json!({
            "subject": subject,
            "body": {
                "contentType": "html",
                "content": format!("<html><body><div>{text}</div></body></html>"),
            },
        }))
        .send()
        .await?;
    let status = response.status();
    let written: Value = response.json().await?;
    if !status.is_success() {
        bail!("Outlook answered {status} for the rewrite of a draft: {written}");
    }
    written["@odata.etag"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| report!("Outlook named no version for the rewritten draft: {written}"))
}

/// Which version of a draft the user keeps when Macro and Outlook disagree.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Keep {
    Mine,
    Outlooks,
}

/// A draft changed in Macro and, before that change reached the mailbox,
/// rewritten in Outlook as well: Macro reports the conflict instead of
/// overwriting either side, and the user's choice settles it. "Keep mine"
/// writes Macro's text over the item in Outlook's Drafts; "use Outlook's"
/// brings the mailbox's text into Macro. Either way one draft is left,
/// the same on both sides, and synchronized again.
///
/// When it fails, an edit made in the other client is silently lost, the
/// conflict is never shown, or the choice is accepted and the draft stays
/// stuck in conflict.
async fn conflicting_draft_is_resolved(keep: Keep) -> Result<(), Report> {
    /// How long Outlook tells the draft worker to wait before it writes
    /// again: the rewrite in Outlook happens in between.
    const WRITE_AGAIN_AFTER_SECS: u64 = 12;

    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;

    let draft = inbox
        .save_draft(&json!({
            "subject": "Offer",
            "to": [{ "email": "grace@example.com", "name": "Grace" }],
            "body_text": "First wording.",
            "body_html": html("<html><body><div>First wording.</div></body></html>"),
        }))
        .await?;
    let id = id_of(&draft);
    wait_until_in_mailbox(&inbox, &id, "Offer").await?;
    let in_drafts = wait_for_provider_draft(&inbox, "Offer").await?.id;

    // Outlook refuses the worker's next write once, so the edit made in
    // Macro is still on its way when the draft is rewritten in Outlook.
    stack.outlook().inject_fault(Fault {
        mailbox: Some(inbox.email().to_owned()),
        route: Some(Route::MessagesUpdate),
        error: Some(FaultError::RateLimit),
        retry_after_seconds: Some(WRITE_AGAIN_AFTER_SECS),
        times: Some(1),
        ..Fault::default()
    });
    let mine = inbox
        .save_draft(&json!({
            "db_id": id,
            "draft_generation": generation_of(&draft),
            "subject": "Offer from Macro",
            "to": [{ "email": "grace@example.com", "name": "Grace" }],
            "body_text": "Worded in Macro.",
            "body_html": html("<html><body><div>Worded in Macro.</div></body></html>"),
        }))
        .await?;
    eventually(
        "Outlook to refuse the draft worker's write",
        DEFAULT_TIMEOUT,
        async || {
            let refused = stack.outlook().requests().into_iter().any(|request| {
                request.route == Some(Route::MessagesUpdate)
                    && request.status == 429
                    && request.mailbox.as_deref() == Some(inbox.email())
            });
            Ok(refused.then_some(()))
        },
    )
    .await?;
    let outlooks_version = rewrite_in_outlook(
        &stack,
        &inbox,
        &in_drafts,
        "Offer from Outlook",
        "Worded in Outlook.",
    )
    .await?;

    // The conflict is reported once Macro has seen Outlook's version, and
    // neither side has been overwritten.
    let conflict = eventually(
        "the draft to be reported as conflicting with Outlook's version",
        DEFAULT_TIMEOUT,
        async || {
            let seen = operation(&inbox, &id).await?;
            let reported =
                seen["state"] == "CONFLICT" && seen["remote_version"] == outlooks_version.as_str();
            Ok(reported.then_some(seen))
        },
    )
    .await?;
    assert_eq!(conflict["issue"], "DRAFT_CONFLICT", "{conflict}");
    let read = reopened(&inbox, &mine).await?;
    assert_eq!(read["subject"], "Offer from Macro", "{read}");
    assert_eq!(
        wire(&stack, &inbox, &in_drafts).await?.subject,
        "Offer from Outlook"
    );

    let action = match keep {
        Keep::Mine => "keep_local",
        Keep::Outlooks => "use_provider",
    };
    let resolved = inbox
        .post(
            &format!("/email/drafts/{id}/resolve"),
            Some(&json!({
                "revision": conflict["revision"],
                "remote_version": conflict["remote_version"],
                "action": action,
            })),
        )
        .await?;
    assert_eq!(resolved.status, 204, "{}", resolved.text);
    let settled = operation(&inbox, &id).await?;
    assert_ne!(
        settled["state"], "CONFLICT",
        "the choice was accepted and the draft is still in conflict: {settled}"
    );

    let (subject, text, other) = match keep {
        Keep::Mine => ("Offer from Macro", "Worded in Macro.", "Worded in Outlook."),
        Keep::Outlooks => (
            "Offer from Outlook",
            "Worded in Outlook.",
            "Worded in Macro.",
        ),
    };
    // Macro shows the kept version.
    let read = eventually(
        &format!("the draft to read {subject:?} in Macro"),
        DEFAULT_TIMEOUT,
        async || {
            let read = reopened(&inbox, &mine).await?;
            Ok((read["subject"] == subject).then_some(read))
        },
    )
    .await?;
    assert_eq!(read["is_draft"], true, "{read}");
    let body = read["body_text"].as_str().unwrap_or_default();
    assert!(body.contains(text) && !body.contains(other), "{read}");
    // Outlook holds it too, in the item the draft always was, and the two
    // are in step again.
    wait_until_in_mailbox(&inbox, &id, subject).await?;
    let drafts = provider_drafts(&inbox)?;
    assert_eq!(drafts.len(), 1, "one draft, one item in Drafts: {drafts:?}");
    assert_eq!(drafts[0].id, in_drafts);
    let in_mailbox = wire(&stack, &inbox, &in_drafts).await?;
    assert_eq!(in_mailbox.subject, subject);
    assert!(
        in_mailbox.html.contains(text) && !in_mailbox.html.contains(other),
        "the item in Drafts does not hold the kept version: {}",
        in_mailbox.html
    );
    inbox.wait_for_preview("drafts", subject).await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_keeping_my_version_of_a_conflicting_draft_overwrites_outlooks()
-> Result<(), Report> {
    conflicting_draft_is_resolved(Keep::Mine).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_taking_outlooks_version_of_a_conflicting_draft_brings_it_into_macro()
-> Result<(), Report> {
    conflicting_draft_is_resolved(Keep::Outlooks).await
}

/// HTML written in Macro passes the sanitizer before it is stored, for a
/// draft and for a sent message alike: scripts, event handlers and script
/// links are gone, the text stays. The stored body is put into the page of
/// everyone the thread is shared with; if this fails, a draft is stored XSS.
async fn authored_html_is_sanitized(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    let hostile = "<html><body><div>Hello there.</div>\
        <script>alert('one')</script>\
        <img src=\"https://example.com/x.png\" onerror=\"alert('two')\">\
        <a href=\"javascript:alert('three')\">a link</a>\
        <div onclick=\"alert('four')\">Bye.</div></body></html>";
    let assert_clean = |what: &str, body: &str| {
        for forbidden in ["<script", "onerror", "onclick", "javascript:", "alert("] {
            assert!(
                !body.contains(forbidden),
                "{what} still holds {forbidden:?}: {body}"
            );
        }
        assert!(
            body.contains("Hello there.") && body.contains("Bye."),
            "{what} lost its text: {body}"
        );
    };

    let message = json!({
        "subject": "Greetings",
        "to": [{ "email": grace.email() }],
        "body_text": "Hello there. Bye.",
        "body_html": html(hostile),
    });
    let draft = from.save_draft(&message).await?;
    let id = id_of(&draft);
    assert_clean(
        "the saved draft",
        draft["body_html"].as_str().unwrap_or_default(),
    );
    let read = reopened(&from, &draft).await?;
    assert_clean(
        "the draft as reopened",
        read["body_html_sanitized"].as_str().unwrap_or_default(),
    );
    wait_until_in_mailbox(&from, &id, "Greetings").await?;

    let mut send = message.clone();
    send["db_id"] = json!(id);
    send["draft_generation"] = json!(generation_of(&draft));
    let sent = from.send(&send).await?;
    assert_clean(
        "the message as queued",
        sent["body_html"].as_str().unwrap_or_default(),
    );
    let (_, received) = wait_for_wire(&stack, &to, "Greetings").await?;
    assert_clean("the message as received", &received.html);
    from.wait_for_preview("sent", "Greetings").await?;
    let stored = reopened(&from, &draft).await?;
    assert_clean(
        "the sent message as stored",
        stored["body_html_sanitized"].as_str().unwrap_or_default(),
    );

    stack.finish().await
}

/// A discarded reply draft is no longer part of its thread: neither thread
/// read lists it, and the thread is not in Drafts. Outlook keeps the row of
/// a deleted draft as a tombstone; if this fails, the thread says it has a
/// draft that does not exist and the composer opens a deleted draft.
async fn discarded_reply_draft_leaves_the_thread(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.deliver(&Mail::new(
        &format!("Grace <{}>", grace.email()),
        "Lunch",
        "Noon?",
    ))?;
    let preview = inbox.wait_for_preview("inbox", "Lunch").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();
    let original = first_message(&inbox, &preview).await?;

    let draft = inbox
        .save_draft(&json!({
            "subject": "Re: Lunch",
            "to": [{ "email": grace.email() }],
            "replying_to_id": original["db_id"],
            "body_text": "Tombstone words.",
        }))
        .await?;
    let id = id_of(&draft);
    wait_until_in_mailbox(&inbox, &id, "Re: Lunch").await?;

    let discarded = try_discard(&inbox, &id, generation_of(&draft)).await?;
    assert_eq!(discarded.status, 204, "{}", discarded.text);

    let assert_gone = async |when: &str| -> Result<(), Report> {
        let thread = inbox.thread(&thread_id).await?;
        let messages = thread["messages"].as_array().cloned().unwrap_or_default();
        assert_eq!(
            messages.len(),
            1,
            "{when}, the thread still lists the draft: {thread}"
        );
        assert!(
            messages.iter().all(|message| message["is_draft"] == false),
            "{when}, the thread still has a draft: {thread}"
        );
        let listed = inbox
            .get(&format!("/email/threads/{thread_id}/messages?limit=100"))
            .await?
            .ok()?;
        let listed = listed.as_array().cloned().unwrap_or_default();
        assert_eq!(
            listed.len(),
            1,
            "{when}, the thread's message list still has the draft: {listed:?}"
        );
        assert!(
            listed.iter().all(|message| message["db_id"] != id.as_str()),
            "{when}, the thread's message list still has the draft: {listed:?}"
        );
        Ok(())
    };
    assert_gone("right after the discard").await?;
    wait_for_no_draft_preview(&inbox, "Re: Lunch").await?;
    wait_for_no_provider_draft(&inbox).await?;
    assert_gone("after the mailbox dropped the draft").await?;
    let preview = inbox.wait_for_preview("inbox", "Lunch").await?;
    assert_eq!(preview["isDraft"], false, "{preview}");

    stack.finish().await
}

/// A composer still holding a draft that was sent from another tab saves it
/// again. That save is refused and creates nothing: no draft in Macro, none
/// in the mailbox, one copy delivered. If this fails, sent mail comes back
/// as a draft.
async fn save_for_a_sent_draft_is_refused(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    let content = json!({
        "subject": "Minutes",
        "to": [{ "email": grace.email() }],
        "body_text": "As agreed.",
    });
    let draft = from.save_draft(&content).await?;
    let id = id_of(&draft);
    wait_until_in_mailbox(&from, &id, "Minutes").await?;

    // The other tab sends the draft.
    let mut send = content.clone();
    send["db_id"] = json!(id);
    send["draft_generation"] = json!(generation_of(&draft));
    from.send(&send).await?;
    to.wait_for_preview("inbox", "Minutes").await?;
    from.wait_for_preview("sent", "Minutes").await?;
    let sent = reopened(&from, &draft).await?;
    assert_eq!(sent["is_draft"], false, "{sent}");

    // This tab autosaves what it still holds, with the generation it loaded
    // and with the current one.
    for generation in [generation_of(&draft), generation_of(&sent)] {
        let mut late = send.clone();
        late["draft_generation"] = json!(generation);
        late["body_text"] = json!("As agreed. One more thing");
        let answer = try_save(&from, &late).await?;
        assert_eq!(
            answer.status, 400,
            "a save for a sent draft was not refused: {}",
            answer.text
        );
    }
    let discard = try_discard(&from, &id, generation_of(&sent)).await?;
    assert_eq!(
        discard.status, 409,
        "a discard of a sent message was not refused: {}",
        discard.text
    );

    let after = reopened(&from, &draft).await?;
    assert_eq!(
        after["is_draft"], false,
        "the sent message is a draft again"
    );
    assert_eq!(after["body_text"], sent["body_text"]);
    assert!(
        draft_previews(&from, "Minutes").await?.is_empty(),
        "the sent message is listed in Drafts"
    );
    wait_for_no_provider_draft(&from).await?;
    // A later delivery proves no second copy and no new draft followed.
    from.send(&json!({
        "subject": "Afterwards",
        "to": [{ "email": grace.email() }],
        "body_text": "Next.",
    }))
    .await?;
    to.wait_for_preview("inbox", "Afterwards").await?;
    assert_eq!(provider_copies(&to, "Minutes")?.len(), 1);
    assert!(provider_drafts(&from)?.is_empty());
    assert!(draft_previews(&from, "Minutes").await?.is_empty());

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_draft_is_saved_and_updated() -> Result<(), Report> {
    draft_is_saved_and_updated(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_draft_is_saved_and_updated() -> Result<(), Report> {
    draft_is_saved_and_updated(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_removed_and_moved_recipients_are_what_is_sent() -> Result<(), Report> {
    removed_and_moved_recipients_are_what_is_sent(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_removed_and_moved_recipients_are_what_is_sent() -> Result<(), Report> {
    removed_and_moved_recipients_are_what_is_sent(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_discarded_draft_is_gone() -> Result<(), Report> {
    discarded_draft_is_gone(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_discarded_draft_is_gone() -> Result<(), Report> {
    discarded_draft_is_gone(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_reply_draft_stays_in_its_thread() -> Result<(), Report> {
    reply_draft_stays_in_its_thread(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_reply_draft_stays_in_its_thread() -> Result<(), Report> {
    reply_draft_stays_in_its_thread(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_stale_generation_is_refused() -> Result<(), Report> {
    stale_generation_is_refused(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_stale_generation_is_refused() -> Result<(), Report> {
    stale_generation_is_refused(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_forward_draft_keeps_what_tells_its_kind() -> Result<(), Report> {
    forward_draft_keeps_what_tells_its_kind(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_forward_draft_keeps_what_tells_its_kind() -> Result<(), Report> {
    forward_draft_keeps_what_tells_its_kind(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_save_after_discard_is_refused() -> Result<(), Report> {
    save_after_discard_is_refused(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_save_after_discard_is_refused() -> Result<(), Report> {
    save_after_discard_is_refused(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_authored_html_is_sanitized() -> Result<(), Report> {
    authored_html_is_sanitized(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_authored_html_is_sanitized() -> Result<(), Report> {
    authored_html_is_sanitized(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_discarded_reply_draft_leaves_the_thread() -> Result<(), Report> {
    discarded_reply_draft_leaves_the_thread(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_discarded_reply_draft_leaves_the_thread() -> Result<(), Report> {
    discarded_reply_draft_leaves_the_thread(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_save_for_a_sent_draft_is_refused() -> Result<(), Report> {
    save_for_a_sent_draft_is_refused(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_save_for_a_sent_draft_is_refused() -> Result<(), Report> {
    save_for_a_sent_draft_is_refused(Provider::Outlook).await
}
