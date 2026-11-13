//! Shared inboxes: one user's mailbox that another user has access to.

#![expect(
    clippy::disallowed_methods,
    reason = "a scenario reads and seeds its own database, which the query cache does not describe"
)]

use std::collections::BTreeSet;

use email_e2e::{Inbox, Mail, Provider, Report, Stack, User};
use reqwest::Method;
use rootcause::prelude::*;
use serde_json::{Value, json};
use uuid::Uuid;

/// Gives `delegate` access to the mailbox `address`, the way the app does
/// once the delegate has signed in to it at the provider: the finished
/// sign-in, then `POST /email/init`. Returns the API's answer.
async fn share_with(
    stack: &Stack,
    delegate: &User,
    provider: Provider,
    address: &str,
) -> Result<Value, Report> {
    let attempt = Uuid::now_v7();
    let scopes = match provider {
        Provider::Gmail => vec!["https://www.googleapis.com/auth/gmail.modify".to_owned()],
        Provider::Outlook => {
            stack
                .outlook()
                .link_mailbox(&attempt.to_string(), address)?;
            Vec::new()
        }
    };
    sqlx::query(
        "INSERT INTO in_progress_user_link \
             (id, macro_user_id, linked_email, email_provider, requested_google_scopes, granted_google_scopes) \
         VALUES ($1, $2, $3, $4::email_user_provider_enum, $5, $5)",
    )
    .bind(attempt)
    .bind(delegate.fusion_id())
    .bind(address)
    .bind(provider.as_str())
    .bind(scopes)
    .execute(stack.db())
    .await
    .context("could not record the delegate's finished sign-in")?;
    delegate
        .post(&format!("/email/init?link_id={attempt}"), None)
        .await?
        .ok()
}

/// The ids of the inboxes the user can use.
async fn link_ids(user: &User) -> Result<BTreeSet<String>, Report> {
    let links = user.get("/email/links").await?.ok()?;
    Ok(links["links"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|link| link["id"].as_str().map(str::to_owned))
        .collect())
}

/// The user's previews of a view, across every inbox they can use.
async fn previews(user: &User, view: &str) -> Result<Vec<Value>, Report> {
    let page = user
        .get(&format!("/email/threads/previews/cursor/{view}?limit=100"))
        .await?
        .ok()?;
    Ok(page["items"].as_array().cloned().unwrap_or_default())
}

/// Waits for the user to see a thread with this subject in a view.
async fn wait_for_preview(user: &User, view: &str, subject: &str) -> Result<Value, Report> {
    email_e2e::eventually(
        &format!("{} to see \"{subject}\" in {view}", user.email()),
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            Ok(previews(user, view)
                .await?
                .into_iter()
                .find(|preview| preview["name"] == subject))
        },
    )
    .await
}

/// Owner Olga with her Gmail inbox, and Dan who has access to it.
async fn shared_gmail_inbox(stack: &Stack) -> Result<(User, Inbox, User), Report> {
    let olga = stack.user("olga").await?;
    let inbox = olga.link_gmail().await?;
    let dan = stack.user("dan").await?;
    let shared = share_with(stack, &dan, Provider::Gmail, olga.email()).await?;
    if shared["link_id"] != inbox.link_id().to_string().as_str() {
        bail!("sharing answered another inbox: {shared}");
    }
    Ok((olga, inbox, dan))
}

/// A delegate who removes a shared inbox from their account loses their
/// own access and nothing else: the owner's inbox keeps syncing.
///
/// When it fails: a delegate disconnecting a shared inbox disconnects it
/// for its owner too, and deletes the owner's synced mail.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_delegate_leaving_keeps_the_owners_inbox() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let (olga, inbox, dan) = shared_gmail_inbox(&stack).await?;
    let link = inbox.link_id();
    inbox.deliver(&Mail::new("Grace <grace@example.com>", "Before", "One."))?;
    wait_for_preview(&dan, "inbox", "Before").await?;

    let left = dan
        .request(Method::DELETE, "/email/sync", Some(link), None)
        .await?;
    assert_eq!(left.status, 204, "{}", left.text);

    assert!(
        link_ids(&dan).await?.is_empty(),
        "the delegate lost the inbox"
    );
    assert!(previews(&dan, "inbox").await?.is_empty());
    assert!(link_ids(&olga).await?.contains(&link.to_string()));

    // The owner's inbox still syncs.
    inbox.deliver(&Mail::new("Grace <grace@example.com>", "After", "Two."))?;
    inbox.wait_for_preview("inbox", "After").await?;
    let owner_link = inbox.link().await?;
    assert_eq!(owner_link["is_sync_active"], true);
    let disconnecting: bool = sqlx::query_scalar(
        "SELECT disconnect_requested_at IS NOT NULL FROM email_links WHERE id = $1",
    )
    .bind(link)
    .fetch_one(stack.db())
    .await?;
    assert!(
        !disconnecting,
        "the owner's inbox is not being disconnected"
    );
    assert!(
        stack
            .take_queue_messages("link-manager")
            .await?
            .iter()
            .all(|message| message["operation"] != "DeleteLink"),
        "nothing asked for the inbox to be deleted"
    );

    stack.finish().await
}

