//! Managing a connected account the way the settings screens do: checking
//! that a connection is healthy, resyncing, the people the user writes
//! with, the inbox's settings, and turning sync off.
//!
//! Each step is checked in what the app reads back (`GET /email/links`, the
//! lists) and, where the provider sees it, at the provider.

#![expect(
    clippy::disallowed_methods,
    reason = "a test query against the scenario's database, which the offline query cache does not cover"
)]

use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, eventually, gmail_emulator,
    outlook_emulator,
};
use rootcause::report;
use serde_json::{Value, json};
use uuid::Uuid;

/// Marks the next token the provider serves the mailbox: a fault that
/// fails nothing and is used up by that one request. Answers its id.
fn mark_next_token(stack: &Stack, inbox: &Inbox) -> u64 {
    let mailbox = Some(inbox.email().to_owned());
    match inbox.provider() {
        Provider::Gmail => stack.gmail().inject_fault(gmail_emulator::Fault {
            mailbox,
            route: Some(gmail_emulator::Route::OauthToken),
            delay_ms: Some(1),
            times: Some(1),
            ..gmail_emulator::Fault::default()
        }),
        Provider::Outlook => stack.outlook().inject_fault(outlook_emulator::Fault {
            mailbox,
            route: Some(outlook_emulator::Route::OauthToken),
            delay_ms: Some(1),
            times: Some(1),
            ..outlook_emulator::Fault::default()
        }),
    }
}

/// Whether the provider has served the mailbox a token since
/// [`mark_next_token`] answered `mark`.
fn token_served(stack: &Stack, inbox: &Inbox, mark: u64) -> bool {
    let pending = match inbox.provider() {
        Provider::Gmail => stack.gmail().faults().iter().any(|(id, _)| *id == mark),
        Provider::Outlook => stack.outlook().faults().iter().any(|(id, _)| *id == mark),
    };
    !pending
}

/// The thread's id in Macro once the inbox lists it.
async fn receive(inbox: &Inbox, from: &str, subject: &str) -> Result<String, Report> {
    inbox.deliver(&Mail::new(from, subject, "Hello."))?;
    let preview = inbox.wait_for_preview("inbox", subject).await?;
    Ok(preview["id"].as_str().unwrap_or_default().to_owned())
}

