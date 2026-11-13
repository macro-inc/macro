//! Linking and unlinking inboxes: what `POST /email/init` accepts and
//! refuses, what `GET /email/links` reports, and what removing an inbox
//! leaves behind.

#![expect(
    clippy::disallowed_methods,
    reason = "test support: the scenarios seed sign-in rows and read rows the API does not show"
)]

use email_e2e::{
    ApiResponse, DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, User, eventually,
    gmail_emulator, outlook_emulator,
};
use serde_json::{Value, json};
use uuid::Uuid;

/// The scope every Gmail inbox is linked with.
const GMAIL_SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";
/// The two scopes that together are Macro's calendar capability.
const CALENDAR_SCOPES: [&str; 2] = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
/// The single broad calendar scope Macro asked for before it narrowed to the
/// two above.
const LEGACY_CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar";
/// The queue the link jobs (delete, refresh) travel on.
const LINK_MANAGER: &str = "link-manager";

/// A message from Grace with this subject.
fn mail(subject: &str) -> Mail {
    Mail::new(
        "Grace <grace@example.com>",
        subject,
        &format!("About {subject}."),
    )
}

/// Puts a mailbox holding one message per subject at the provider, before
/// anyone links it.
fn seed_mailbox(
    stack: &Stack,
    provider: Provider,
    address: &str,
    subjects: &[String],
) -> Result<(), Report> {
    match provider {
        Provider::Gmail => stack.gmail().add_mailbox(&gmail_emulator::SeedMailbox {
            email: address.to_owned(),
            messages: subjects
                .iter()
                .map(|subject| gmail_emulator::NewMessage {
                    from: Some("Grace <grace@example.com>".to_owned()),
                    subject: Some(subject.clone()),
                    text: Some(format!("About {subject}.")),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        })?,
        Provider::Outlook => stack
            .outlook()
            .add_mailbox(&outlook_emulator::SeedMailbox {
                email: address.to_owned(),
                messages: subjects
                    .iter()
                    .map(|subject| outlook_emulator::NewMessage {
                        from: Some("Grace <grace@example.com>".to_owned()),
                        subject: Some(subject.clone()),
                        text: Some(format!("About {subject}.")),
                        ..Default::default()
                    })
                    .collect(),
                ..Default::default()
            })?,
    }
    Ok(())
}

/// Whether the provider has a mailbox with this address.
fn mailbox_exists(stack: &Stack, provider: Provider, address: &str) -> bool {
    match provider {
        Provider::Gmail => stack
            .gmail()
            .mailboxes()
            .iter()
            .any(|mailbox| mailbox.email == address),
        Provider::Outlook => stack
            .outlook()
            .mailboxes()
            .iter()
            .any(|mailbox| mailbox.email == address),
    }
}

/// Finishes a sign-in at the provider for `address` the way the
/// authentication service records it, and returns the attempt's id: what the
/// client passes to `POST /email/init`. The mailbox is created empty unless
/// it exists.
async fn sign_in(
    stack: &Stack,
    user: &User,
    provider: Provider,
    address: &str,
    granted_scopes: &[&str],
) -> Result<Uuid, Report> {
    let attempt = Uuid::now_v7();
    if !mailbox_exists(stack, provider, address) {
        seed_mailbox(stack, provider, address, &[])?;
    }
    if provider == Provider::Outlook {
        stack
            .outlook()
            .link_mailbox(&attempt.to_string(), address)?;
    }
    let scopes: Vec<String> = granted_scopes
        .iter()
        .map(|scope| (*scope).to_owned())
        .collect();
    sqlx::query(
        "INSERT INTO in_progress_user_link \
             (id, macro_user_id, linked_email, email_provider, requested_google_scopes, granted_google_scopes) \
         VALUES ($1, $2, $3, $4::email_user_provider_enum, $5, $5)",
    )
    .bind(attempt)
    .bind(user.fusion_id())
    .bind(address)
    .bind(provider.as_str())
    .bind(scopes)
    .execute(stack.db())
    .await?;
    Ok(attempt)
}

/// The scopes a plain mail sign-in grants at a provider.
fn mail_scopes(provider: Provider) -> &'static [&'static str] {
    match provider {
        Provider::Gmail => &[GMAIL_SCOPE],
        Provider::Outlook => &[],
    }
}

/// `POST /email/init` for a finished sign-in, as the client calls it.
async fn init(user: &User, attempt: Uuid) -> Result<ApiResponse, Report> {
    user.post(&format!("/email/init?link_id={attempt}"), None)
        .await
}

/// The user consents again at the provider, as a reconnect makes them do: a
/// grant that was revoked is replaced by a new one.
async fn consent_again(stack: &Stack, provider: Provider, address: &str) -> Result<(), Report> {
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let (url, scope) = match provider {
        Provider::Gmail => (stack.gmail().authorization_url(), GMAIL_SCOPE),
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
        ("user", address),
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
        "the provider did not accept the consent for {address}"
    );
    Ok(())
}

/// The inboxes `GET /email/links` lists for a user.
async fn listed_links(user: &User) -> Result<Vec<Value>, Report> {
    let listed = user.get("/email/links").await?.ok()?;
    Ok(listed["links"].as_array().cloned().unwrap_or_default())
}

/// The addresses `GET /email/links` lists for a user, sorted.
async fn listed_addresses(user: &User) -> Result<Vec<String>, Report> {
    let mut addresses: Vec<String> = listed_links(user)
        .await?
        .iter()
        .filter_map(|link| link["email_address"].as_str().map(str::to_owned))
        .collect();
    addresses.sort();
    Ok(addresses)
}

/// The subjects of a user's threads in a view, with the inbox each is in.
async fn subjects_by_link(user: &User, view: &str) -> Result<Vec<(String, String)>, Report> {
    let listed = user
        .get(&format!("/email/threads/previews/cursor/{view}?limit=500"))
        .await?
        .ok()?;
    let mut subjects: Vec<(String, String)> = listed["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    (
                        item["linkId"].as_str().unwrap_or_default().to_owned(),
                        item["name"].as_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    subjects.sort();
    Ok(subjects)
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

/// Removes an inbox as its user does in settings.
async fn unlink(inbox: &Inbox) -> Result<(), Report> {
    let answered = inbox
        .user()
        .delete(&format!("/email/links/{}", inbox.link_id()), None)
        .await?;
    assert_eq!(answered.status, 204, "unlinking answered {}", answered.text);
    Ok(())
}

/// Right after an unlink the inbox is either gone from `GET /email/links` or
/// listed as no longer syncing; it stays listed until its purge is complete.
async fn assert_stopped(inbox: &Inbox) -> Result<(), Report> {
    let link = inbox.link().await?;
    assert!(
        link.is_null() || link["is_sync_active"] == false,
        "the unlinked inbox still syncs: {link}"
    );
    Ok(())
}

/// How many rows of a table belong to a link.
async fn rows_of_link(stack: &Stack, table: &str, link_id: Uuid) -> Result<i64, Report> {
    let column = if table == "email_links" {
        "id"
    } else {
        "link_id"
    };
    let count: i64 =
        sqlx::query_scalar(&format!("SELECT count(*) FROM {table} WHERE {column} = $1"))
            .bind(link_id)
            .fetch_one(stack.db())
            .await?;
    Ok(count)
}

/// How many links exist for a mailbox address, whoever owns them.
async fn links_for_address(stack: &Stack, address: &str) -> Result<i64, Report> {
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM email_links WHERE email_address = $1")
            .bind(address)
            .fetch_one(stack.db())
            .await?;
    Ok(count)
}

/// How many unfinished sign-ins a user has.
async fn open_sign_ins(stack: &Stack, user: &User) -> Result<i64, Report> {
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM in_progress_user_link WHERE macro_user_id = $1")
            .bind(user.fusion_id())
            .fetch_one(stack.db())
            .await?;
    Ok(count)
}

/// Waits until the link's row is gone: the purge that follows an unlink is
/// complete.
async fn wait_until_purged(stack: &Stack, link_id: Uuid) -> Result<(), Report> {
    eventually(
        "the unlinked inbox to be purged",
        DEFAULT_TIMEOUT,
        async || Ok((rows_of_link(stack, "email_links", link_id).await? == 0).then_some(())),
    )
    .await
}

/// Waits until the link jobs queue holds nothing, visible or in flight:
/// every job sent so far was handled and deleted, none is being retried.
async fn wait_until_link_jobs_are_done(stack: &Stack) -> Result<(), Report> {
    eventually(
        "the link jobs to be handled and deleted",
        DEFAULT_TIMEOUT,
        async || Ok((stack.queue_depth(LINK_MANAGER).await? == 0).then_some(())),
    )
    .await
}

/// Whether the provider still announces changes of a mailbox to Macro: the
/// Gmail watch, or a Graph subscription.
fn provider_announces_changes(stack: &Stack, provider: Provider, address: &str) -> bool {
    match provider {
        Provider::Gmail => stack
            .gmail()
            .mailboxes()
            .iter()
            .any(|mailbox| mailbox.email == address && mailbox.watch_expires_at.is_some()),
        Provider::Outlook => stack
            .outlook()
            .subscriptions()
            .iter()
            .any(|subscription| subscription.mailbox == address),
    }
}

/// How many requests of one route a mailbox's provider answered with success.
fn provider_calls(stack: &Stack, provider: Provider, address: &str, route: &str) -> usize {
    match provider {
        Provider::Gmail => stack
            .gmail()
            .requests()
            .iter()
            .filter(|request| {
                request.mailbox.as_deref() == Some(address)
                    && request.route.is_some_and(|name| name.to_string() == route)
                    && request.status < 300
            })
            .count(),
        Provider::Outlook => stack
            .outlook()
            .requests()
            .iter()
            .filter(|request| {
                request.mailbox.as_deref() == Some(address)
                    && request.route.is_some_and(|name| name.to_string() == route)
                    && request.status < 300
            })
            .count(),
    }
}

/// Gives a user the paid plan.
async fn subscribe(stack: &Stack, user: &User) -> Result<(), Report> {
    sqlx::query(
        r#"INSERT INTO "RolesOnUsers" ("userId", "roleId") VALUES ($1, 'professional_subscriber')"#,
    )
    .bind(user.macro_id())
    .execute(stack.db())
    .await?;
    Ok(())
}

/// A linked inbox is listed with its provider and address, reaches
/// `UP_TO_DATE`, shows the mail the mailbox already held, and has the
/// provider announce changes (Gmail `users.watch`, a Graph subscription).
/// When this fails, a connected inbox is missing from settings, stays
/// "syncing" forever, or never hears of new mail.
async fn linked_inbox_is_listed(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let held = ["Standup notes".to_owned(), "Invoice 14".to_owned()];
    seed_mailbox(&stack, provider, ada.email(), &held)?;

    assert!(listed_links(&ada).await?.is_empty());
    assert!(!provider_announces_changes(&stack, provider, ada.email()));
    let inbox = ada.link(provider, ada.email()).await?;

    let links = listed_links(&ada).await?;
    assert_eq!(links.len(), 1, "{links:?}");
    let link = &links[0];
    assert_eq!(link["id"], inbox.link_id().to_string());
    assert_eq!(link["provider"], provider.as_str());
    assert_eq!(link["email_address"], ada.email());
    assert_eq!(link["sync_status"], "UP_TO_DATE");
    assert_eq!(link["is_sync_active"], true);
    assert_eq!(link["needs_reauth"], false);

    inbox.wait_for_preview("inbox", "Standup notes").await?;
    inbox.wait_for_preview("inbox", "Invoice 14").await?;
    assert_eq!(
        subjects(&inbox, "inbox").await?,
        ["Invoice 14", "Standup notes"]
    );

    assert!(provider_announces_changes(&stack, provider, ada.email()));
    let registered = match provider {
        Provider::Gmail => "watch",
        Provider::Outlook => "subscriptions.create",
    };
    assert_eq!(provider_calls(&stack, provider, ada.email(), registered), 1);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_linked_inbox_is_listed() -> Result<(), Report> {
    linked_inbox_is_listed(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_linked_inbox_is_listed() -> Result<(), Report> {
    linked_inbox_is_listed(Provider::Outlook).await
}

/// Two inboxes of one user are both listed, and the thread list keeps each
/// inbox's mail under its own `linkId`. When this fails, mail of one mailbox
/// shows under the other, or the second inbox is missing.
async fn two_inboxes_keep_their_mail_apart(
    first: Provider,
    second: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let side = "ada.side@example.com";
    seed_mailbox(&stack, first, ada.email(), &["Main only".to_owned()])?;
    seed_mailbox(&stack, second, side, &["Side only".to_owned()])?;

    let main_inbox = ada.link(first, ada.email()).await?;
    let side_inbox = ada.link(second, side).await?;
    main_inbox.wait_for_preview("inbox", "Main only").await?;
    side_inbox.wait_for_preview("inbox", "Side only").await?;
    main_inbox.deliver(&mail("Main later"))?;
    side_inbox.deliver(&mail("Side later"))?;
    main_inbox.wait_for_preview("inbox", "Main later").await?;
    side_inbox.wait_for_preview("inbox", "Side later").await?;

    assert_eq!(listed_addresses(&ada).await?, [side, ada.email()]);
    let links = listed_links(&ada).await?;
    for (inbox, provider) in [(&main_inbox, first), (&side_inbox, second)] {
        let link = links
            .iter()
            .find(|link| link["id"] == inbox.link_id().to_string())
            .cloned()
            .unwrap_or_default();
        assert_eq!(link["provider"], provider.as_str(), "{links:?}");
        assert_eq!(link["email_address"], inbox.email(), "{links:?}");
        assert_eq!(link["sync_status"], "UP_TO_DATE", "{links:?}");
    }

    let mut expected = vec![
        (main_inbox.link_id().to_string(), "Main later".to_owned()),
        (main_inbox.link_id().to_string(), "Main only".to_owned()),
        (side_inbox.link_id().to_string(), "Side later".to_owned()),
        (side_inbox.link_id().to_string(), "Side only".to_owned()),
    ];
    expected.sort();
    assert_eq!(subjects_by_link(&ada, "inbox").await?, expected);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn two_gmail_inboxes_keep_their_mail_apart() -> Result<(), Report> {
    two_inboxes_keep_their_mail_apart(Provider::Gmail, Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn two_outlook_inboxes_keep_their_mail_apart() -> Result<(), Report> {
    two_inboxes_keep_their_mail_apart(Provider::Outlook, Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn a_gmail_and_an_outlook_inbox_keep_their_mail_apart() -> Result<(), Report> {
    two_inboxes_keep_their_mail_apart(Provider::Gmail, Provider::Outlook).await
}

/// Unlinking removes that inbox from the list at once and its threads from
/// the views, tells the provider to stop announcing its changes (Gmail
/// `users.stop`, the Graph subscription deleted), and leaves the user's other
/// inbox listed, watched and receiving mail. When this fails, a removed inbox
/// keeps showing or keeps syncing, or removing one inbox breaks the other.
async fn unlinking_removes_only_that_inbox(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let side = "ada.side@example.com";
    let held = ["Standup notes".to_owned(), "Invoice 14".to_owned()];
    seed_mailbox(&stack, provider, ada.email(), &held)?;
    let inbox = ada.link(provider, ada.email()).await?;
    inbox.wait_for_preview("inbox", "Standup notes").await?;
    inbox.wait_for_preview("inbox", "Invoice 14").await?;
    let other = ada.link(provider, side).await?;
    other.deliver(&mail("Side project"))?;
    other.wait_for_preview("inbox", "Side project").await?;

    unlink(&inbox).await?;
    assert_stopped(&inbox).await?;

    wait_until_purged(&stack, inbox.link_id()).await?;
    other.deliver(&mail("After the unlink"))?;
    other.wait_for_preview("inbox", "After the unlink").await?;
    wait_until_link_jobs_are_done(&stack).await?;

    assert_eq!(listed_addresses(&ada).await?, [side]);
    assert!(subjects(&inbox, "inbox").await?.is_empty());
    assert!(subjects(&inbox, "all").await?.is_empty());
    assert_eq!(
        subjects(&other, "inbox").await?,
        ["After the unlink", "Side project"]
    );

    assert!(!provider_announces_changes(&stack, provider, ada.email()));
    assert!(provider_announces_changes(&stack, provider, side));
    let (stopped, other_stopped) = match provider {
        Provider::Gmail => (
            provider_calls(&stack, provider, ada.email(), "stop"),
            provider_calls(&stack, provider, side, "stop"),
        ),
        Provider::Outlook => (
            provider_calls(&stack, provider, ada.email(), "subscriptions.delete"),
            provider_calls(&stack, provider, side, "subscriptions.delete"),
        ),
    };
    assert_eq!((stopped, other_stopped), (1, 0));
    if provider == Provider::Outlook {
        // Macro gives the removed mailbox's grant back; the other one's stays.
        let revoked: Vec<(String, bool)> = stack
            .outlook()
            .mailboxes()
            .iter()
            .map(|mailbox| (mailbox.email.clone(), mailbox.revoked))
            .collect();
        assert!(
            revoked.contains(&(ada.email().to_owned(), true)),
            "{revoked:?}"
        );
        assert!(revoked.contains(&(side.to_owned(), false)), "{revoked:?}");
    }

    for table in ["email_threads", "email_messages"] {
        assert_eq!(rows_of_link(&stack, table, inbox.link_id()).await?, 0);
    }
    assert_eq!(stack.dead_letters(LINK_MANAGER).await?, 0);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_unlinking_removes_only_that_inbox() -> Result<(), Report> {
    unlinking_removes_only_that_inbox(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_unlinking_removes_only_that_inbox() -> Result<(), Report> {
    unlinking_removes_only_that_inbox(Provider::Outlook).await
}

/// A mailbox that was unlinked and is linked again is a new inbox that
/// imports the mailbox's mail once and receives new mail. When this fails,
/// reconnecting a removed mailbox shows nothing, or every thread twice.
async fn relinking_an_unlinked_mailbox_imports_its_mail_once(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let held = ["Standup notes".to_owned(), "Invoice 14".to_owned()];
    seed_mailbox(&stack, provider, ada.email(), &held)?;
    let inbox = ada.link(provider, ada.email()).await?;
    inbox.wait_for_preview("inbox", "Standup notes").await?;
    inbox.wait_for_preview("inbox", "Invoice 14").await?;

    unlink(&inbox).await?;
    wait_until_purged(&stack, inbox.link_id()).await?;
    assert!(listed_links(&ada).await?.is_empty());

    consent_again(&stack, provider, ada.email()).await?;
    let again = ada.link(provider, ada.email()).await?;
    assert_ne!(again.link_id(), inbox.link_id());
    again.wait_for_preview("inbox", "Standup notes").await?;
    again.wait_for_preview("inbox", "Invoice 14").await?;
    again.deliver(&mail("Since the relink"))?;
    again.wait_for_preview("inbox", "Since the relink").await?;

    assert_eq!(listed_addresses(&ada).await?, [ada.email()]);
    assert_eq!(
        subjects(&again, "inbox").await?,
        ["Invoice 14", "Since the relink", "Standup notes"]
    );
    assert_eq!(
        subjects_by_link(&ada, "inbox").await?.len(),
        3,
        "threads of the removed inbox are back"
    );
    assert!(provider_announces_changes(&stack, provider, ada.email()));

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_relinking_an_unlinked_mailbox_imports_its_mail_once() -> Result<(), Report> {
    relinking_an_unlinked_mailbox_imports_its_mail_once(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_relinking_an_unlinked_mailbox_imports_its_mail_once() -> Result<(), Report> {
    relinking_an_unlinked_mailbox_imports_its_mail_once(Provider::Outlook).await
}

/// How many messages the large mailbox of the purge scenario holds: more
/// than one purge batch (500 messages), so the purge pauses between batches.
const LARGE_MAILBOX: usize = 520;

/// Removing an inbox with more mail than one purge batch: the API stops
/// listing it at once, the delete job delivered again (during the purge and
/// after it) is a no-op that is handled and deleted, mail that arrives during
/// the purge does not bring the inbox back, every thread and message of the
/// link is gone, and the user's other inbox is untouched. When this fails,
/// removing a big mailbox leaves it half-deleted or revived, or the repeated
/// job is retried until it dead-letters.
#[tokio::test(flavor = "multi_thread")]
async fn removing_a_large_inbox_purges_it_once_despite_repeated_delete_jobs() -> Result<(), Report>
{
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let side = "ada.side@example.com";
    let held: Vec<String> = (0..LARGE_MAILBOX)
        .map(|number| format!("Bulk {number:04}"))
        .collect();
    seed_mailbox(&stack, Provider::Gmail, ada.email(), &held)?;
    let large = ada.link_gmail().await?;
    let other = ada.link(Provider::Gmail, side).await?;
    other.deliver(&mail("Side project"))?;
    other.wait_for_preview("inbox", "Side project").await?;
    eventually(
        "the large mailbox to be imported",
        DEFAULT_TIMEOUT,
        async || {
            let imported = rows_of_link(&stack, "email_messages", large.link_id()).await?;
            Ok((imported == LARGE_MAILBOX as i64).then_some(()))
        },
    )
    .await?;

    let delete_job = json!({
        "operation": "DeleteLink",
        "link_id": large.link_id(),
        "deletion_reason": "ManuallyDisabled",
    });
    unlink(&large).await?;
    assert_stopped(&large).await?;
    stack.send_to_queue(LINK_MANAGER, &delete_job).await?;
    stack.send_to_queue(LINK_MANAGER, &delete_job).await?;
    large.deliver(&mail("Arrived during the purge"))?;

    wait_until_purged(&stack, large.link_id()).await?;
    stack.send_to_queue(LINK_MANAGER, &delete_job).await?;
    other.deliver(&mail("After the purge"))?;
    other.wait_for_preview("inbox", "After the purge").await?;
    wait_until_link_jobs_are_done(&stack).await?;

    assert_eq!(listed_addresses(&ada).await?, [side]);
    assert_eq!(links_for_address(&stack, ada.email()).await?, 0);
    for table in ["email_links", "email_threads", "email_messages"] {
        assert_eq!(rows_of_link(&stack, table, large.link_id()).await?, 0);
    }
    assert!(subjects(&large, "all").await?.is_empty());
    assert_eq!(
        subjects_by_link(&ada, "inbox").await?,
        [
            (other.link_id().to_string(), "After the purge".to_owned()),
            (other.link_id().to_string(), "Side project".to_owned()),
        ]
    );
    assert_eq!(other.link().await?["sync_status"], "UP_TO_DATE");
    assert_eq!(stack.dead_letters(LINK_MANAGER).await?, 0);

    stack.finish().await
}

/// A user on the free plan connects two inboxes; a third is refused with
/// 402 and leaves nothing behind, reconnecting one they have is still
/// allowed, and the paid plan lifts the limit. When this fails, free users
/// connect unlimited inboxes, or are refused their first or a reconnect.
async fn free_plan_allows_two_inboxes(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let (side, third) = ("ada.side@example.com", "ada.third@example.com");
    ada.link(provider, ada.email()).await?;
    let second = ada.link(provider, side).await?;

    let attempt = sign_in(&stack, &ada, provider, third, mail_scopes(provider)).await?;
    let refused = init(&ada, attempt).await?;
    assert_eq!(refused.status, 402, "{}", refused.text);
    assert_eq!(listed_addresses(&ada).await?, [side, ada.email()]);
    assert_eq!(links_for_address(&stack, third).await?, 0);

    // Consenting again for an inbox they have is not a third inbox.
    let reconnected = ada.start_link(provider, side).await?;
    assert_eq!(reconnected.link_id(), second.link_id());
    assert_eq!(listed_addresses(&ada).await?, [side, ada.email()]);

    subscribe(&stack, &ada).await?;
    let third_inbox = ada.link(provider, third).await?;
    third_inbox.deliver(&mail("Third inbox"))?;
    third_inbox.wait_for_preview("inbox", "Third inbox").await?;
    assert_eq!(listed_addresses(&ada).await?, [side, third, ada.email()]);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_free_plan_allows_two_inboxes() -> Result<(), Report> {
    free_plan_allows_two_inboxes(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_free_plan_allows_two_inboxes() -> Result<(), Report> {
    free_plan_allows_two_inboxes(Provider::Outlook).await
}

/// Waits until a user's inbox view holds a thread with this subject.
async fn wait_for_subject(user: &User, subject: &str) -> Result<(), Report> {
    eventually(
        &format!("a thread named {subject:?} for {}", user.email()),
        DEFAULT_TIMEOUT,
        async || {
            let listed = subjects_by_link(user, "inbox").await?;
            Ok(listed.iter().any(|(_, name)| name == subject).then_some(()))
        },
    )
    .await
}

/// Signing in with Google makes the user's first inbox: `POST /email/init`
/// without a sign-in attempt links the mailbox of the user's own address and
/// imports it, and calling it again (every later sign-in does) answers the
/// `ALREADY_INITIALIZED` outcome instead of a second inbox or an error the
/// caller would log as a failure. When this fails, new users land in an app
/// with no inbox, or returning users get duplicates.
#[tokio::test(flavor = "multi_thread")]
async fn signing_in_with_google_makes_the_first_inbox_once() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    seed_mailbox(
        &stack,
        Provider::Gmail,
        ada.email(),
        &["Welcome to Gmail".to_owned()],
    )?;

    let made = ada.post("/email/init", None).await?;
    assert_eq!(made.status, 200, "{}", made.text);
    let link_id = made.json["link_id"].as_str().unwrap_or_default().to_owned();
    wait_for_subject(&ada, "Welcome to Gmail").await?;
    let links = listed_links(&ada).await?;
    assert_eq!(links.len(), 1, "{links:?}");
    assert_eq!(links[0]["id"], link_id.as_str());
    assert_eq!(links[0]["email_address"], ada.email());
    assert_eq!(links[0]["provider"], "GMAIL");

    let again = ada.post("/email/init", None).await?;
    assert_eq!(again.status, 400, "{}", again.text);
    assert_eq!(again.json["code"], "ALREADY_INITIALIZED", "{}", again.text);
    assert_eq!(listed_links(&ada).await?.len(), 1);
    assert_eq!(links_for_address(&stack, ada.email()).await?, 1);
    assert_eq!(
        subjects_by_link(&ada, "inbox").await?,
        [(link_id, "Welcome to Gmail".to_owned())]
    );

    stack.finish().await
}

/// A sign-in that carries no Gmail grant (a password or non-Google sign-in)
/// makes no inbox: `POST /email/init` answers the `NO_GMAIL_GRANT` outcome,
/// not a server error, and nothing is half-made, so the same call succeeds
/// once the user has granted Gmail. When this fails, every non-Google sign-in
/// is reported as a failed inbox setup, or leaves a dead inbox behind.
#[tokio::test(flavor = "multi_thread")]
async fn signing_in_without_a_gmail_grant_makes_no_inbox() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let bob = stack.user("bob").await?;

    let answered = bob.post("/email/init", None).await?;
    assert_eq!(answered.status, 400, "{}", answered.text);
    assert_eq!(answered.json["code"], "NO_GMAIL_GRANT", "{}", answered.text);
    assert!(listed_links(&bob).await?.is_empty());
    assert_eq!(links_for_address(&stack, bob.email()).await?, 0);

    seed_mailbox(
        &stack,
        Provider::Gmail,
        bob.email(),
        &["Welcome to Gmail".to_owned()],
    )?;
    let made = bob.post("/email/init", None).await?;
    assert_eq!(made.status, 200, "{}", made.text);
    wait_for_subject(&bob, "Welcome to Gmail").await?;
    assert_eq!(listed_addresses(&bob).await?, [bob.email()]);

    stack.finish().await
}

/// A link that fails at the provider (Gmail refuses `users.watch`) answers
/// an error, leaves neither an inbox nor the sign-in attempt behind, and the
/// user's next attempt succeeds. When this fails, failed attempts pile up
/// against the user's attempt limit, or a half-made inbox is listed.
#[tokio::test(flavor = "multi_thread")]
async fn a_link_that_fails_at_the_provider_leaves_nothing_behind() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let attempt = sign_in(&stack, &ada, Provider::Gmail, ada.email(), &[GMAIL_SCOPE]).await?;
    assert_eq!(open_sign_ins(&stack, &ada).await?, 1);
    stack.gmail().inject_fault(gmail_emulator::Fault {
        mailbox: Some(ada.email().to_owned()),
        route: Some(gmail_emulator::Route::Watch),
        error: Some(gmail_emulator::FaultError::Internal),
        ..Default::default()
    });

    let failed = init(&ada, attempt).await?;
    assert!(failed.status >= 400, "{} {}", failed.status, failed.text);
    assert!(listed_links(&ada).await?.is_empty());
    assert_eq!(links_for_address(&stack, ada.email()).await?, 0);
    assert_eq!(open_sign_ins(&stack, &ada).await?, 0);

    stack.gmail().clear_faults();
    let inbox = ada.link_gmail().await?;
    inbox.deliver(&mail("After the retry"))?;
    inbox.wait_for_preview("inbox", "After the retry").await?;
    assert_eq!(listed_addresses(&ada).await?, [ada.email()]);
    assert_eq!(open_sign_ins(&stack, &ada).await?, 0);

    stack.finish().await
}

/// A Gmail mailbox with send-as aliases is one inbox: `GET /email/links`
/// lists the mailbox's own address only, and no link exists for an alias.
/// (The past bug, aliases drawn as inboxes, was in the web app's inbox
/// selector; this guards the payload it reads.)
#[tokio::test(flavor = "multi_thread")]
async fn a_gmail_mailbox_with_aliases_is_one_inbox() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let (alias, pending) = ("sales@example.com", "pending@example.com");
    stack.gmail().add_mailbox(&gmail_emulator::SeedMailbox {
        email: ada.email().to_owned(),
        send_as: vec![
            gmail_emulator::SeedSendAs {
                email: alias.to_owned(),
                name: Some("Sales".to_owned()),
                signature: None,
                verified: true,
            },
            gmail_emulator::SeedSendAs {
                email: pending.to_owned(),
                name: None,
                signature: None,
                verified: false,
            },
        ],
        ..Default::default()
    })?;

    let inbox = ada.link_gmail().await?;
    inbox.deliver(&mail("To the mailbox"))?;
    inbox.wait_for_preview("inbox", "To the mailbox").await?;

    let links = listed_links(&ada).await?;
    assert_eq!(links.len(), 1, "{links:?}");
    assert_eq!(links[0]["email_address"], ada.email());
    assert_eq!(links[0]["id"], inbox.link_id().to_string());
    for address in [alias, pending] {
        assert_eq!(links_for_address(&stack, address).await?, 0);
    }

    stack.finish().await
}

/// A mailbox that is an inbox on one Macro account, linked by another user:
/// the API answers a conflict that names the mailbox and the inbox that
/// holds it (the client asks whether to share it), not a server error; the
/// second user gets no inbox and no link row is made; and the first user's
/// inbox keeps working. When this fails, the second user sees an unspecific
/// failure, or the mailbox ends up half-linked twice.
async fn mailbox_on_another_account_is_a_conflict(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let bob = stack.user("bob").await?;
    let team = "team@example.com";
    seed_mailbox(&stack, provider, team, &["Shared plan".to_owned()])?;
    let held = ada.link(provider, team).await?;
    held.wait_for_preview("inbox", "Shared plan").await?;

    let attempt = sign_in(&stack, &bob, provider, team, mail_scopes(provider)).await?;
    let refused = init(&bob, attempt).await?;
    assert_eq!(refused.status, 409, "{}", refused.text);
    assert_eq!(refused.json["email_address"], team, "{}", refused.text);
    assert_eq!(
        refused.json["existing_link_id"],
        held.link_id().to_string(),
        "{}",
        refused.text
    );

    assert!(listed_links(&bob).await?.is_empty());
    assert!(subjects_by_link(&bob, "inbox").await?.is_empty());
    assert_eq!(links_for_address(&stack, team).await?, 1);

    held.deliver(&mail("Still Ada's"))?;
    held.wait_for_preview("inbox", "Still Ada's").await?;
    assert_eq!(listed_addresses(&ada).await?, [team]);
    assert_eq!(held.link().await?["sync_status"], "UP_TO_DATE");
    assert!(subjects_by_link(&bob, "inbox").await?.is_empty());

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_mailbox_on_another_account_is_a_conflict() -> Result<(), Report> {
    mailbox_on_another_account_is_a_conflict(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_mailbox_on_another_account_is_a_conflict() -> Result<(), Report> {
    mailbox_on_another_account_is_a_conflict(Provider::Outlook).await
}

/// The calendar state of a Gmail inbox follows what was granted: a mail-only
/// link needs the calendar permission, and consenting to the calendar scopes
/// for the same inbox clears that on the existing inbox instead of making a
/// second one. When this fails, "Enable calendar" never clears, or the
/// upgrade duplicates the inbox.
#[tokio::test(flavor = "multi_thread")]
async fn granting_calendar_to_a_linked_inbox_clears_the_calendar_prompt() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;
    let link = inbox.link().await?;
    assert_eq!(link["needs_calendar_permission"], true, "{link}");
    assert_eq!(link["has_calendar_data"], false, "{link}");
    assert_eq!(link["calendar_disabled"], false, "{link}");

    let with_calendar = [GMAIL_SCOPE, CALENDAR_SCOPES[0], CALENDAR_SCOPES[1]];
    let attempt = sign_in(&stack, &ada, Provider::Gmail, ada.email(), &with_calendar).await?;
    let upgraded = init(&ada, attempt).await?;
    assert_eq!(upgraded.status, 200, "{}", upgraded.text);
    assert_eq!(upgraded.json["link_id"], inbox.link_id().to_string());

    let link = inbox.link().await?;
    assert_eq!(link["needs_calendar_permission"], false, "{link}");
    assert_eq!(link["has_calendar_data"], true, "{link}");
    assert_eq!(listed_links(&ada).await?.len(), 1);
    assert_eq!(open_sign_ins(&stack, &ada).await?, 0);

    inbox.deliver(&mail("Mail still syncs"))?;
    inbox.wait_for_preview("inbox", "Mail still syncs").await?;

    stack.finish().await
}

/// An inbox whose calendar was synced under the broad calendar scope Macro
/// used to request no longer passes the scope check, but still has calendar
/// data: the API reports both, so settings can offer to turn the calendar
/// off. When this fails, such an inbox shows only "Enable calendar" and its
/// synced events cannot be removed.
#[tokio::test(flavor = "multi_thread")]
async fn calendar_data_is_reported_even_when_the_scopes_no_longer_qualify() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let with_calendar = [GMAIL_SCOPE, CALENDAR_SCOPES[0], CALENDAR_SCOPES[1]];
    let attempt = sign_in(&stack, &ada, Provider::Gmail, ada.email(), &with_calendar).await?;
    let made = init(&ada, attempt).await?;
    assert_eq!(made.status, 200, "{}", made.text);
    let link_id: Uuid = made.json["link_id"].as_str().unwrap_or_default().parse()?;
    let links = listed_links(&ada).await?;
    assert_eq!(links.len(), 1, "{links:?}");
    assert_eq!(links[0]["needs_calendar_permission"], false, "{links:?}");
    assert_eq!(links[0]["has_calendar_data"], true, "{links:?}");

    // The grant as an inbox connected before the narrowing holds it: the
    // broad scope only. No flow of today's code records this state.
    let rewritten =
        sqlx::query("UPDATE email_link_google_scopes SET granted_scopes = $2 WHERE link_id = $1")
            .bind(link_id)
            .bind(vec![
                GMAIL_SCOPE.to_owned(),
                LEGACY_CALENDAR_SCOPE.to_owned(),
            ])
            .execute(stack.db())
            .await?;
    assert_eq!(rewritten.rows_affected(), 1);

    let links = listed_links(&ada).await?;
    assert_eq!(links[0]["needs_calendar_permission"], true, "{links:?}");
    assert_eq!(links[0]["has_calendar_data"], true, "{links:?}");
    assert_eq!(links[0]["calendar_disabled"], false, "{links:?}");

    stack.finish().await
}

/// `POST /email/init` with a sign-in attempt that does not exist (already
/// used, or cleaned up after a failed link) is the client's error: 400, as
/// for any other invalid attempt. When this fails, a client that retries a
/// failed link reports a server failure.
async fn init_with_a_spent_sign_in_is_a_client_error(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    assert_eq!(open_sign_ins(&stack, &ada).await?, 0);

    let spent = init(&ada, Uuid::now_v7()).await?;
    assert_eq!(spent.status, 400, "{}", spent.text);
    assert_eq!(listed_addresses(&ada).await?, [ada.email()]);
    inbox.deliver(&mail("Unharmed"))?;
    inbox.wait_for_preview("inbox", "Unharmed").await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: link-callback-failure-strands-attempt"]
async fn gmail_init_with_a_spent_sign_in_is_a_client_error() -> Result<(), Report> {
    // crates/email/src/domain/mailbox/connection/gmail.rs:22-26 maps "no such
    // attempt" to a database error, which the API answers with 500.
    init_with_a_spent_sign_in_is_a_client_error(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: link-callback-failure-strands-attempt"]
async fn outlook_init_with_a_spent_sign_in_is_a_client_error() -> Result<(), Report> {
    // The same lookup runs before the provider is known.
    init_with_a_spent_sign_in_is_a_client_error(Provider::Outlook).await
}