/// Sharing one inbox shares that inbox only: the delegate neither lists
/// nor can address the owner's other inbox or its mail.
///
/// When it fails: someone given one mailbox reads every mailbox its owner
/// linked.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_delegate_sees_only_the_shared_inbox() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let (olga, shared, dan) = shared_gmail_inbox(&stack).await?;
    let private = olga
        .link(Provider::Gmail, "olga.private@example.com")
        .await?;
    shared.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Shared mail",
        "For both.",
    ))?;
    private.deliver(&Mail::new(
        "Bank <bank@example.com>",
        "Private mail",
        "For Olga.",
    ))?;
    let private_thread = private.wait_for_preview("inbox", "Private mail").await?;
    let private_thread = private_thread["id"].as_str().unwrap_or_default();
    wait_for_preview(&dan, "inbox", "Shared mail").await?;

    assert_eq!(
        link_ids(&dan).await?,
        BTreeSet::from([shared.link_id().to_string()]),
        "the delegate lists the shared inbox only"
    );
    for view in ["inbox", "all"] {
        let names: Vec<Value> = previews(&dan, view)
            .await?
            .into_iter()
            .map(|preview| preview["name"].clone())
            .collect();
        assert_eq!(names, vec![Value::from("Shared mail")], "the {view} list");
    }
    let other_inbox = dan
        .request(Method::GET, "/email/filters", Some(private.link_id()), None)
        .await?;
    assert_eq!(other_inbox.status, 404, "{}", other_inbox.text);
    let opened = dan
        .get(&format!("/email/threads/{private_thread}?limit=100"))
        .await?;
    assert!(
        matches!(opened.status, 401 | 403 | 404),
        "opening the owner's private thread answered {}: {}",
        opened.status,
        opened.text
    );
    let seen = dan
        .post(&format!("/email/threads/{private_thread}/seen"), None)
        .await?;
    assert!(
        matches!(seen.status, 403 | 404),
        "{} {}",
        seen.status,
        seen.text
    );
    let archived = dan
        .patch(
            &format!("/email/threads/{private_thread}/archived"),
            Some(&json!({ "value": true })),
        )
        .await?;
    assert!(
        matches!(archived.status, 403 | 404),
        "{} {}",
        archived.status,
        archived.text
    );
    let labels = dan.get("/email/labels").await?.ok()?;
    assert!(
        labels["labels"]
            .as_array()
            .into_iter()
            .flatten()
            .all(|label| label["linkId"] == shared.link_id().to_string().as_str()),
        "the delegate lists the shared inbox's labels only"
    );
    // Without naming an inbox the delegate has none of their own.
    let unnamed = dan.get("/email/filters").await?;
    assert_eq!(unnamed.status, 400, "{}", unnamed.text);

    stack.finish().await
}

/// New mail in a shared inbox notifies the owner and the delegate, and the
/// delegate can open it.
///
/// When it fails: people working a shared inbox get no notification of
/// its new mail, or cannot open the thread.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_delegate_is_told_of_new_mail_and_can_open_it() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let (olga, inbox, dan) = shared_gmail_inbox(&stack).await?;
    stack.take_queue_messages("notification-ingress").await?;

    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "For the team",
        "Hello both.",
    ))?;
    let preview = wait_for_preview(&dan, "inbox", "For the team").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default();

    let notification = email_e2e::eventually(
        "the new mail's notification",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            Ok(stack
                .take_queue_messages("notification-ingress")
                .await?
                .into_iter()
                .find(|message| {
                    message["request"]["req"]["notification"]["content"]["subject"]
                        == "For the team"
                }))
        },
    )
    .await?;
    let recipients: BTreeSet<String> = notification["request"]["req"]["recipient_ids"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|id| id.as_str().map(str::to_owned))
        .collect();
    assert_eq!(
        recipients,
        BTreeSet::from([olga.macro_id().to_owned(), dan.macro_id().to_owned()])
    );

    let thread = dan
        .get(&format!("/email/threads/{thread_id}?limit=100"))
        .await?
        .ok()?;
    assert_eq!(
        thread["thread"]["messages"][0]["body_text"]
            .as_str()
            .map(str::trim),
        Some("Hello both.")
    );

    stack.finish().await
}

