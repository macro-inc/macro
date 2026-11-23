//! Connecting a Gmail account by signing in with Google, and turning an
//! inbox's calendar off.
//!
//! Signing in leaves Macro with no record of what the user granted, so it
//! asks Google which scopes the mailbox's token carries and records the
//! grant from the answer. Outlook connects only through the consent flow,
//! which records the grant it asked for, so sign-in has no Outlook
//! counterpart.

use email_e2e::gmail_emulator::{Route, SeedMailbox};
use email_e2e::{Inbox, Mail, Provider, Report, Stack, StackOptions, events};

/// The scopes Macro asks Google for, without the calendar ones.
const MAIL_ONLY: [&str; 7] = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.settings.basic",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/contacts.other.readonly",
];

/// Signs Ada in with Google, her Gmail grant holding `scopes` (all Macro
/// asks for when `None`), and returns her inbox once it has synced.
async fn sign_in(stack: &Stack, scopes: Option<&[&str]>) -> Result<Inbox, Report> {
    let ada = stack.user("ada").await?;
    stack.gmail().add_mailbox(&SeedMailbox {
        email: ada.email().to_owned(),
        scopes: scopes.map(|scopes| scopes.iter().map(|scope| (*scope).to_owned()).collect()),
        ..SeedMailbox::default()
    })?;
    ada.link_gmail_through_sign_in().await
}

/// Whether Macro asked Google which scopes the mailbox's token carries.
fn asked_google_for_scopes(stack: &Stack) -> bool {
    stack
        .gmail()
        .requests()
        .iter()
        .any(|request| request.route == Some(Route::OauthTokenInfo))
}

/// Mail reaches the inbox, whatever was granted beyond Gmail.
async fn mail_arrives(inbox: &Inbox) -> Result<(), Report> {
    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Welcome aboard",
        "Hello.",
    ))?;
    inbox.wait_for_preview("inbox", "Welcome aboard").await?;
    Ok(())
}

/// Every scope granted: Ada signs in with Google and allows everything.
/// Macro learns from Google that her grant covers the calendar, so her
/// inbox does not ask for calendar access, and her mail syncs.
///
/// When it fails, a user who granted the calendar on sign-in is asked for
/// it again and gets no calendar sync, because Macro never found out what
/// she granted.
#[tokio::test(flavor = "multi_thread")]
async fn signing_in_with_every_scope_records_the_calendar_grant() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let inbox = sign_in(&stack, None).await?;

    assert!(
        asked_google_for_scopes(&stack),
        "Macro never asked Google for the token's scopes"
    );
    let link = inbox.link().await?;
    assert_eq!(link["needs_calendar_permission"], false, "{link}");
    assert_eq!(link["needs_reauth"], false, "{link}");
    mail_arrives(&inbox).await?;

    stack.finish().await
}

/// The calendar left out: Ada signs in with Google but does not allow the
/// calendar. Her mail syncs, and her inbox asks for calendar access.
///
/// When it fails, Macro takes a grant without the calendar for one with
/// it (and its calendar sync fails at Google), or refuses an inbox it can
/// sync.
#[tokio::test(flavor = "multi_thread")]
async fn signing_in_without_the_calendar_asks_for_it() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let inbox = sign_in(&stack, Some(&MAIL_ONLY)).await?;

    assert!(
        asked_google_for_scopes(&stack),
        "Macro never asked Google for the token's scopes"
    );
    let link = inbox.link().await?;
    assert_eq!(link["needs_calendar_permission"], true, "{link}");
    assert_eq!(link["needs_reauth"], false, "{link}");
    mail_arrives(&inbox).await?;

    stack.finish().await
}

