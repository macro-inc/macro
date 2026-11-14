//! Remind me if no reply: the user files a thread away until a time, and
//! it comes back to the inbox then, with a notification, unless the other
//! side answered first.
//!
//! The reminder routes and their dispatch worker run in document storage;
//! the scenario puts the minutely sweep tick on the dispatch queue, as the
//! scheduler does.

use std::time::Duration;

use chrono::Utc;
use email_e2e::{DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, StackOptions, eventually};
use reqwest::Method;
use serde_json::{Value, json};
use uuid::Uuid;

const GRACE: &str = "Grace <grace@example.com>";

/// The queue the reminder dispatch worker reads.
const DISPATCH: &str = "reminder-dispatch";

/// The queue the notification service reads.
const INGRESS: &str = "notification-ingress";

/// How far ahead the reminders are set: long enough to set them both and
/// let a reply arrive, short enough to wait for.
const REMIND_IN: Duration = Duration::from_secs(5);

/// How long after the reminders Grace answers.
const ANSWER_AFTER: Duration = Duration::from_secs(1);

/// Delivers a mail from Grace with this `Message-ID` and returns the
/// thread's id in Macro and the message's id at the provider.
async fn receive(
    inbox: &Inbox,
    subject: &str,
    message_id: &str,
) -> Result<(String, String), Report> {
    let message = inbox.deliver(&Mail {
        message_id: Some(message_id.to_owned()),
        ..Mail::new(GRACE, subject, "Hello.")
    })?;
    let preview = inbox.wait_for_preview("inbox", subject).await?;
    let thread_id = preview["id"]
        .as_str()
        .ok_or_else(|| rootcause::report!("a preview without an id: {preview}"))?
        .to_owned();
    Ok((thread_id, message.id))
}

/// Whether the inbox view lists the thread.
async fn in_inbox(inbox: &Inbox, thread_id: &str) -> Result<bool, Report> {
    Ok(inbox
        .previews("inbox")
        .await?
        .iter()
        .any(|preview| preview["id"] == thread_id))
}

/// The thread's follow-up, as the thread's reminder menu reads it.
async fn followup(inbox: &Inbox, thread_id: &str) -> Result<Value, Report> {
    let response = inbox
        .user()
        .document_storage_request(Method::GET, &format!("/reminders/email/{thread_id}"), None)
        .await?
        .ok()?;
    Ok(response["followup"].clone())
}

/// Sets "remind me if no reply" on the thread, `REMIND_IN` from now.
async fn remind_if_no_reply(inbox: &Inbox, thread_id: &str) -> Result<Value, Report> {
    let remind_at = Utc::now() + REMIND_IN;
    inbox
        .user()
        .document_storage_request(
            Method::PUT,
            &format!("/reminders/email/{thread_id}"),
            Some(&json!({
                "type": "set",
                "operationId": Uuid::now_v7(),
                "expectedRevision": null,
                "remindAt": remind_at,
                "condition": "if_no_reply",
            })),
        )
        .await?
        .ok()
}

/// Whether a notification on the queue is the reminder's alert.
fn notifies(notifications: &[Value], reminder_id: &str) -> bool {
    notifications
        .iter()
        .any(|message| message.to_string().contains(reminder_id))
}