/// A delegate marking shared mail read and starred changes the messages
/// in Macro and at the provider, for the owner as well.
///
/// When it fails: read and star by a delegate change the thread's row but
/// not its messages, so the mail shows as unread again and never reaches
/// the provider.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_delegate_marks_shared_mail_read_and_starred() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let (_olga, inbox, dan) = shared_gmail_inbox(&stack).await?;
    let delivered = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Read me",
        "Please.",
    ))?;
    let preview = wait_for_preview(&dan, "inbox", "Read me").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default();

    for field in ["read", "starred"] {
        let changed = dan
            .patch(
                &format!("/email/threads/{thread_id}/state"),
                Some(&json!({ "field": field, "value": true })),
            )
            .await?;
        assert_eq!(changed.status, 204, "{field}: {}", changed.text);
    }
    inbox
        .wait_for_provider_message("the message to be read and starred at Gmail", |message| {
            message.id == delivered.id && message.read && message.starred
        })
        .await?;
    // As the owner sees it.
    let thread = inbox.thread(thread_id).await?;
    assert_eq!(thread["is_read"], true);
    assert_eq!(thread["messages"][0]["is_read"], true);
    assert_eq!(thread["messages"][0]["is_starred"], true);
    inbox.wait_for_preview("starred", "Read me").await?;

    stack.finish().await
}

/// A delegate changing a label on single messages of shared mail changes
/// them.
///
/// When it fails: the request answers success with every message listed as
/// missing, and nothing changes.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: state-read-star-write-wrong-inbox"]
async fn gmail_a_delegate_changes_labels_on_single_messages() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let (_olga, inbox, dan) = shared_gmail_inbox(&stack).await?;
    let delivered = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "One message",
        "Hi.",
    ))?;
    let preview = wait_for_preview(&dan, "inbox", "One message").await?;
    let thread = inbox
        .thread(preview["id"].as_str().unwrap_or_default())
        .await?;
    let message_id = thread["messages"][0]["db_id"].clone();
    let labels = inbox.get("/email/labels").await?.ok()?;
    let unread = labels["labels"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|label| label["providerLabelId"] == "UNREAD")
        .map(|label| label["id"].clone())
        .unwrap_or_default();

    let changed = dan
        .request(
            Method::PATCH,
            "/email/messages/labels",
            Some(inbox.link_id()),
            Some(&json!({ "message_ids": [message_id], "label_id": unread, "value": false })),
        )
        .await?
        .ok()?;
    assert_eq!(changed["successful_ids"], json!([message_id]), "{changed}");
    inbox
        .wait_for_provider_message("the message to be read at Gmail", |message| {
            message.id == delivered.id && message.read
        })
        .await?;

    stack.finish().await
}

/// Someone who links a colleague's mailbox before the colleague has linked
/// it themselves creates the colleague's inbox, under the colleague's
/// identity, with access for themselves.
///
/// When it fails: the inbox is recorded under the delegate's identity, so
/// its owner cannot act on their own mail later.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_linking_a_colleagues_mailbox_first_creates_it_as_theirs() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let carol = stack.user("carol").await?;
    let dan = stack.user("dan").await?;
    stack.seed_mailbox(
        Provider::Gmail,
        carol.email(),
        &[Mail::new(
            "Grace <grace@example.com>",
            "Already here",
            "Old mail.",
        )],
    )?;

    let created = share_with(&stack, &dan, Provider::Gmail, carol.email()).await?;
    let link = created["link_id"].as_str().unwrap_or_default().to_owned();
    assert!(!link.is_empty(), "{created}");
    wait_for_preview(&dan, "inbox", "Already here").await?;

    let links = dan.get("/email/links").await?.ok()?;
    let listed = links["links"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|listed| listed["id"] == link.as_str())
        .cloned()
        .unwrap_or_default();
    assert_eq!(listed["macro_id"], carol.macro_id());
    assert_eq!(listed["fusionauth_user_id"], carol.fusion_id().to_string());
    assert_eq!(listed["is_primary"], true);
    // The owner has it too, as her own first inbox.
    assert!(link_ids(&carol).await?.contains(&link));
    wait_for_preview(&carol, "inbox", "Already here").await?;
    let labels = carol.get("/email/labels").await?;
    assert_eq!(labels.status, 200, "the owner's requests use it by default");

    stack.finish().await
}

