//! Rules about a sender, as the settings screen and a thread's menu set
//! them: marking a sender Noise and taking the rule back, and blocking and
//! unblocking a sender.
//!
//! Signal and Noise are checked in the web app's lists (document storage's
//! item list filtered by importance); blocking at the provider, where it
//! files the sender's next mail away from the inbox.

use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, ProviderMessage, Report, Stack, StackOptions,
    eventually,
};
use serde_json::{Value, json};

const GRACE: &str = "Grace <grace@example.com>";
const MALLORY: &str = "Mallory <mallory@example.com>";

async fn stack_with_lists() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await
}

/// The names of the inbox threads the web app lists as Signal (`true`) or
/// Noise (`false`).
async fn listed(inbox: &Inbox, signal: bool) -> Result<Vec<String>, Report> {
    let page = inbox
        .user()
        .email_list_page(
            &json!({
                "ef": { "l": { "Importance": signal } },
                "emailView": "inbox",
                "limit": 100,
            }),
            None,
        )
        .await?
        .ok()?;
    Ok(page["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["data"]["name"].as_str().map(str::to_owned))
        .collect())
}

/// Waits until the Signal and Noise lists hold exactly these threads.
async fn wait_for_split(inbox: &Inbox, signal: &[&str], noise: &[&str]) -> Result<(), Report> {
    let sorted = |names: &[&str]| {
        let mut names: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
        names.sort();
        names
    };
    let (signal, noise) = (sorted(signal), sorted(noise));
    let mut seen = (Vec::new(), Vec::new());
    let waited = eventually(
        &format!("Signal to list {signal:?} and Noise {noise:?}"),
        DEFAULT_TIMEOUT,
        async || {
            let mut listed_signal = listed(inbox, true).await?;
            let mut listed_noise = listed(inbox, false).await?;
            listed_signal.sort();
            listed_noise.sort();
            let done = listed_signal == signal && listed_noise == noise;
            seen = (listed_signal, listed_noise);
            Ok(done.then_some(()))
        },
    )
    .await;
    waited.map_err(|error| {
        rootcause::report!("{error}; Signal listed {:?}, Noise {:?}", seen.0, seen.1)
    })
}

/// The sender rules `GET /email/filters` lists.
async fn filters(inbox: &Inbox) -> Result<Vec<Value>, Report> {
    let listed = inbox.get("/email/filters").await?.ok()?;
    Ok(listed["filters"].as_array().cloned().unwrap_or_default())
}

/// Marking a sender Noise: the settings screen saves a rule for Grace.
/// Her threads move from Signal to Noise, her next mail lands in Noise,
/// and other senders stay in Signal. Taking the rule back puts all her
/// mail in Signal again.
///
/// When it fails, the rule is saved but the lists do not follow it, it
/// applies only to mail that arrives later, or deleting it leaves her
/// mail in Noise.
async fn noise_rule_round_trip(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_lists().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    for (from, subject) in [
        (GRACE, "Compiler notes"),
        (GRACE, "Lunch on Friday"),
        (MALLORY, "Quarterly figures"),
    ] {
        inbox.deliver(&Mail::new(from, subject, "Hello."))?;
        inbox.wait_for_preview("inbox", subject).await?;
    }
    wait_for_split(
        &inbox,
        &["Compiler notes", "Lunch on Friday", "Quarterly figures"],
        &[],
    )
    .await?;

    let saved = inbox
        .put(
            "/email/filters",
            Some(&json!({ "email_address": "grace@example.com", "is_important": false })),
        )
        .await?
        .ok()?;
    let filter_id = saved["filter"]["id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let rules = filters(&inbox).await?;
    assert_eq!(rules.len(), 1, "{rules:?}");
    assert_eq!(rules[0]["id"], filter_id.as_str());
    assert_eq!(rules[0]["email_address"], "grace@example.com");
    assert_eq!(rules[0]["is_important"], false);

    wait_for_split(
        &inbox,
        &["Quarterly figures"],
        &["Compiler notes", "Lunch on Friday"],
    )
    .await?;
    inbox.deliver(&Mail::new(GRACE, "Weekend plans", "Hello."))?;
    inbox.wait_for_preview("inbox", "Weekend plans").await?;
    wait_for_split(
        &inbox,
        &["Quarterly figures"],
        &["Compiler notes", "Lunch on Friday", "Weekend plans"],
    )
    .await?;

    let deleted = inbox
        .delete(&format!("/email/filters/{filter_id}"), None)
        .await?;
    assert_eq!(deleted.status, 204, "{}", deleted.text);
    assert!(filters(&inbox).await?.is_empty());
    wait_for_split(
        &inbox,
        &[
            "Compiler notes",
            "Lunch on Friday",
            "Quarterly figures",
            "Weekend plans",
        ],
        &[],
    )
    .await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_noise_rule_round_trip() -> Result<(), Report> {
    noise_rule_round_trip(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_noise_rule_round_trip() -> Result<(), Report> {
    noise_rule_round_trip(Provider::Outlook).await
}

/// The senders `GET /email/contacts/blocked` lists, read from the provider.
async fn blocked(inbox: &Inbox) -> Result<Vec<String>, Report> {
    let listed = inbox.get("/email/contacts/blocked").await?.ok()?;
    Ok(listed["blocked_emails"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|address| address.as_str().map(str::to_owned))
        .collect())
}

async fn wait_blocked(inbox: &Inbox, sender: &str, is_blocked: bool) -> Result<(), Report> {
    let state = if is_blocked { "list" } else { "stop listing" };
    eventually(
        &format!("the blocked senders to {state} {sender}"),
        DEFAULT_TIMEOUT,
        async || {
            let listed = blocked(inbox)
                .await?
                .iter()
                .any(|address| address == sender);
            Ok((listed == is_blocked).then_some(()))
        },
    )
    .await
}

/// Whether the provider's own inbox shows the message: Gmail hides mail in
/// Trash or Spam whatever labels it keeps; an Outlook message is in the
/// Inbox folder or not.
fn in_provider_inbox(message: &ProviderMessage, provider: Provider) -> bool {
    let filed_away = provider == Provider::Gmail
        && message
            .labels
            .iter()
            .any(|label| label == "TRASH" || label == "SPAM");
    message.in_inbox && !filed_away
}

/// Blocking a sender: Ada blocks Mallory. The provider holds the block,
/// so Mallory's next mail is filed away from the inbox there and Macro's
/// inbox does not list it, while other mail still arrives. Unblocking lets
/// Mallory's mail into the inbox again.
///
/// When it fails, the block is only in Macro (other mail clients still
/// show Mallory's mail), the blocked list does not show it, or unblocking
/// leaves the provider filtering Mallory's mail.
async fn block_and_unblock_a_sender(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_lists().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    inbox.deliver(&Mail::new(MALLORY, "First offer", "Hello."))?;
    inbox.wait_for_preview("inbox", "First offer").await?;
    assert!(blocked(&inbox).await?.is_empty());

    inbox
        .post(
            "/email/contacts/block",
            Some(&json!({ "email_address": "mallory@example.com" })),
        )
        .await?
        .ok()?;
    wait_blocked(&inbox, "mallory@example.com", true).await?;

    let filtered = inbox.deliver(&Mail::new(MALLORY, "Second offer", "Hello."))?;
    assert!(
        !in_provider_inbox(&filtered, provider),
        "the provider put the blocked sender's mail in the inbox: {filtered:?}"
    );
    // Mail from someone else arrives after it, so Macro has seen both.
    inbox.deliver(&Mail::new(GRACE, "Compiler notes", "Hello."))?;
    inbox.wait_for_preview("inbox", "Compiler notes").await?;
    let previews = inbox.previews("inbox").await?;
    assert!(
        !previews
            .iter()
            .any(|preview| preview["name"] == "Second offer"),
        "the inbox lists the blocked sender's mail: {previews:?}"
    );

    inbox
        .post(
            "/email/contacts/unblock",
            Some(&json!({ "email_address": "mallory@example.com" })),
        )
        .await?
        .ok()?;
    wait_blocked(&inbox, "mallory@example.com", false).await?;

    let delivered = inbox.deliver(&Mail::new(MALLORY, "Third offer", "Hello."))?;
    assert!(
        in_provider_inbox(&delivered, provider),
        "the provider still filters the unblocked sender: {delivered:?}"
    );
    inbox.wait_for_preview("inbox", "Third offer").await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_block_and_unblock_a_sender() -> Result<(), Report> {
    block_and_unblock_a_sender(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_block_and_unblock_a_sender() -> Result<(), Report> {
    block_and_unblock_a_sender(Provider::Outlook).await
}