/// Remind me if no reply: Ada sets a reminder on two threads from Grace,
/// and both leave the inbox here and at the provider. Grace answers one of
/// them. When the time comes, the unanswered thread is back in the inbox
/// (in Macro and at the provider) and Ada is notified about it; the
/// answered one's reminder is cancelled and it sends no notification.
///
/// When it fails, a thread put away with a reminder never comes back, comes
/// back without telling the user, stays in the inbox at the provider, or
/// the user is reminded about a thread the other side already answered.
async fn remind_me_if_no_reply(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (quiet, quiet_message) =
        receive(&inbox, "Contract draft", "contract-1@example.com").await?;
    let (answered, answered_message) = receive(&inbox, "Team lunch", "lunch-1@example.com").await?;

    let quiet_reminder = remind_if_no_reply(&inbox, &quiet).await?;
    let answered_reminder = remind_if_no_reply(&inbox, &answered).await?;
    for (thread, reminder) in [(&quiet, &quiet_reminder), (&answered, &answered_reminder)] {
        assert_eq!(reminder["threadId"], thread.as_str(), "{reminder}");
        assert_eq!(reminder["condition"], "if_no_reply", "{reminder}");
        assert!(
            !in_inbox(&inbox, thread).await?,
            "the reminded thread stayed in the inbox"
        );
    }
    for message_id in [&quiet_message, &answered_message] {
        inbox
            .wait_for_provider_message(
                "the reminded thread out of the provider's inbox",
                |message| &message.id == message_id && !message.in_inbox,
            )
            .await?;
    }

    // Grace answers a moment later. Outlook gives a message's arrival to the
    // second, so an answer within the second the reminder was set reads as
    // older than the reminder.
    match provider {
        Provider::Gmail => stack.gmail().advance_clock(ANSWER_AFTER),
        Provider::Outlook => stack.outlook().advance_clock(ANSWER_AFTER),
    }
    inbox.deliver(
        &Mail::new(GRACE, "Re: Team lunch", "Noon works.").in_reply_to("lunch-1@example.com"),
    )?;
    inbox
        .wait_for_thread(&answered, "Grace's answer in the thread", |thread| {
            thread["messages"]
                .as_array()
                .is_some_and(|messages| messages.len() == 2)
        })
        .await?;

    // The scheduler's tick, once a sweep can find the reminders due.
    let mut notifications = Vec::new();
    let mut seen = (Value::Null, Value::Null);
    let settled = eventually("both reminders to settle", DEFAULT_TIMEOUT, async || {
        stack
            .send_to_queue(DISPATCH, &json!({ "operation": "sweep" }))
            .await?;
        notifications.extend(stack.take_queue_messages(INGRESS).await?);
        seen = (
            followup(&inbox, &quiet).await?["state"].clone(),
            followup(&inbox, &answered).await?["state"].clone(),
        );
        Ok((seen.0 == "returned" && seen.1 == "cancelled").then_some(()))
    })
    .await;
    settled.map_err(|error| {
        rootcause::report!(
            "{error}; the unanswered reminder was {}, the answered one {}",
            seen.0,
            seen.1
        )
    })?;

    assert!(
        in_inbox(&inbox, &quiet).await?,
        "the unanswered thread did not come back"
    );
    assert!(
        in_inbox(&inbox, &answered).await?,
        "the answered thread is not in the inbox"
    );
    inbox
        .wait_for_provider_message(
            "the unanswered thread back in the provider's inbox",
            |message| message.id == quiet_message && message.in_inbox,
        )
        .await?;

    let quiet_id = quiet_reminder["reminderId"].as_str().unwrap_or_default();
    eventually("the reminder's notification", DEFAULT_TIMEOUT, async || {
        notifications.extend(stack.take_queue_messages(INGRESS).await?);
        Ok(notifies(&notifications, quiet_id).then_some(()))
    })
    .await?;
    let answered_id = answered_reminder["reminderId"].as_str().unwrap_or_default();
    assert!(
        !notifies(&notifications, answered_id),
        "Ada was reminded about a thread Grace answered: {notifications:?}"
    );

    stack.finish().await
}

/// How far ahead a reminder is set that the scenario changes and removes
/// before its time: no sweep of the scenario finds it due.
const REMIND_MUCH_LATER: Duration = Duration::from_secs(3600);

/// `PUT /reminders/email/{thread_id}` with a command the reminder menu sends.
async fn put_followup(inbox: &Inbox, thread_id: &str, command: &Value) -> Result<Value, Report> {
    inbox
        .user()
        .document_storage_request(
            Method::PUT,
            &format!("/reminders/email/{thread_id}"),
            Some(command),
        )
        .await?
        .ok()
}

/// The instant a follow-up names, to the millisecond.
fn remind_at(followup: &Value) -> Option<i64> {
    followup["remindAt"]
        .as_str()
        .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
        .map(|at| at.timestamp_millis())
}