/// A change the user made while Outlook was failing is still delivered
/// after they reconnect the mailbox with a new grant.
///
/// When it fails: reconnecting an Outlook inbox silently drops the read,
/// archive and move changes that were waiting, so Macro and Outlook
/// disagree from then on.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_waiting_change_survives_a_reconnect() -> Result<(), Report> {
    use email_e2e::outlook_emulator::{Fault, FaultError, Route};

    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;
    let delivered = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Waiting",
        "Read me.",
    ))?;
    let preview = inbox.wait_for_preview("inbox", "Waiting").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default();

    let fault = stack.outlook().inject_fault(Fault {
        mailbox: Some(inbox.email().to_owned()),
        route: Some(Route::MessagesUpdate),
        error: Some(FaultError::Unavailable),
        retry_after_seconds: Some(1),
        ..Default::default()
    });
    inbox
        .patch(
            &format!("/email/threads/{thread_id}/state"),
            Some(&json!({ "field": "read", "value": true })),
        )
        .await?
        .ok()?;
    email_e2e::eventually(
        "Outlook to refuse the change once",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            Ok(stack
                .outlook()
                .requests()
                .iter()
                .any(|request| {
                    request.route == Some(Route::MessagesUpdate) && request.status >= 500
                })
                .then_some(()))
        },
    )
    .await?;

    // The user reconnects. The emulator hands out the same grant every
    // time, so the stored one is aged to make this a new grant, as a real
    // reconnect is.
    sqlx::query("UPDATE email_links SET grant_generation = 0 WHERE id = $1")
        .bind(inbox.link_id())
        .execute(stack.db())
        .await?;
    let reconnected = share_with(&stack, &ada, Provider::Outlook, ada.email()).await?;
    assert_eq!(reconnected["link_id"], inbox.link_id().to_string());
    stack.outlook().remove_fault(fault);

    inbox
        .wait_for_provider_message("the message to be read at Outlook", |message| {
            message.id == delivered.id && message.read
        })
        .await?;
    let operations = email_e2e::eventually(
        "the change to be reported as applied",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let operations = inbox
                .get(&format!("/email/threads/{thread_id}/operations"))
                .await?
                .ok()?;
            Ok(operations
                .to_string()
                .contains("\"applied\"")
                .then_some(operations))
        },
    )
    .await?;
    assert!(
        !operations.to_string().contains("\"failed\""),
        "{operations}"
    );

    stack.finish().await
}

/// Deleting a user who had access to someone's Outlook mailbox takes that
/// user's access and grant away, before anything else is done with the
/// mailbox.
///
/// When it fails: the deleted user's access to the mailbox, or the grant
/// Microsoft holds for them, outlives their account, or is dealt with
/// only after the steps that should follow it.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_deleting_a_delegate_removes_their_access() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let alice = stack.user("alice").await?;
    let inbox = alice.link_outlook().await?;
    let zed = stack.user("zed").await?;
    share_with(&stack, &zed, Provider::Outlook, alice.email()).await?;
    assert!(link_ids(&zed).await?.contains(&inbox.link_id().to_string()));
    // The mailbox's lifecycle effects are deleted with the mailbox's rows
    // once they are done, so a copy of each is kept as it is queued.
    for statement in [
        "CREATE TABLE e2e_lifecycle_effects (seq bigserial, link_id uuid, payload jsonb)",
        "CREATE FUNCTION e2e_keep_effect() RETURNS trigger LANGUAGE plpgsql AS $$ \
         BEGIN INSERT INTO e2e_lifecycle_effects (link_id, payload) VALUES (NEW.link_id, NEW.payload); RETURN NEW; END $$",
        "CREATE TRIGGER e2e_keep_effect AFTER INSERT ON email_mailbox_lifecycle_outbox \
         FOR EACH ROW EXECUTE FUNCTION e2e_keep_effect()",
    ] {
        sqlx::query(statement).execute(stack.db()).await?;
    }

    stack
        .send_to_queue(
            "link-manager",
            &json!({ "operation": "DeleteUser", "fusionauth_user_id": zed.fusion_id() }),
        )
        .await?;
    email_e2e::eventually(
        "the deleted user's access to be removed",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let edges: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM macro_user_links WHERE primary_macro_id = $1",
            )
            .bind(zed.macro_id())
            .fetch_one(stack.db())
            .await?;
            Ok((edges == 0).then_some(()))
        },
    )
    .await?;
    // What the mailbox's lifecycle was asked to do for the deleted user.
    let effects = email_e2e::eventually(
        "the deleted user's grant to be queued for revocation",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let effects: Vec<(Value,)> = sqlx::query_as(
                "SELECT payload FROM e2e_lifecycle_effects WHERE link_id = $1 ORDER BY seq",
            )
            .bind(inbox.link_id())
            .fetch_all(stack.db())
            .await?;
            let effects: Vec<Value> = effects.into_iter().map(|(payload,)| payload).collect();
            Ok(effects
                .iter()
                .any(|effect| {
                    effect["kind"] == "revoke_microsoft_grant"
                        && effect["owner"] == zed.fusion_id().to_string().as_str()
                })
                .then_some(effects))
        },
    )
    .await?;
    let first = effects.first().cloned().unwrap_or_default();
    assert!(
        first["kind"] == "access_removed" && first["viewer"] == zed.macro_id(),
        "removing the deleted user's access comes first: {effects:?}"
    );
    assert!(link_ids(&zed).await?.is_empty());

    stack.finish().await
}