/// Turning the calendar off: Ada turns off the calendar of an inbox that
/// holds it. Another user cannot do it for her; once she does, the inbox
/// asks for calendar access again and her mail keeps syncing.
///
/// When it fails, the calendar stays on after the user turned it off, the
/// mail stops with it, or someone else can turn off her calendar.
async fn turning_the_calendar_off(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let inbox = match provider {
        Provider::Gmail => sign_in(&stack, None).await?,
        Provider::Outlook => {
            let ada = stack.user("ada").await?;
            ada.link(provider, ada.email()).await?
        }
    };
    let path = format!("/email/links/{}/calendar", inbox.link_id());
    let link = inbox.link().await?;
    assert_eq!(link["needs_calendar_permission"], false, "{link}");

    let mallory = stack.user("mallory").await?;
    let refused = mallory.delete(&path, None).await?;
    assert!(
        refused.status == 403 || refused.status == 404,
        "another user turned the calendar off: {} {}",
        refused.status,
        refused.text
    );
    let link = inbox.link().await?;
    assert_eq!(link["needs_calendar_permission"], false, "{link}");

    let turned_off = inbox.delete(&path, None).await?;
    assert_eq!(turned_off.status, 204, "{}", turned_off.text);
    let link = inbox.link().await?;
    assert_eq!(link["needs_calendar_permission"], true, "{link}");
    assert_eq!(link["needs_reauth"], false, "{link}");
    mail_arrives(&inbox).await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_turning_the_calendar_off() -> Result<(), Report> {
    turning_the_calendar_off(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_turning_the_calendar_off() -> Result<(), Report> {
    turning_the_calendar_off(Provider::Outlook).await
}

/// How many `channels.stop` calls Google answered for a mailbox's grant.
fn calendar_channels_stopped(stack: &Stack, address: &str) -> usize {
    let requests = stack.gmail().requests();
    let stops = requests.iter().filter(|request| {
        request.route == Some(Route::ChannelsStop)
            && request.mailbox.as_deref() == Some(address)
            && request.status < 300
    });
    stops.count()
}

/// Turning off a calendar that is syncing: Ada's Gmail inbox holds its
/// calendar and Google pushes its changes. Once she turns the calendar
/// off, Macro has closed its push channel at Google, her events are gone
/// from the calendar, the inbox asks for calendar access again, and a
/// later change at Google reaches nothing while her mail keeps arriving.
///
/// When it fails, the calendar stays on after the user turned it off, or
/// Google keeps pushing the changes of a calendar Macro no longer shows.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_turning_a_syncing_calendar_off_stops_googles_pushes() -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        calendar: true,
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    let pushes = stack.google_calendar_pushes(ada.email());
    stack.gmail().add_event(
        ada.email(),
        "primary",
        events::google("Standup", events::hour_in_days(1)),
    )?;
    calendar.wait_for_event("Standup").await?;
    stack
        .wait_for_google_calendar_push(ada.email(), pushes)
        .await?;
    calendar.wait_until_synced(ada.email()).await?;
    assert_eq!(calendar_channels_stopped(&stack, ada.email()), 0);

    let turned_off = inbox
        .delete(&format!("/email/links/{}/calendar", inbox.link_id()), None)
        .await?;
    assert_eq!(turned_off.status, 204, "{}", turned_off.text);
    let link = inbox.link().await?;
    assert_eq!(link["needs_calendar_permission"], true, "{link}");
    assert_eq!(link["needs_reauth"], false, "{link}");
    assert!(
        calendar_channels_stopped(&stack, ada.email()) > 0,
        "Macro left the calendar's push channel open at Google"
    );
    calendar.wait_until_gone("Standup").await?;

    // Mail that arrives after the change at Google is the event after
    // which a calendar still syncing would show it.
    let pushes = stack.google_calendar_pushes(ada.email());
    stack.gmail().add_event(
        ada.email(),
        "primary",
        events::google("Retro", events::hour_in_days(2)),
    )?;
    mail_arrives(&inbox).await?;
    assert_eq!(
        stack.google_calendar_pushes(ada.email()),
        pushes,
        "Google still pushes the calendar that was turned off"
    );
    assert!(calendar.occurrences_titled("Retro").await?.is_empty());

    stack.finish().await
}