/// A reminder can be moved to another time and then removed: the edit
/// names the revision it replaces and is answered with the new time, and
/// removing brings the thread back to the inbox, in Macro and at the
/// provider, without ever reminding. A second thread's reminder comes due
/// meanwhile, so the sweep that finds it had the removed one to pass over.
///
/// When it fails, a reminder keeps its old time after an edit, or a thread
/// whose reminder the user removed stays filed away, or still reminds.
async fn changed_then_removed_reminder_gives_the_thread_back(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (thread, message) = receive(&inbox, "Invoice", "invoice-1@example.com").await?;
    let (other, _) = receive(&inbox, "Contract draft", "contract-1@example.com").await?;

    let first_time = Utc::now() + REMIND_MUCH_LATER;
    let set = put_followup(
        &inbox,
        &thread,
        &json!({
            "type": "set",
            "operationId": Uuid::now_v7(),
            "expectedRevision": null,
            "remindAt": first_time,
            "condition": "if_no_reply",
        }),
    )
    .await?;
    assert!(
        !in_inbox(&inbox, &thread).await?,
        "the reminded thread stayed in the inbox"
    );
    inbox
        .wait_for_provider_message(
            "the reminded thread out of the provider's inbox",
            |at_provider| at_provider.id == message && !at_provider.in_inbox,
        )
        .await?;

    // Change the time, naming the revision the menu showed.
    let second_time = first_time + REMIND_MUCH_LATER;
    let changed = put_followup(
        &inbox,
        &thread,
        &json!({
            "type": "set",
            "operationId": Uuid::now_v7(),
            "expectedRevision": set["revision"],
            "remindAt": second_time,
            "condition": "if_no_reply",
        }),
    )
    .await?;
    assert_eq!(changed["reminderId"], set["reminderId"], "{changed}");
    assert_ne!(changed["revision"], set["revision"], "{changed}");
    assert_eq!(
        remind_at(&changed),
        Some(second_time.timestamp_millis()),
        "the edit was not answered with the new time: {changed}"
    );
    let read = followup(&inbox, &thread).await?;
    assert_eq!(
        remind_at(&read),
        Some(second_time.timestamp_millis()),
        "the reminder kept its old time: {read}"
    );
    assert_eq!(read["revision"], changed["revision"], "{read}");
    assert!(
        !in_inbox(&inbox, &thread).await?,
        "changing the reminder's time brought the thread back"
    );

    // An edit or a removal that names the replaced revision is refused.
    let stale = inbox
        .user()
        .document_storage_request(
            Method::PUT,
            &format!("/reminders/email/{thread}"),
            Some(&json!({
                "type": "remove",
                "operationId": Uuid::now_v7(),
                "expectedRevision": set["revision"],
            })),
        )
        .await?;
    assert_eq!(
        stale.status, 400,
        "a removal naming a replaced revision was not refused: {}",
        stale.text
    );

    put_followup(
        &inbox,
        &thread,
        &json!({
            "type": "remove",
            "operationId": Uuid::now_v7(),
            "expectedRevision": changed["revision"],
        }),
    )
    .await?;
    eventually(
        "the removed reminder to give the thread back",
        DEFAULT_TIMEOUT,
        async || {
            let state = followup(&inbox, &thread).await?["state"].clone();
            Ok((state == "removed" && in_inbox(&inbox, &thread).await?).then_some(()))
        },
    )
    .await?;
    inbox
        .wait_for_provider_message("the thread back in the provider's inbox", |at_provider| {
            at_provider.id == message && at_provider.in_inbox
        })
        .await?;

    // The other thread's reminder comes due: the sweeps that return it
    // would have delivered the removed one too, were it still alive.
    let other_reminder = remind_if_no_reply(&inbox, &other).await?;
    let other_id = other_reminder["reminderId"].as_str().unwrap_or_default();
    let mut notifications = Vec::new();
    eventually(
        "the other thread's reminder to notify",
        DEFAULT_TIMEOUT,
        async || {
            stack
                .send_to_queue(DISPATCH, &json!({ "operation": "sweep" }))
                .await?;
            notifications.extend(stack.take_queue_messages(INGRESS).await?);
            Ok(notifies(&notifications, other_id).then_some(()))
        },
    )
    .await?;
    let removed_id = set["reminderId"].as_str().unwrap_or_default();
    assert!(!removed_id.is_empty(), "{set}");
    assert!(
        !notifies(&notifications, removed_id),
        "Ada was reminded about a thread whose reminder she removed: {notifications:?}"
    );
    assert_eq!(followup(&inbox, &thread).await?["state"], "removed");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_remind_me_if_no_reply() -> Result<(), Report> {
    remind_me_if_no_reply(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_remind_me_if_no_reply() -> Result<(), Report> {
    remind_me_if_no_reply(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_changed_then_removed_reminder_gives_the_thread_back() -> Result<(), Report> {
    changed_then_removed_reminder_gives_the_thread_back(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_changed_then_removed_reminder_gives_the_thread_back() -> Result<(), Report> {
    changed_then_removed_reminder_gives_the_thread_back(Provider::Outlook).await
}