/// Health check: the settings screen asks for every connection to be
/// checked. A healthy connection gets a fresh token from the provider and
/// stays connected; a connection whose grant the user revoked at the
/// provider is reported as needing a reconnect.
///
/// When it fails, the check never reaches the provider, so a revoked
/// connection looks healthy until sync next fails, or it flags a healthy
/// connection for a reconnect.
async fn health_check_tells_healthy_from_revoked(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let bob = stack.user("bob").await?;
    let healthy = ada.link(provider, ada.email()).await?;
    let revoked = bob.link(provider, bob.email()).await?;

    revoked.revoke_grant()?;
    let mark = mark_next_token(&stack, &healthy);

    let accepted = ada.post("/email/links/health-check", None).await?;
    assert_eq!(accepted.status, 202, "{}", accepted.text);
    let accepted = bob.post("/email/links/health-check", None).await?;
    assert_eq!(accepted.status, 202, "{}", accepted.text);

    revoked
        .wait_for_link("the revoked connection to need a reconnect", |link| {
            link["needs_reauth"] == true
        })
        .await?;
    eventually(
        "the health check to fetch a fresh token for the healthy connection",
        DEFAULT_TIMEOUT,
        async || Ok(token_served(&stack, &healthy, mark).then_some(())),
    )
    .await?;
    let link = healthy.link().await?;
    assert_eq!(link["needs_reauth"], false, "{link}");
    assert_eq!(link["is_sync_active"], true, "{link}");

    // The healthy connection still syncs.
    receive(&healthy, "Grace <grace@example.com>", "Still connected").await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_health_check_tells_healthy_from_revoked() -> Result<(), Report> {
    health_check_tells_healthy_from_revoked(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_health_check_tells_healthy_from_revoked() -> Result<(), Report> {
    health_check_tells_healthy_from_revoked(Provider::Outlook).await
}

/// Resync: a thread Macro lost (its rows are gone, the provider still has
/// it) comes back when the user resyncs the inbox, once, next to the
/// threads Macro kept.
///
/// When it fails, resync answers but does not fetch the mailbox again, or
/// fetches it again and duplicates what Macro kept.
async fn resync_brings_back_a_lost_thread(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let kept = receive(&inbox, "Grace <grace@example.com>", "Kept thread").await?;
    let lost = receive(&inbox, "Grace <grace@example.com>", "Lost thread").await?;

    let deleted = sqlx::query("DELETE FROM email_threads WHERE id = $1::uuid")
        .bind(&lost)
        .execute(stack.db())
        .await?
        .rows_affected();
    assert_eq!(deleted, 1);
    let previews = inbox.previews("inbox").await?;
    assert!(
        !previews
            .iter()
            .any(|preview| preview["name"] == "Lost thread"),
        "the lost thread is still listed: {previews:?}"
    );

    let resync = inbox
        .post(&format!("/email/links/{}/resync", inbox.link_id()), None)
        .await?
        .ok()?;
    assert!(
        resync["backfill_job_id"].as_str().is_some(),
        "resync answered no job: {resync}"
    );

    let back = inbox.wait_for_preview("inbox", "Lost thread").await?;
    assert_ne!(
        back["id"],
        lost.as_str(),
        "the lost thread came back with its old id"
    );
    inbox
        .wait_for_link("the resync to finish", |link| {
            link["sync_status"] == "UP_TO_DATE"
        })
        .await?;

    // Mail delivered after the resync still arrives, and nothing is listed
    // twice.
    receive(&inbox, "Grace <grace@example.com>", "After resync").await?;
    let previews = inbox.previews("inbox").await?;
    for subject in ["Kept thread", "Lost thread", "After resync"] {
        let listed = previews
            .iter()
            .filter(|preview| preview["name"] == subject)
            .count();
        assert_eq!(
            listed, 1,
            "{subject} is listed {listed} times: {previews:?}"
        );
    }
    assert!(
        previews
            .iter()
            .any(|preview| preview["id"] == kept.as_str())
    );
    for thread_id in [back["id"].as_str().unwrap_or_default(), kept.as_str()] {
        let thread = inbox.thread(thread_id).await?;
        let messages = thread["messages"].as_array().map_or(0, Vec::len);
        assert_eq!(messages, 1, "{thread}");
    }

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_resync_brings_back_a_lost_thread() -> Result<(), Report> {
    resync_brings_back_a_lost_thread(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_resync_brings_back_a_lost_thread() -> Result<(), Report> {
    resync_brings_back_a_lost_thread(Provider::Outlook).await
}

/// The people the user corresponds with, as the recipient picker lists
/// them, and the inbox's settings: a signature, whether it goes on replies
/// and forwards, and read receipts, saved and read back as the settings
/// screen does.
///
/// The picker lists the people the user wrote to, not everyone who wrote
/// to them.
///
/// When it fails, the picker misses someone the user wrote to or lists a
/// stranger who only wrote in, or a setting is not saved or another one is
/// reset by the save.
async fn correspondents_and_settings(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    receive(&inbox, "Mallory <mallory@example.com>", "Offer inside").await?;
    inbox
        .send(&json!({
            "subject": "Compiler notes",
            "to": [{ "email": "grace@example.com", "name": "Grace Hopper" }],
            "body_text": "Here are my notes.",
        }))
        .await?;
    let link_id = inbox.link_id().to_string();
    let contacts = eventually(
        "the recipient picker to list Grace",
        DEFAULT_TIMEOUT,
        async || {
            let contacts = ada.get("/email/contacts").await?.ok()?;
            let listed = contacts["contacts"][&link_id]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let grace = listed
                .iter()
                .any(|contact| contact["email_address"] == "grace@example.com");
            Ok(grace.then_some(listed))
        },
    )
    .await?;
    let addresses: Vec<&str> = contacts
        .iter()
        .filter_map(|contact| contact["email_address"].as_str())
        .collect();
    assert_eq!(addresses, ["grace@example.com"], "{contacts:?}");
    assert_eq!(contacts[0]["name"], "Grace Hopper", "{contacts:?}");

    let defaults = inbox.link().await?["settings"].clone();
    assert_eq!(defaults["read_receipts_enabled"], true, "{defaults}");

    let signature = "<p>Ada Lovelace</p>";
    inbox
        .patch(
            "/email/settings",
            Some(&json!({ "settings": {
                "signature": signature,
                "signature_on_replies_forwards": false,
            } })),
        )
        .await?
        .ok()?;
    let saved = inbox.link().await?["settings"].clone();
    let saved_signature = saved["signature"].as_str().unwrap_or_default();
    assert!(saved_signature.contains("Ada Lovelace"), "{saved}");
    assert_eq!(saved["signature_on_replies_forwards"], false, "{saved}");
    assert_eq!(saved["read_receipts_enabled"], true, "{saved}");

    // A second save changes only what it names.
    inbox
        .patch(
            "/email/settings",
            Some(&json!({ "settings": { "read_receipts_enabled": false } })),
        )
        .await?
        .ok()?;
    let saved = inbox.link().await?["settings"].clone();
    assert_eq!(saved["read_receipts_enabled"], false, "{saved}");
    assert_eq!(saved["signature"], saved_signature, "{saved}");
    assert_eq!(saved["signature_on_replies_forwards"], false, "{saved}");

    // An empty signature clears it.
    inbox
        .patch(
            "/email/settings",
            Some(&json!({ "settings": { "signature": "" } })),
        )
        .await?
        .ok()?;
    let saved = inbox.link().await?["settings"].clone();
    assert!(
        saved["signature"].as_str().unwrap_or_default().is_empty(),
        "{saved}"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_correspondents_and_settings() -> Result<(), Report> {
    correspondents_and_settings(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_correspondents_and_settings() -> Result<(), Report> {
    correspondents_and_settings(Provider::Outlook).await
}

/// How many rows of the inbox are left in Macro's database.
async fn rows_left(stack: &Stack, link_id: Uuid) -> Result<i64, Report> {
    let left: i64 = sqlx::query_scalar(
        "SELECT (SELECT count(*) FROM email_links WHERE id = $1) \
              + (SELECT count(*) FROM email_threads WHERE link_id = $1) \
              + (SELECT count(*) FROM email_messages WHERE link_id = $1) \
              + (SELECT count(*) FROM email_labels WHERE link_id = $1) \
              + (SELECT count(*) FROM email_contacts WHERE link_id = $1)",
    )
    .bind(link_id)
    .fetch_one(stack.db())
    .await?;
    Ok(left)
}

/// Whether the provider still announces the mailbox's changes to Macro: a
/// Gmail watch, or an Outlook subscription.
fn provider_still_announces(stack: &Stack, inbox: &Inbox) -> bool {
    match inbox.provider() {
        Provider::Gmail => stack
            .gmail()
            .mailboxes()
            .iter()
            .any(|mailbox| mailbox.email == inbox.email() && mailbox.watch_expires_at.is_some()),
        Provider::Outlook => stack
            .outlook()
            .subscriptions()
            .iter()
            .any(|subscription| subscription.mailbox == inbox.email()),
    }
}

/// Turning sync off: the owner of an inbox turns its sync off, and nothing
/// of it is left in Macro: not the connection, its threads, messages,
/// labels or contacts. The provider stops announcing its changes, Macro
/// gives back an Outlook grant, and the mail itself stays at the provider,
/// so linking a Gmail inbox again brings it back.
///
/// When it fails, a disconnected inbox keeps its mail in Macro, keeps a
/// watch, subscription or grant open at the provider, or cannot be linked
/// again.
async fn owner_turns_sync_off(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    receive(&inbox, "Grace <grace@example.com>", "Before sync off").await?;
    assert!(provider_still_announces(&stack, &inbox));
    let at_provider = inbox.provider_messages()?.len();

    let off = inbox.delete("/email/sync", None).await?;
    assert_eq!(off.status, 204, "{}", off.text);

    let link_id = inbox.link_id();
    eventually(
        "the inbox to be gone from Macro",
        DEFAULT_TIMEOUT,
        async || {
            let links = ada.get("/email/links").await?.ok()?;
            let listed = links["links"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|link| link["id"] == link_id.to_string());
            let left = rows_left(&stack, link_id).await?;
            Ok((!listed && left == 0).then_some(()))
        },
    )
    .await?;
    eventually(
        "the provider to stop announcing the mailbox's changes",
        DEFAULT_TIMEOUT,
        async || Ok((!provider_still_announces(&stack, &inbox)).then_some(())),
    )
    .await?;
    let contacts = ada.get("/email/contacts").await?.ok()?;
    if contacts["contacts"].get(link_id.to_string()).is_some() {
        return Err(report!("the contacts still list the inbox: {contacts}"));
    }
    assert_eq!(inbox.provider_messages()?.len(), at_provider);

    if provider == Provider::Outlook {
        // Macro gives its Microsoft grant back. The emulator keeps a mailbox
        // revoked once its last grant is released, and signing in again
        // does not restore it, so linking again is checked on Gmail only.
        eventually(
            "Macro to release its Microsoft grant",
            DEFAULT_TIMEOUT,
            async || {
                let released = stack
                    .outlook()
                    .mailboxes()
                    .iter()
                    .any(|mailbox| mailbox.email == inbox.email() && mailbox.revoked);
                Ok(released.then_some(()))
            },
        )
        .await?;
        return stack.finish().await;
    }

    let again = ada.link(provider, ada.email()).await?;
    assert_ne!(again.link_id(), link_id);
    let preview = again.wait_for_preview("inbox", "Before sync off").await?;
    let listed: Vec<Value> = again.previews("inbox").await?;
    assert_eq!(
        listed
            .iter()
            .filter(|listed| listed["name"] == "Before sync off")
            .count(),
        1,
        "{preview}"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_owner_turns_sync_off() -> Result<(), Report> {
    owner_turns_sync_off(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_owner_turns_sync_off() -> Result<(), Report> {
    owner_turns_sync_off(Provider::Outlook).await
}
