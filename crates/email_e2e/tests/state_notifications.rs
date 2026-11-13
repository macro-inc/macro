//! What the email service tells the notification service about new mail.

use email_e2e::{Inbox, Mail, Provider, Report, Stack, gmail_emulator, outlook_emulator};
use rootcause::prelude::*;
use serde_json::Value;
use uuid::Uuid;

/// The queue the notification service reads.
const INGRESS: &str = "notification-ingress";

/// Takes what is on the notification queue and returns the new-mail
/// notifications among it, as their `req` objects.
async fn take_new_mail(stack: &Stack) -> Result<Vec<Value>, Report> {
    Ok(stack
        .take_queue_messages(INGRESS)
        .await?
        .into_iter()
        .map(|message| message["request"]["req"].clone())
        .filter(|request| request["notification"]["tag"] == "new_email")
        .collect())
}

/// Waits for the new-mail notification of the mail with this subject and
/// returns it with every other one that came before it.
async fn wait_for_notification(stack: &Stack, subject: &str) -> Result<(Value, Vec<Value>), Report> {
    let mut others = Vec::new();
    let found = email_e2e::eventually(
        &format!("the notification of \"{subject}\""),
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let mut found = None;
            for request in take_new_mail(stack).await? {
                if request["notification"]["content"]["subject"] == subject && found.is_none() {
                    found = Some(request);
                } else {
                    others.push(request);
                }
            }
            Ok(found)
        },
    )
    .await?;
    Ok((found, others))
}

/// Delivers mail the provider sorted out of the primary inbox: Gmail's
/// Promotions, Outlook's Other.
fn deliver_bulk(stack: &Stack, inbox: &Inbox, from: &str, subject: &str) -> Result<(), Report> {
    match inbox.provider() {
        Provider::Gmail => {
            stack.gmail().deliver(
                inbox.email(),
                &gmail_emulator::NewMessage {
                    from: Some(from.to_owned()),
                    subject: Some(subject.to_owned()),
                    text: Some("Sale.".to_owned()),
                    labels: Some(
                        ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"]
                            .map(str::to_owned)
                            .to_vec(),
                    ),
                    ..Default::default()
                },
            )?;
        }
        Provider::Outlook => {
            stack.outlook().deliver(
                inbox.email(),
                &outlook_emulator::NewMessage {
                    from: Some(from.to_owned()),
                    subject: Some(subject.to_owned()),
                    text: Some("Sale.".to_owned()),
                    other: true,
                    ..Default::default()
                },
            )?;
        }
    }
    Ok(())
}

/// Whether Macro counts the thread as signal.
async fn is_signal(stack: &Stack, preview: &Value) -> Result<bool, Report> {
    let id: Uuid = preview["id"]
        .as_str()
        .and_then(|id| id.parse().ok())
        .ok_or_else(|| report!("the preview has no thread id: {preview}"))?;
    Ok(
        sqlx::query_scalar("SELECT is_signal FROM email_threads WHERE id = $1")
            .bind(id)
            .fetch_one(stack.db())
            .await?,
    )
}

/// New mail is announced once, on the queue the notification service
/// reads, as a notification about the email thread, to the inbox's owner.
///
/// When it fails: no notification of new mail arrives at all, it arrives
/// twice, or it opens something other than the thread.
async fn new_mail_is_announced_to_the_notification_service(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    take_new_mail(&stack).await?;

    inbox.deliver(&Mail::new("Grace <grace@example.com>", "Lunch on Friday?", "Noon at the usual place?"))?;
    let preview = inbox.wait_for_preview("inbox", "Lunch on Friday?").await?;
    let (request, _) = wait_for_notification(&stack, "Lunch on Friday?").await?;

    assert_eq!(request["notification_entity"]["entity_type"], "email_thread");
    assert_eq!(request["notification_entity"]["entity_id"], preview["id"]);
    assert_eq!(request["recipient_ids"], serde_json::json!([ada.macro_id()]));
    let content = &request["notification"]["content"];
    assert_eq!(content["threadId"], preview["id"]);
    assert_eq!(content["toEmail"], ada.email());
    assert_eq!(content["sender"], "Grace");
    assert_eq!(content["snippet"].as_str().map(str::trim), Some("Noon at the usual place?"));

    // A later mail's notification arrives without a second one for the first.
    inbox.deliver(&Mail::new("Alan <alan@example.com>", "Second mail", "Hello."))?;
    let (_, others) = wait_for_notification(&stack, "Second mail").await?;
    assert_eq!(others, Vec::<Value>::new(), "the first mail was announced once");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_new_mail_is_announced_to_the_notification_service() -> Result<(), Report> {
    new_mail_is_announced_to_the_notification_service(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_new_mail_is_announced_to_the_notification_service() -> Result<(), Report> {
    new_mail_is_announced_to_the_notification_service(Provider::Outlook).await
}

/// Only mail that counts as signal is announced: bulk mail the provider
/// sorted out of the primary inbox, the user's own sent mail and mail
/// already in Trash are not.
///
/// When it fails: phones buzz for newsletters and for the user's own mail.
async fn only_signal_mail_is_announced(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    take_new_mail(&stack).await?;

    deliver_bulk(&stack, &inbox, "Shop <deals@example.net>", "Weekend sale")?;
    let bulk = inbox.wait_for_preview("all", "Weekend sale").await?;
    inbox
        .send(&serde_json::json!({
            "subject": "My own mail",
            "to": [{ "email": "grace@example.com" }],
            "body_text": "Sent by me.",
        }))
        .await?;
    inbox.wait_for_preview("sent", "My own mail").await?;
    inbox.deliver(&Mail::new("Grace <grace@example.com>", "Personal note", "Hi Ada."))?;
    let personal = inbox.wait_for_preview("inbox", "Personal note").await?;

    assert!(!is_signal(&stack, &bulk).await?, "bulk mail is not signal");
    assert!(is_signal(&stack, &personal).await?, "personal mail is signal");
    let (_, others) = wait_for_notification(&stack, "Personal note").await?;
    assert_eq!(others, Vec::<Value>::new(), "nothing else was announced");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_only_signal_mail_is_announced() -> Result<(), Report> {
    only_signal_mail_is_announced(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_only_signal_mail_is_announced() -> Result<(), Report> {
    only_signal_mail_is_announced(Provider::Outlook).await
}

/// The mail Macro itself sends about notifications is neither signal nor
/// announced again.
///
/// When it fails: every notification email from Macro shows up as signal
/// and raises a notification of its own.
async fn macros_own_notification_mail_is_not_signal(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    take_new_mail(&stack).await?;

    // The domain every notification mail of Macro is sent from.
    let sender = format!("Macro <no-reply@{}>", "notification.macro.com");
    inbox.deliver(&Mail::new(
        &sender,
        "Grace mentioned you",
        "Open Macro to reply.",
    ))?;
    let own = inbox.wait_for_preview("all", "Grace mentioned you").await?;
    inbox.deliver(&Mail::new("Grace <grace@example.com>", "A real mail", "Hi."))?;
    let real = inbox.wait_for_preview("inbox", "A real mail").await?;

    assert!(!is_signal(&stack, &own).await?);
    assert!(is_signal(&stack, &real).await?);
    let (_, others) = wait_for_notification(&stack, "A real mail").await?;
    assert_eq!(others, Vec::<Value>::new(), "Macro's own mail was not announced");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_macros_own_notification_mail_is_not_signal() -> Result<(), Report> {
    macros_own_notification_mail_is_not_signal(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_macros_own_notification_mail_is_not_signal() -> Result<(), Report> {
    macros_own_notification_mail_is_not_signal(Provider::Outlook).await
}
