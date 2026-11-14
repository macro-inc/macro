//! Access tokens and grants: expiry, revocation, reconnecting, and one
//! user's inboxes each using their own grant.

use email_e2e::{DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, User, eventually};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

/// The queue the link jobs (refresh, delete) travel on.
const LINK_MANAGER: &str = "link-manager";
/// How long a queue keeps a job that failed before delivering it again.
const VISIBILITY_TIMEOUT: Duration = Duration::from_secs(60);
/// The queues whose jobs call the provider for an inbox.
const PROVIDER_QUEUES: [&str; 5] = [
    "gmail-inbox-sync",
    "gmail-inbox-sync-retry",
    "gmail-ops",
    "gmail-ops-retry",
    LINK_MANAGER,
];

/// A message from Grace with this subject.
fn mail(subject: &str) -> Mail {
    Mail::new(
        "Grace <grace@example.com>",
        subject,
        &format!("About {subject}."),
    )
}

/// One request the provider answered: the mailbox it was for (unknown when
/// the token was refused), the route, and the status.
struct ProviderCall {
    mailbox: Option<String>,
    route: String,
    status: u16,
}

/// Everything the provider was asked so far.
fn provider_calls(stack: &Stack, provider: Provider) -> Vec<ProviderCall> {
    match provider {
        Provider::Gmail => stack
            .gmail()
            .requests()
            .into_iter()
            .map(|request| ProviderCall {
                mailbox: request.mailbox,
                route: request
                    .route
                    .map(|route| route.to_string())
                    .unwrap_or_default(),
                status: request.status,
            })
            .collect(),
        Provider::Outlook => stack
            .outlook()
            .requests()
            .into_iter()
            .map(|request| ProviderCall {
                mailbox: request.mailbox,
                route: request
                    .route
                    .map(|route| route.to_string())
                    .unwrap_or_default(),
                status: request.status,
            })
            .collect(),
    }
}

/// How many calls the provider refused for their access token.
fn refused_tokens(stack: &Stack, provider: Provider) -> usize {
    provider_calls(stack, provider)
        .iter()
        .filter(|call| call.status == 401 && call.route != "oauth.token")
        .count()
}

/// How many access tokens were handed out for a mailbox. Only Outlook's are
/// in the provider's log; Gmail's come from the authentication stand-in's
/// control route, which is not logged.
fn tokens_issued(stack: &Stack, inbox: &Inbox) -> usize {
    provider_calls(stack, inbox.provider())
        .iter()
        .filter(|call| {
            call.mailbox.as_deref() == Some(inbox.email())
                && call.route == "oauth.token"
                && call.status == 200
        })
        .count()
}

/// How many calls of a route the provider answered with success for a mailbox.
fn answered(stack: &Stack, inbox: &Inbox, route: &str) -> usize {
    provider_calls(stack, inbox.provider())
        .iter()
        .filter(|call| {
            call.mailbox.as_deref() == Some(inbox.email())
                && call.route == route
                && call.status < 300
        })
        .count()
}

/// The user consents again at the provider, as the reconnect prompt makes
/// them do: a revoked grant is replaced by a new one.
async fn consent_again(stack: &Stack, inbox: &Inbox) -> Result<(), Report> {
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let (url, scope) = match inbox.provider() {
        Provider::Gmail => (
            stack.gmail().authorization_url(),
            "https://www.googleapis.com/auth/gmail.modify",
        ),
        Provider::Outlook => (
            format!(
                "{}/common/oauth2/v2.0/authorize",
                stack.outlook().base_url()
            ),
            "https://graph.microsoft.com/Mail.ReadWrite offline_access",
        ),
    };
    let form = [
        ("client_id", "macro"),
        ("redirect_uri", "http://127.0.0.1:9/callback"),
        ("response_type", "code"),
        ("scope", scope),
        ("user", inbox.email()),
        ("granted", scope),
    ]
    .iter()
    .map(|(name, value)| format!("{name}={}", urlencoding::encode(value)))
    .collect::<Vec<_>>()
    .join("&");
    let answered = http
        .post(url)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form)
        .send()
        .await?;
    assert_eq!(
        answered.status().as_u16(),
        303,
        "the provider did not accept the consent for {}",
        inbox.email()
    );
    Ok(())
}

/// The subjects of an inbox's threads in a view, sorted.
async fn subjects(inbox: &Inbox, view: &str) -> Result<Vec<String>, Report> {
    let mut subjects: Vec<String> = inbox
        .previews(view)
        .await?
        .iter()
        .filter_map(|preview| preview["name"].as_str().map(str::to_owned))
        .collect();
    subjects.sort();
    Ok(subjects)
}

