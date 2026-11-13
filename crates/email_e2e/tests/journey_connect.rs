//! Connecting a Gmail account by signing in with Google: Macro has no
//! record of what the user granted, so it asks Google which scopes the
//! mailbox's token carries and records the grant from the answer.
//!
//! Outlook connects only through the consent flow, which records the grant
//! it asked for, so there is no Outlook counterpart.

use email_e2e::gmail_emulator::{Route, SeedMailbox};
use email_e2e::{Inbox, Mail, Report, Stack};

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
