//! The phone push of new-mail notifications for Macro staff.

use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, eventually, gmail_emulator,
    outlook_emulator,
};
use serde_json::Value;

/// The queue the notification service reads.
const INGRESS: &str = "notification-ingress";

/// Takes what is on the notification queue and returns the requests for
/// new-mail notifications among it.
async fn take_new_mail(stack: &Stack) -> Result<Vec<Value>, Report> {
    Ok(stack
        .take_queue_messages(INGRESS)
        .await?
        .into_iter()
        .map(|message| message["request"].clone())
        .filter(|request| request["req"]["notification"]["tag"] == "new_email")
        .collect())
}

/// Waits for the new-mail notification of the mail with this subject and
/// returns it with every other one that came before it.
async fn wait_for_notification(
    stack: &Stack,
    subject: &str,
) -> Result<(Value, Vec<Value>), Report> {
    let mut others = Vec::new();
    let found = eventually(
        &format!("the notification of \"{subject}\""),
        DEFAULT_TIMEOUT,
        async || {
            let mut found = None;
            for request in take_new_mail(stack).await? {
                if request["req"]["notification"]["content"]["subject"] == subject
                    && found.is_none()
                {
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

/// Whether the notification service is asked to push to phones.
fn has_push(request: &Value) -> bool {
    !request["build_apns"].is_null()
}

/// A Macro staff inbox gets a phone push only for signal mail.
///
/// When it fails: staff phones buzz for newsletters.
async fn staff_get_a_push_only_for_signal_mail(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    // Staff are the users whose address is at the company's own domain.
    let ada = stack.user_at("ada@macro.com").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    take_new_mail(&stack).await?;

    deliver_bulk(&stack, &inbox, "Shop <deals@example.net>", "Weekend sale")?;
    // Bulk mail is still announced in the app, without the push.
    let (bulk, others) = wait_for_notification(&stack, "Weekend sale").await?;
    assert!(!has_push(&bulk), "bulk mail does not push: {bulk}");
    assert!(others.is_empty(), "{others:?}");

    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Personal note",
        "Hi Ada.",
    ))?;
    let (personal, others) = wait_for_notification(&stack, "Personal note").await?;
    assert!(has_push(&personal), "signal mail pushes: {personal}");
    assert!(others.is_empty(), "{others:?}");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_staff_get_a_push_only_for_signal_mail() -> Result<(), Report> {
    staff_get_a_push_only_for_signal_mail(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_staff_get_a_push_only_for_signal_mail() -> Result<(), Report> {
    staff_get_a_push_only_for_signal_mail(Provider::Outlook).await
}