/// The addresses `GET /email/links` lists for a user, sorted.
async fn listed_addresses(user: &User) -> Result<Vec<String>, Report> {
    let listed = user.get("/email/links").await?.ok()?;
    let mut addresses: Vec<String> = listed["links"]
        .as_array()
        .map(|links| {
            links
                .iter()
                .filter_map(|link| link["email_address"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    addresses.sort();
    Ok(addresses)
}

/// Marks a thread read as the user does by opening it, and waits until the
/// provider's copy of its message is read too.
async fn read_thread(inbox: &Inbox, preview: &Value, subject: &str) -> Result<(), Report> {
    let thread = preview["id"].as_str().unwrap_or_default();
    inbox
        .patch(
            &format!("/email/threads/{thread}/state"),
            Some(&json!({ "field": "read", "value": true })),
        )
        .await?
        .ok()?;
    inbox
        .wait_for_provider_message(
            &format!("{subject:?} to be read at the provider"),
            |message| message.subject == subject && message.read,
        )
        .await?;
    Ok(())
}

/// Waits until a queue holds nothing, visible or in flight: every job sent
/// so far was handled and deleted, none is being retried.
async fn wait_until_handled(stack: &Stack, queue: &str) -> Result<(), Report> {
    eventually(
        &format!("the {queue} jobs to be handled and deleted"),
        DEFAULT_TIMEOUT,
        async || Ok((stack.queue_depth(queue).await? == 0).then_some(())),
    )
    .await
}

/// Every job that calls the provider was handled and deleted, and none was
/// given up on. Waits for the queues to empty first: a job that is still
/// being retried has not been given up on yet.
async fn assert_nothing_dead_lettered(stack: &Stack) -> Result<(), Report> {
    for queue in PROVIDER_QUEUES {
        wait_until_handled(stack, queue).await?;
    }
    for queue in PROVIDER_QUEUES {
        assert_eq!(
            stack.dead_letters(queue).await?,
            0,
            "{queue} dead-lettered a job"
        );
    }
    Ok(())
}

/// When the provider's access tokens expire, incoming mail keeps arriving
/// and the user's actions keep reaching the provider: the expired token is
/// replaced, and the inbox never asks to be reconnected. When this fails, an
/// inbox goes quiet or demands a reconnect about an hour after it was linked.
async fn sync_and_actions_survive_token_expiry(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    inbox.deliver(&mail("Before expiry"))?;
    let before = inbox.wait_for_preview("inbox", "Before expiry").await?;
    assert_eq!(refused_tokens(&stack, provider), 0);
    let issued = tokens_issued(&stack, &inbox);

    inbox.expire_access_tokens();
    inbox.deliver(&mail("After expiry"))?;
    inbox.wait_for_preview("inbox", "After expiry").await?;
    read_thread(&inbox, &before, "Before expiry").await?;

    match provider {
        // Gmail refuses the cached token once; the call is made again with
        // a new one.
        Provider::Gmail => assert!(refused_tokens(&stack, provider) >= 1),
        // Outlook's tokens come from the authentication service, which
        // renews them: the calls after the expiry were made with new ones.
        Provider::Outlook => assert!(tokens_issued(&stack, &inbox) > issued),
    }
    let link = inbox.link().await?;
    assert_eq!(link["needs_reauth"], false, "{link}");
    assert_eq!(link["sync_status"], "UP_TO_DATE", "{link}");
    assert_eq!(
        subjects(&inbox, "inbox").await?,
        ["After expiry", "Before expiry"]
    );
    assert_nothing_dead_lettered(&stack).await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_sync_and_actions_survive_token_expiry() -> Result<(), Report> {
    sync_and_actions_survive_token_expiry(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_sync_and_actions_survive_token_expiry() -> Result<(), Report> {
    sync_and_actions_survive_token_expiry(Provider::Outlook).await
}

/// When the user removes Macro's access at the provider, the next sync
/// notices: the inbox reports `NEEDS_REAUTH` (for Gmail this takes a second
/// call with a fresh token after the cached one is refused), and no job is
/// dead-lettered over it. Consenting again and linking the same address
/// restores the same inbox: the mail that arrived while access was gone and
/// later mail both show, once. When this fails, a revoked inbox looks healthy
/// and silently stops, or reconnecting it loses or duplicates mail.
async fn revoked_grant_asks_for_a_reconnect_that_restores_sync(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    inbox.deliver(&mail("Before"))?;
    inbox.wait_for_preview("inbox", "Before").await?;

    inbox.revoke_grant()?;
    inbox.deliver(&mail("While revoked"))?;
    let link = inbox
        .wait_for_link("the inbox to ask for a reconnect", |link| {
            link["needs_reauth"] == true
        })
        .await?;
    assert_eq!(link["sync_status"], "NEEDS_REAUTH", "{link}");
    assert_eq!(subjects(&inbox, "inbox").await?, ["Before"]);
    assert_nothing_dead_lettered(&stack).await?;

    consent_again(&stack, &inbox).await?;
    let again = ada.start_link(provider, ada.email()).await?;
    assert_eq!(again.link_id(), inbox.link_id());
    again
        .wait_for_link("the reconnected inbox to be healthy", |link| {
            link["needs_reauth"] == false && link["sync_status"] == "UP_TO_DATE"
        })
        .await?;
    again.wait_until_synced().await?;
    again.deliver(&mail("After reconnect"))?;
    again.wait_for_preview("inbox", "After reconnect").await?;
    again.wait_for_preview("inbox", "While revoked").await?;

    assert_eq!(
        subjects(&again, "inbox").await?,
        ["After reconnect", "Before", "While revoked"]
    );
    assert_eq!(listed_addresses(&ada).await?, [ada.email()]);
    assert_nothing_dead_lettered(&stack).await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_revoked_grant_asks_for_a_reconnect_that_restores_sync() -> Result<(), Report> {
    revoked_grant_asks_for_a_reconnect_that_restores_sync(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_revoked_grant_asks_for_a_reconnect_that_restores_sync() -> Result<(), Report> {
    revoked_grant_asks_for_a_reconnect_that_restores_sync(Provider::Outlook).await
}

/// The periodic refresh of an inbox whose grant was revoked, with no mail
/// arriving to reveal it: the refresh job marks the inbox `NEEDS_REAUTH` and
/// leaves its queue sooner than a failed job could have come back (the 60 s
/// visibility timeout); a refresh of the marked inbox leaves the queue too,
/// without asking Gmail for a watch, and nothing dead-letters. When this
/// fails, a revoked inbox stays "healthy" until mail arrives, or its refresh
/// job fails and is retried.
#[tokio::test(flavor = "multi_thread")]
async fn refresh_job_marks_a_revoked_gmail_grant_and_is_not_retried() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;
    let side = ada.link(Provider::Gmail, "ada.side@example.com").await?;
    let refresh = json!({ "operation": "Refresh", "link_id": inbox.link_id() });

    // A refresh of a healthy inbox renews its watch and changes nothing.
    stack.send_to_queue(LINK_MANAGER, &refresh).await?;
    eventually(
        "the refresh to renew the Gmail watch",
        DEFAULT_TIMEOUT,
        async || Ok((answered(&stack, &inbox, "watch") == 2).then_some(())),
    )
    .await?;
    wait_until_handled(&stack, LINK_MANAGER).await?;
    assert_eq!(inbox.link().await?["needs_reauth"], false);

    inbox.revoke_grant()?;
    let sent = Instant::now();
    stack.send_to_queue(LINK_MANAGER, &refresh).await?;
    let link = inbox
        .wait_for_link("the refresh to ask for a reconnect", |link| {
            link["needs_reauth"] == true
        })
        .await?;
    assert_eq!(link["sync_status"], "NEEDS_REAUTH", "{link}");
    wait_until_handled(&stack, LINK_MANAGER).await?;
    // A job that failed stays in its queue until it is delivered again.
    let handled_in = sent.elapsed();
    assert!(
        handled_in < VISIBILITY_TIMEOUT,
        "the refresh left its queue after {handled_in:?}: it was retried"
    );

    stack.send_to_queue(LINK_MANAGER, &refresh).await?;
    side.deliver(&mail("Side still syncs"))?;
    side.wait_for_preview("inbox", "Side still syncs").await?;
    wait_until_handled(&stack, LINK_MANAGER).await?;

    assert_eq!(answered(&stack, &inbox, "watch"), 2);
    assert_eq!(inbox.link().await?["needs_reauth"], true);
    let other = side.link().await?;
    assert_eq!(other["needs_reauth"], false, "{other}");
    assert_eq!(other["sync_status"], "UP_TO_DATE", "{other}");
    assert_nothing_dead_lettered(&stack).await?;

    stack.finish().await
}

/// The health check the client asks for when the user opens the app finds a
/// revoked grant without waiting for mail: the inbox reports `NEEDS_REAUTH`.
/// When this fails, the reconnect prompt only appears after mail fails to
/// arrive.
async fn health_check_finds_a_revoked_grant(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.revoke_grant()?;
    let checked = ada.post("/email/links/health-check", None).await?;
    assert_eq!(checked.status, 202, "{}", checked.text);
    let link = inbox
        .wait_for_link("the health check to ask for a reconnect", |link| {
            link["needs_reauth"] == true
        })
        .await?;
    assert_eq!(link["sync_status"], "NEEDS_REAUTH", "{link}");
    wait_until_handled(&stack, LINK_MANAGER).await?;
    assert_nothing_dead_lettered(&stack).await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_health_check_finds_a_revoked_grant() -> Result<(), Report> {
    health_check_finds_a_revoked_grant(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_health_check_finds_a_revoked_grant() -> Result<(), Report> {
    health_check_finds_a_revoked_grant(Provider::Outlook).await
}

/// Whether the provider still announces changes of a mailbox to Macro: the
/// Gmail watch, or a Graph subscription.
fn provider_announces_changes(stack: &Stack, inbox: &Inbox) -> bool {
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

/// Whether the grant for a mailbox is revoked at the provider.
fn grant_is_revoked(stack: &Stack, inbox: &Inbox) -> bool {
    match inbox.provider() {
        Provider::Gmail => stack
            .gmail()
            .mailboxes()
            .iter()
            .any(|mailbox| mailbox.email == inbox.email() && mailbox.revoked),
        Provider::Outlook => stack
            .outlook()
            .mailboxes()
            .iter()
            .any(|mailbox| mailbox.email == inbox.email() && mailbox.revoked),
    }
}

/// Puts a mailbox holding one message at the provider, before it is linked.
fn seed_mailbox(
    stack: &Stack,
    provider: Provider,
    address: &str,
    subject: &str,
) -> Result<(), Report> {
    match provider {
        Provider::Gmail => stack
            .gmail()
            .add_mailbox(&email_e2e::gmail_emulator::SeedMailbox {
                email: address.to_owned(),
                messages: vec![email_e2e::gmail_emulator::NewMessage {
                    from: Some("Grace <grace@example.com>".to_owned()),
                    subject: Some(subject.to_owned()),
                    text: Some(format!("About {subject}.")),
                    ..Default::default()
                }],
                ..Default::default()
            })?,
        Provider::Outlook => {
            stack
                .outlook()
                .add_mailbox(&email_e2e::outlook_emulator::SeedMailbox {
                    email: address.to_owned(),
                    messages: vec![email_e2e::outlook_emulator::NewMessage {
                        from: Some("Grace <grace@example.com>".to_owned()),
                        subject: Some(subject.to_owned()),
                        text: Some(format!("About {subject}.")),
                        ..Default::default()
                    }],
                    ..Default::default()
                })?
        }
    }
    Ok(())
}

/// One user's two inboxes each act with their own grant: each imports only
/// its own mailbox, an action in one reaches only that mailbox, and removing
/// the second leaves the first syncing, still able to renew its token, with
/// its watch and grant untouched. When this fails, the second inbox shows
/// the first mailbox's mail, or removing one inbox disconnects the other.
async fn each_inbox_of_a_user_uses_its_own_grant(
    first: Provider,
    second: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let side_address = "ada.side@example.com";
    seed_mailbox(&stack, first, ada.email(), "Main only")?;
    seed_mailbox(&stack, second, side_address, "Side only")?;

    let main_inbox = ada.link(first, ada.email()).await?;
    let side = ada.link(second, side_address).await?;
    main_inbox.wait_for_preview("inbox", "Main only").await?;
    let side_preview = side.wait_for_preview("inbox", "Side only").await?;
    assert_eq!(subjects(&main_inbox, "all").await?, ["Main only"]);
    assert_eq!(subjects(&side, "all").await?, ["Side only"]);

    read_thread(&side, &side_preview, "Side only").await?;
    main_inbox.deliver(&mail("Main later"))?;
    main_inbox.wait_for_preview("inbox", "Main later").await?;
    let main_read: Vec<String> = main_inbox
        .provider_messages()?
        .into_iter()
        .filter(|message| message.read)
        .map(|message| message.subject)
        .collect();
    assert!(main_read.is_empty(), "{main_read:?}");
    assert_eq!(subjects(&side, "all").await?, ["Side only"]);

    let removed = ada
        .delete(&format!("/email/links/{}", side.link_id()), None)
        .await?;
    assert_eq!(removed.status, 204, "{}", removed.text);
    eventually(
        "the removed inbox to be gone",
        DEFAULT_TIMEOUT,
        async || Ok((listed_addresses(&ada).await? == [ada.email()]).then_some(())),
    )
    .await?;
    wait_until_handled(&stack, LINK_MANAGER).await?;

    main_inbox.expire_access_tokens();
    main_inbox.deliver(&mail("After the removal"))?;
    main_inbox
        .wait_for_preview("inbox", "After the removal")
        .await?;
    assert_eq!(
        subjects(&main_inbox, "inbox").await?,
        ["After the removal", "Main later", "Main only"]
    );
    let link = main_inbox.link().await?;
    assert_eq!(link["needs_reauth"], false, "{link}");
    assert_eq!(link["sync_status"], "UP_TO_DATE", "{link}");
    assert!(provider_announces_changes(&stack, &main_inbox));
    assert!(!grant_is_revoked(&stack, &main_inbox));
    assert!(!provider_announces_changes(&stack, &side));
    assert_nothing_dead_lettered(&stack).await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn two_gmail_inboxes_of_a_user_each_use_their_own_grant() -> Result<(), Report> {
    each_inbox_of_a_user_uses_its_own_grant(Provider::Gmail, Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn a_gmail_and_an_outlook_inbox_of_a_user_each_use_their_own_grant() -> Result<(), Report> {
    each_inbox_of_a_user_uses_its_own_grant(Provider::Gmail, Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn an_outlook_and_a_gmail_inbox_of_a_user_each_use_their_own_grant() -> Result<(), Report> {
    each_inbox_of_a_user_uses_its_own_grant(Provider::Outlook, Provider::Gmail).await
}

/// The change subscription Outlook holds for the mailbox, once Macro has
/// made one that `known` does not name.
async fn wait_for_subscription(
    stack: &Stack,
    inbox: &Inbox,
    known: Option<&str>,
) -> Result<email_e2e::outlook_emulator::SubscriptionSummary, Report> {
    eventually(
        "Macro to subscribe to the mailbox's changes",
        DEFAULT_TIMEOUT,
        async || {
            Ok(stack
                .outlook()
                .subscriptions()
                .into_iter()
                .find(|subscription| {
                    subscription.mailbox == inbox.email() && Some(subscription.id.as_str()) != known
                }))
        },
    )
    .await
}

/// Outlook asks Macro to renew its change subscription (the
/// `reauthorizationRequired` lifecycle event): Macro extends the
/// subscription it has, without opening another. When Outlook tells Macro
/// it removed the subscription, Macro opens a new one, and mail still
/// arrives. When this fails the subscription lapses or stays gone, and new
/// mail only shows at the next poll.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_subscription_is_renewed_when_outlook_asks() -> Result<(), Report> {
    use email_e2e::outlook_emulator::LifecycleEvent;

    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;
    let subscription = wait_for_subscription(&stack, &inbox, None).await?;
    let renewed_before = answered(&stack, &inbox, "subscriptions.update");
    let created_before = answered(&stack, &inbox, "subscriptions.create");

    stack
        .outlook()
        .send_lifecycle(&subscription.id, LifecycleEvent::ReauthorizationRequired)?;
    eventually(
        "Macro to renew the subscription Outlook asked it to renew",
        DEFAULT_TIMEOUT,
        async || {
            Ok((answered(&stack, &inbox, "subscriptions.update") > renewed_before).then_some(()))
        },
    )
    .await?;
    let held: Vec<_> = stack
        .outlook()
        .subscriptions()
        .into_iter()
        .filter(|held| held.mailbox == inbox.email())
        .collect();
    assert_eq!(held.len(), 1, "{held:?}");
    assert_eq!(held[0].id, subscription.id, "the subscription was replaced");
    assert!(
        held[0].expires_at >= subscription.expires_at,
        "the renewal shortened the subscription: {held:?}"
    );
    assert_eq!(
        answered(&stack, &inbox, "subscriptions.create"),
        created_before
    );
    inbox.deliver(&mail("After the renewal"))?;
    inbox.wait_for_preview("inbox", "After the renewal").await?;

    // Outlook drops the subscription and says so.
    stack
        .outlook()
        .send_lifecycle(&subscription.id, LifecycleEvent::SubscriptionRemoved)?;
    let replacement = wait_for_subscription(&stack, &inbox, Some(&subscription.id)).await?;
    assert_eq!(replacement.resource, subscription.resource);
    inbox.deliver(&mail("After the replacement"))?;
    inbox
        .wait_for_preview("inbox", "After the replacement")
        .await?;
    let link = inbox.link().await?;
    assert_eq!(link["needs_reauth"], false, "{link}");
    assert_eq!(link["sync_status"], "UP_TO_DATE", "{link}");

    stack.finish().await
}
