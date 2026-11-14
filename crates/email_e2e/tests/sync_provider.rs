//! Provider sync: what Macro does with the changes, failures and expiries a
//! provider hands it.

#![expect(
    clippy::disallowed_methods,
    reason = "test support: the retry clock is moved with a statement that is not checked against the query cache"
)]

use email_e2e::{DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, eventually};
use email_e2e::{gmail_emulator, outlook_emulator};
use serde_json::json;

/// How often Macro reads a message the provider keeps refusing, or that is
/// gone, before it stops.
const MESSAGE_READS: usize = 3;

/// A request the provider answered.
struct Answered {
    /// The path and query.
    path: String,
    /// The status answered.
    status: u16,
    /// When, in milliseconds of the provider's clock.
    at_ms: i64,
}

/// A failure a provider answers a request with.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Failure {
    /// 500.
    ServerError,
    /// 429 with a `Retry-After` of two seconds.
    RateLimit,
}

/// A message from someone outside, with this subject.
fn mail(subject: &str) -> Mail {
    Mail::new("Grace <grace@example.com>", subject, "See below.")
}

/// What the provider answered to the requests on a route (`messages.get`,
/// `history.list`, …) for this inbox's mailbox, oldest first. A request
/// whose token the provider refused belongs to no mailbox and is included.
fn answered(stack: &Stack, inbox: &Inbox, route: &str) -> Vec<Answered> {
    let of_mailbox = |mailbox: &Option<String>| {
        mailbox
            .as_deref()
            .is_none_or(|email| email == inbox.email())
    };
    match inbox.provider() {
        Provider::Gmail => stack
            .gmail()
            .requests()
            .into_iter()
            .filter(|request| {
                of_mailbox(&request.mailbox)
                    && request
                        .route
                        .as_ref()
                        .is_some_and(|served| served.to_string() == route)
            })
            .map(|request| Answered {
                path: request.path,
                status: request.status,
                at_ms: request.at.timestamp_millis(),
            })
            .collect(),
        Provider::Outlook => stack
            .outlook()
            .requests()
            .into_iter()
            .filter(|request| {
                of_mailbox(&request.mailbox)
                    && request
                        .route
                        .as_ref()
                        .is_some_and(|served| served.to_string() == route)
            })
            .map(|request| Answered {
                path: request.path,
                status: request.status,
                at_ms: request.at.timestamp_millis(),
            })
            .collect(),
    }
}

/// How many requests on a route the provider answered with this status.
fn count_answered(stack: &Stack, inbox: &Inbox, route: &str, status: u16) -> usize {
    answered(stack, inbox, route)
        .iter()
        .filter(|request| request.status == status)
        .count()
}

/// Makes Outlook's per-message retries due now.
///
/// Macro retries a message 30 s, then 60 s, later (10 minutes for one the
/// provider refuses outright), and the stack has no clock to move for it. A
/// wait that calls this on every check stands in for that time passing: the
/// number of attempts and what each one does stay the service's own.
async fn make_outlook_retries_due(stack: &Stack) -> Result<(), Report> {
    sqlx::query(
        "UPDATE email_message_reconciliation SET available_at = now() \
         WHERE available_at > now() AND available_at <> 'infinity'",
    )
    .execute(stack.db())
    .await?;
    Ok(())
}

/// Waits until no thread with this subject shows in a view.
async fn wait_until_gone(
    stack: &Stack,
    inbox: &Inbox,
    view: &str,
    subject: &str,
) -> Result<(), Report> {
    eventually(
        &format!("{subject:?} to leave the {view} view"),
        DEFAULT_TIMEOUT,
        async || {
            if inbox.provider() == Provider::Outlook {
                make_outlook_retries_due(stack).await?;
            }
            Ok((count_in_view(inbox, view, subject).await? == 0).then_some(()))
        },
    )
    .await
}

/// How many threads with this subject a view shows.
async fn count_in_view(inbox: &Inbox, view: &str, subject: &str) -> Result<usize, Report> {
    let previews = inbox.previews(view).await?;
    Ok(previews
        .iter()
        .filter(|preview| preview["name"] == subject)
        .count())
}

/// Makes the provider fail the next read of one message of this inbox.
fn fail_next_message_read(stack: &Stack, inbox: &Inbox, failure: Failure) {
    let retry_after_seconds = (failure == Failure::RateLimit).then_some(2);
    match inbox.provider() {
        Provider::Gmail => {
            stack.gmail().inject_fault(gmail_emulator::Fault {
                mailbox: Some(inbox.email().to_owned()),
                route: Some(gmail_emulator::Route::MessagesGet),
                error: Some(match failure {
                    Failure::ServerError => gmail_emulator::FaultError::Internal,
                    Failure::RateLimit => gmail_emulator::FaultError::RateLimit,
                }),
                retry_after_seconds,
                times: Some(1),
                ..Default::default()
            });
        }
        Provider::Outlook => {
            stack.outlook().inject_fault(outlook_emulator::Fault {
                mailbox: Some(inbox.email().to_owned()),
                route: Some(outlook_emulator::Route::MessagesGet),
                error: Some(match failure {
                    Failure::ServerError => outlook_emulator::FaultError::Internal,
                    Failure::RateLimit => outlook_emulator::FaultError::RateLimit,
                }),
                retry_after_seconds,
                times: Some(1),
                ..Default::default()
            });
        }
    }
}

// -- ordinary behaviour --

/// Several messages that arrive at once all reach Macro, each exactly once:
/// none is lost between notifications that overlap, and none is stored twice.
async fn a_burst_of_mail_arrives_exactly_once(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let subjects: Vec<String> = (1..=8).map(|n| format!("Burst {n}")).collect();
    for subject in &subjects {
        inbox.deliver(&mail(subject))?;
    }
    for subject in &subjects {
        inbox.wait_for_preview("inbox", subject).await?;
    }

    // Whatever a repeated notification would have stored again is stored by
    // the time mail delivered after the burst has arrived.
    inbox.deliver(&mail("After the burst"))?;
    inbox.wait_for_preview("inbox", "After the burst").await?;
    let previews = inbox.previews("inbox").await?;
    assert_eq!(previews.len(), subjects.len() + 1, "{previews:?}");
    for subject in &subjects {
        let of_subject: Vec<_> = previews
            .iter()
            .filter(|preview| preview["name"] == subject.as_str())
            .collect();
        assert_eq!(of_subject.len(), 1, "threads named {subject:?}");
        let thread = inbox
            .thread(of_subject[0]["id"].as_str().unwrap_or_default())
            .await?;
        assert_eq!(
            thread["messages"].as_array().map(Vec::len),
            Some(1),
            "messages of {subject:?}"
        );
    }

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_burst_of_mail_arrives_exactly_once() -> Result<(), Report> {
    a_burst_of_mail_arrives_exactly_once(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_burst_of_mail_arrives_exactly_once() -> Result<(), Report> {
    a_burst_of_mail_arrives_exactly_once(Provider::Outlook).await
}

/// A message its owner deletes for good at the provider disappears from
/// Macro, and the rest of the mailbox stays.
///
/// Outlook settles a missing message on its third read (30 s and 60 s after
/// the first), which this scenario does not wait out: see
/// [`make_outlook_retries_due`].
async fn mail_deleted_at_the_provider_disappears(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let doomed = inbox.deliver(&mail("Delete me"))?;
    inbox.deliver(&mail("Keep me"))?;
    inbox.wait_for_preview("inbox", "Delete me").await?;
    inbox.wait_for_preview("inbox", "Keep me").await?;

    match provider {
        Provider::Gmail => stack.gmail().delete_message(inbox.email(), &doomed.id)?,
        Provider::Outlook => stack.outlook().delete_message(inbox.email(), &doomed.id)?,
    }
    wait_until_gone(&stack, &inbox, "inbox", "Delete me").await?;
    wait_until_gone(&stack, &inbox, "all", "Delete me").await?;
    assert_eq!(count_in_view(&inbox, "inbox", "Keep me").await?, 1);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_mail_deleted_at_the_provider_disappears() -> Result<(), Report> {
    mail_deleted_at_the_provider_disappears(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_mail_deleted_at_the_provider_disappears() -> Result<(), Report> {
    mail_deleted_at_the_provider_disappears(Provider::Outlook).await
}

/// A message its owner moves to the trash at the provider leaves the inbox
/// view and shows in the trash view.
async fn mail_trashed_at_the_provider_leaves_the_inbox(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let trashed = inbox.deliver(&mail("Trash me"))?;
    inbox.deliver(&mail("Keep me"))?;
    inbox.wait_for_preview("inbox", "Trash me").await?;
    inbox.wait_for_preview("inbox", "Keep me").await?;

    match provider {
        Provider::Gmail => stack.gmail().modify_labels(
            inbox.email(),
            &trashed.id,
            &["TRASH".to_owned()],
            &["INBOX".to_owned()],
        )?,
        Provider::Outlook => stack.outlook().update_message(
            inbox.email(),
            &trashed.id,
            &outlook_emulator::MessageChange {
                folder: Some("deleteditems".to_owned()),
                ..Default::default()
            },
        )?,
    }
    wait_until_gone(&stack, &inbox, "inbox", "Trash me").await?;
    inbox.wait_for_preview("trash", "Trash me").await?;
    assert_eq!(count_in_view(&inbox, "inbox", "Keep me").await?, 1);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_mail_trashed_at_the_provider_leaves_the_inbox() -> Result<(), Report> {
    mail_trashed_at_the_provider_leaves_the_inbox(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_mail_trashed_at_the_provider_leaves_the_inbox() -> Result<(), Report> {
    mail_trashed_at_the_provider_leaves_the_inbox(Provider::Outlook).await
}

/// When the provider no longer knows the point Macro last synced from (Gmail
/// forgot the history id, Graph expired the delta token), Macro starts over
/// from the mailbox as it is: the mail that arrived around the expiry is
/// there, nothing is stored twice, and later mail keeps arriving.
async fn sync_recovers_from_an_expired_cursor(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.deliver(&mail("Before the expiry"))?;
    inbox.wait_for_preview("inbox", "Before the expiry").await?;

    let (route, expired) = match provider {
        Provider::Gmail => {
            stack.gmail().expire_history(inbox.email())?;
            ("history.list", 404)
        }
        Provider::Outlook => {
            stack.outlook().expire_delta_tokens(inbox.email())?;
            ("messages.delta", 410)
        }
    };
    inbox.deliver(&mail("Around the expiry"))?;
    inbox.wait_for_preview("inbox", "Around the expiry").await?;
    assert!(
        count_answered(&stack, &inbox, route, expired) > 0,
        "the provider never refused the stored cursor"
    );

    inbox.deliver(&mail("After the expiry"))?;
    inbox.wait_for_preview("inbox", "After the expiry").await?;
    for subject in ["Before the expiry", "Around the expiry", "After the expiry"] {
        assert_eq!(
            count_in_view(&inbox, "inbox", subject).await?,
            1,
            "{subject}"
        );
    }

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_sync_recovers_from_an_expired_cursor() -> Result<(), Report> {
    sync_recovers_from_an_expired_cursor(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_sync_recovers_from_an_expired_cursor() -> Result<(), Report> {
    sync_recovers_from_an_expired_cursor(Provider::Outlook).await
}

/// A message whose read the provider fails once is read again and arrives,
/// once.
async fn a_failed_read_does_not_lose_the_message(
    provider: Provider,
    failure: Failure,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    fail_next_message_read(&stack, &inbox, failure);
    inbox.deliver(&mail("Failed once"))?;
    eventually(
        "the message whose read failed to arrive",
        DEFAULT_TIMEOUT,
        async || {
            if provider == Provider::Outlook {
                make_outlook_retries_due(&stack).await?;
            }
            Ok((count_in_view(&inbox, "inbox", "Failed once").await? == 1).then_some(()))
        },
    )
    .await?;
    let status = match failure {
        Failure::ServerError => 500,
        Failure::RateLimit => 429,
    };
    assert_eq!(
        count_answered(&stack, &inbox, "messages.get", status),
        1,
        "the read never failed"
    );

    inbox.deliver(&mail("After the failure"))?;
    inbox.wait_for_preview("inbox", "After the failure").await?;
    assert_eq!(count_in_view(&inbox, "inbox", "Failed once").await?, 1);

    stack.finish().await
}

/// Takes about a minute: Gmail work that failed comes back when its queue
/// message does, after the 60 s visibility timeout.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_read_failed_by_a_server_error_does_not_lose_the_message() -> Result<(), Report> {
    a_failed_read_does_not_lose_the_message(Provider::Gmail, Failure::ServerError).await
}

/// Outlook retries a message 30 s after a failure that is not the mailbox's,
/// which this scenario does not wait out: see [`make_outlook_retries_due`].
#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_read_failed_by_a_server_error_does_not_lose_the_message() -> Result<(), Report> {
    a_failed_read_does_not_lose_the_message(Provider::Outlook, Failure::ServerError).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_throttled_read_does_not_lose_the_message() -> Result<(), Report> {
    a_failed_read_does_not_lose_the_message(Provider::Outlook, Failure::RateLimit).await
}

// -- past bugs --

/// How long Gmail takes over a page of history in
/// [`gmail_history_pages_wait_out_a_cooldown_that_starts_between_them`]:
/// long enough for another request of the mailbox to be throttled meanwhile.
const SLOW_PAGE_MS: u64 = 15_000;
/// How many pages may be that slow: more than the scenario reads.
const SLOW_PAGES: u32 = 100;
/// The `Retry-After` of that throttled request: the mailbox's cooldown, which
/// outlasts a slow page.
const COOLDOWN_SECONDS: u64 = 30;
/// Label changes that fill more than one 500-record page of history.
const STAR_TOGGLES: usize = 260;

/// Every page of a Gmail history listing is a request of its own to the
/// mailbox's rate limit: when Gmail throttles the mailbox while the first
/// page is being read, the second page is not asked for until the cooldown
/// is over, and the changes still arrive.
///
/// When this fails, a sync that is catching up keeps calling Gmail for a
/// mailbox Gmail has just told to back off, which makes Gmail throttle the
/// mailbox for longer. Takes about a minute: the refused sync comes back
/// with its queue message.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_history_pages_wait_out_a_cooldown_that_starts_between_them() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;
    let starred_often = inbox.deliver(&mail("Starred often"))?;
    let preview = inbox.wait_for_preview("inbox", "Starred often").await?;

    // More than a page of history that Macro has not heard of.
    let push = stack.gmail().push_config();
    stack.gmail().set_push(None);
    let star = ["STARRED".to_owned()];
    for _ in 0..STAR_TOGGLES {
        stack
            .gmail()
            .modify_labels(inbox.email(), &starred_often.id, &star, &[])?;
        stack
            .gmail()
            .modify_labels(inbox.email(), &starred_often.id, &[], &star)?;
    }
    stack.gmail().clear_requests();

    let slow_pages = stack.gmail().inject_fault(gmail_emulator::Fault {
        mailbox: Some(inbox.email().to_owned()),
        route: Some(gmail_emulator::Route::HistoryList),
        delay_ms: Some(SLOW_PAGE_MS),
        times: Some(SLOW_PAGES),
        ..Default::default()
    });
    stack.gmail().inject_fault(gmail_emulator::Fault {
        mailbox: Some(inbox.email().to_owned()),
        route: Some(gmail_emulator::Route::MessagesModify),
        error: Some(gmail_emulator::FaultError::RateLimit),
        retry_after_seconds: Some(COOLDOWN_SECONDS),
        times: Some(1),
        ..Default::default()
    });

    // The sync starts on the first page, and while Gmail takes its time over
    // it, the user's own change to the mailbox is throttled.
    stack.gmail().set_push(push);
    inbox.deliver(&mail("After the stars"))?;
    eventually(
        "the sync to ask for the first page of history",
        DEFAULT_TIMEOUT,
        async || {
            let asked = stack
                .gmail()
                .faults()
                .iter()
                .any(|(id, fault)| *id == slow_pages && fault.times != Some(SLOW_PAGES));
            Ok(asked.then_some(()))
        },
    )
    .await?;
    inbox
        .patch(
            &format!(
                "/email/threads/{}/state",
                preview["id"].as_str().unwrap_or_default()
            ),
            Some(&json!({ "field": "read", "value": true })),
        )
        .await?
        .ok()?;
    eventually(
        "Gmail to throttle the change",
        DEFAULT_TIMEOUT,
        async || Ok((count_answered(&stack, &inbox, "messages.modify", 429) == 1).then_some(())),
    )
    .await?;
    stack.gmail().remove_fault(slow_pages);

    inbox.wait_for_preview("inbox", "After the stars").await?;

    let throttled = answered(&stack, &inbox, "messages.modify")
        .first()
        .map(|request| request.at_ms)
        .unwrap_or_default();
    let cooling_down = throttled..throttled + i64::try_from(COOLDOWN_SECONDS * 1000).unwrap_or(0);
    let timeline: Vec<String> = stack
        .gmail()
        .requests()
        .iter()
        .map(|request| {
            format!(
                "{} ms: {} {} {}",
                request.at.timestamp_millis() - throttled,
                request.method,
                request.path,
                request.status
            )
        })
        .collect();
    let pages = answered(&stack, &inbox, "history.list");
    let is_later_page = |page: &&Answered| page.path.contains("pageToken=");
    assert!(
        pages
            .iter()
            .any(|page| !is_later_page(&page) && cooling_down.contains(&page.at_ms)),
        "no first page of history was being read when Gmail throttled the mailbox: {timeline:#?}"
    );
    assert!(
        pages.iter().any(|page| is_later_page(&page)),
        "the history never had a second page: {timeline:#?}"
    );
    let during_cooldown: Vec<i64> = pages
        .iter()
        .filter(is_later_page)
        .filter(|page| cooling_down.contains(&page.at_ms))
        .map(|page| page.at_ms - throttled)
        .collect();
    assert!(
        during_cooldown.is_empty(),
        "a later page of history was asked for {during_cooldown:?} ms after Gmail throttled the mailbox for {COOLDOWN_SECONDS} s: {timeline:#?}"
    );

    stack.finish().await
}

/// Grants the mailbox's Gmail access to Macro again, as its owner does on
/// Google's consent screen.
async fn consent_again(stack: &Stack, inbox: &Inbox) -> Result<(), Report> {
    const SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";
    let form = [
        ("client_id", "macro"),
        ("redirect_uri", "http://127.0.0.1/callback"),
        ("response_type", "code"),
        ("access_type", "offline"),
        ("scope", SCOPE),
        ("granted", SCOPE),
        ("user", inbox.email()),
    ]
    .map(|(name, value)| format!("{name}={}", urlencoding::encode(value)))
    .join("&");
    let browser = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let answer = browser
        .post(stack.gmail().authorization_url())
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form)
        .send()
        .await?;
    let sent_back_with_a_code = answer
        .headers()
        .get("location")
        .and_then(|location| location.to_str().ok())
        .is_some_and(|location| location.contains("code="));
    assert!(
        sent_back_with_a_code,
        "the consent screen answered {} without an authorization code",
        answer.status()
    );
    Ok(())
}

/// Once a Gmail inbox is known to need reauthorization, the pushes Gmail
/// keeps sending for it are acknowledged without asking Gmail or the token
/// source for anything; after the owner consents again, the mail that
/// arrived meanwhile is there.
///
/// When this fails, every push for a revoked mailbox (Gmail sends them until
/// the watch expires a week later) runs the sync path into the dead grant:
/// a label listing, a token request and an error, thousands of times.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_pushes_for_an_inbox_that_needs_reauth_are_not_synced() -> Result<(), Report> {
    /// What a sync that could not get a token logs, once per failed sync.
    const TOKEN_FAILURE: &str = "AccessTokenFetchFailed: ";

    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;
    inbox.deliver(&mail("Before the revocation"))?;
    inbox
        .wait_for_preview("inbox", "Before the revocation")
        .await?;

    // The first push after the revocation is how Macro learns of it.
    inbox.revoke_grant()?;
    inbox.deliver(&mail("Missed 1"))?;
    inbox
        .wait_for_link("the inbox to need reauthorization", |link| {
            link["sync_status"] == "NEEDS_REAUTH"
        })
        .await?;
    // The inbox is marked before the failed sync is logged: count from after it.
    eventually(
        "the sync that met the revocation to be logged",
        DEFAULT_TIMEOUT,
        async || Ok(stack.workers_log().contains(TOKEN_FAILURE).then_some(())),
    )
    .await?;
    let requests_before = stack.gmail().requests().len();
    let token_failures_before = stack.workers_log().matches(TOKEN_FAILURE).count();

    let pushes_before = stack.gmail().push_deliveries().len();
    for subject in ["Missed 2", "Missed 3", "Missed 4"] {
        inbox.deliver(&mail(subject))?;
    }
    eventually(
        "the three pushes to be delivered",
        DEFAULT_TIMEOUT,
        async || {
            let delivered = stack.gmail().push_deliveries().len();
            Ok((delivered >= pushes_before + 3).then_some(()))
        },
    )
    .await?;
    eventually("the pushes to be worked off", DEFAULT_TIMEOUT, async || {
        Ok((stack.queue_depth("gmail-inbox-sync").await? == 0).then_some(()))
    })
    .await?;
    let asked: Vec<String> = stack
        .gmail()
        .requests()
        .into_iter()
        .skip(requests_before)
        .map(|request| format!("{} {} {}", request.method, request.path, request.status))
        .collect();
    assert!(
        asked.is_empty(),
        "Gmail was asked for a mailbox whose grant is revoked: {asked:?}"
    );
    assert_eq!(
        stack.workers_log().matches(TOKEN_FAILURE).count(),
        token_failures_before,
        "a push for the revoked mailbox asked for a token again"
    );

    consent_again(&stack, &inbox).await?;
    let inbox = ada.link_gmail().await?;
    // Reconnecting does not sync by itself: the next push brings the mailbox
    // up to date from where the sync stopped.
    inbox.deliver(&mail("After the consent"))?;
    inbox.wait_for_preview("inbox", "After the consent").await?;
    for subject in ["Missed 1", "Missed 2", "Missed 3", "Missed 4"] {
        inbox.wait_for_preview("inbox", subject).await?;
    }
    for subject in ["Before the revocation", "Missed 1", "Missed 4"] {
        assert_eq!(
            count_in_view(&inbox, "inbox", subject).await?,
            1,
            "{subject}"
        );
    }

    stack.finish().await
}

/// A meeting request whose `text/calendar` source names this meeting.
const INVITATION: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//EN\r\nMETHOD:REQUEST\r\n\
BEGIN:VEVENT\r\nUID:planning-1@example.com\r\nDTSTAMP:20261101T100000Z\r\n\
DTSTART:20261201T150000Z\r\nDTEND:20261201T160000Z\r\nSUMMARY:Planning\r\n\
ORGANIZER:mailto:grace@example.com\r\n\
ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ada@example.com\r\n\
END:VEVENT\r\nEND:VCALENDAR\r\n";

/// An Outlook invitation whose MIME source Graph will not return (it answers
/// 500 for some invitations, every time) still arrives as a message, after a
/// bounded number of tries for the source, and mail after it arrives too.
///
/// When this fails, the invitation never shows in Macro and its read is
/// retried without end.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_invitation_arrives_when_its_calendar_source_cannot_be_read() -> Result<(), Report>
{
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;

    stack.outlook().inject_fault(outlook_emulator::Fault {
        mailbox: Some(inbox.email().to_owned()),
        route: Some(outlook_emulator::Route::MessagesValue),
        error: Some(outlook_emulator::FaultError::Internal),
        ..Default::default()
    });
    stack.outlook().deliver(
        inbox.email(),
        &outlook_emulator::NewMessage {
            from: Some("Grace <grace@example.com>".to_owned()),
            subject: Some("Planning".to_owned()),
            text: Some("Please join.".to_owned()),
            calendar: Some(INVITATION.to_owned()),
            ..Default::default()
        },
    )?;

    eventually(
        "the invitation to arrive, or its source to be asked for once too often",
        DEFAULT_TIMEOUT,
        async || {
            make_outlook_retries_due(&stack).await?;
            let arrived = count_in_view(&inbox, "inbox", "Planning").await? == 1;
            let source_reads = count_answered(&stack, &inbox, "messages.value", 500);
            Ok((arrived || source_reads > MESSAGE_READS).then_some(()))
        },
    )
    .await?;
    assert_eq!(
        count_in_view(&inbox, "inbox", "Planning").await?,
        1,
        "the invitation did not arrive"
    );

    inbox.deliver(&mail("After the invitation"))?;
    inbox
        .wait_for_preview("inbox", "After the invitation")
        .await?;
    make_outlook_retries_due(&stack).await?;
    inbox.deliver(&mail("And one more"))?;
    inbox.wait_for_preview("inbox", "And one more").await?;
    assert_eq!(
        count_answered(&stack, &inbox, "messages.value", 500),
        MESSAGE_READS,
        "reads of the invitation's source"
    );

    stack.finish().await
}

/// An Outlook message Graph refuses to hand out (403 for that message) is
/// given up on after three reads: the inbox stays healthy rather than asking
/// for reauthorization, other mail arrives, and the message is not read
/// again.
///
/// When this fails, the one message is read for as long as the inbox is
/// linked, a first import holding it never completes, or the whole inbox
/// asks its owner to reconnect.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_message_the_provider_forbids_is_given_up_on() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;

    // The mailbox holds nothing else, so the refusal is this message's.
    let forbidden = stack.outlook().inject_fault(outlook_emulator::Fault {
        mailbox: Some(inbox.email().to_owned()),
        route: Some(outlook_emulator::Route::MessagesGet),
        error: Some(outlook_emulator::FaultError::Forbidden),
        ..Default::default()
    });
    inbox.deliver(&mail("Forbidden"))?;

    let given_up = async || -> Result<bool, Report> {
        let abandoned: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM email_message_reconciliation \
             WHERE link_id = $1 AND available_at = 'infinity'",
        )
        .bind(inbox.link_id())
        .fetch_one(stack.db())
        .await?;
        Ok(abandoned == 1)
    };
    eventually(
        "the message to be given up on, or read once too often",
        DEFAULT_TIMEOUT,
        async || {
            make_outlook_retries_due(&stack).await?;
            let reads = count_answered(&stack, &inbox, "messages.get", 403);
            Ok((given_up().await? || reads > MESSAGE_READS).then_some(()))
        },
    )
    .await?;
    assert_eq!(
        count_answered(&stack, &inbox, "messages.get", 403),
        MESSAGE_READS
    );

    // The rest of the mailbox is unaffected, and the message stays given up.
    stack.outlook().remove_fault(forbidden);
    inbox.deliver(&mail("Allowed"))?;
    inbox.wait_for_preview("inbox", "Allowed").await?;
    make_outlook_retries_due(&stack).await?;
    inbox.deliver(&mail("Allowed too"))?;
    inbox.wait_for_preview("inbox", "Allowed too").await?;
    assert_eq!(count_in_view(&inbox, "inbox", "Forbidden").await?, 0);
    assert!(given_up().await?, "the message was taken up again");
    let link = inbox.link().await?;
    assert_eq!(link["sync_status"], "UP_TO_DATE", "{link}");
    assert_eq!(link["needs_reauth"], false, "{link}");

    stack.finish().await
}

/// A message deleted at the provider just before Graph expires the folder's
/// delta token is still removed from Macro: the resync that follows finds the
/// message Macro holds missing, reads it (404) and, on the third read,
/// settles that it is gone. It is not read again after that.
///
/// When this fails, the deleted message stays in Macro's inbox, or its read
/// is repeated long after the provider said it does not exist.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_message_deleted_before_a_delta_resync_is_settled() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;
    let doomed = inbox.deliver(&mail("Deleted meanwhile"))?;
    inbox.deliver(&mail("Kept"))?;
    inbox.wait_for_preview("inbox", "Deleted meanwhile").await?;
    inbox.wait_for_preview("inbox", "Kept").await?;

    // The deletion's own notification finds the delta token expired.
    stack.outlook().inject_fault(outlook_emulator::Fault {
        mailbox: Some(inbox.email().to_owned()),
        route: Some(outlook_emulator::Route::MessagesDelta),
        error: Some(outlook_emulator::FaultError::SyncStateNotFound),
        times: Some(1),
        ..Default::default()
    });
    stack.outlook().delete_message(inbox.email(), &doomed.id)?;

    let reads_of_the_deleted = || {
        answered(&stack, &inbox, "messages.get")
            .iter()
            .filter(|request| request.status == 404 && request.path.contains(&doomed.id))
            .count()
    };
    eventually(
        "the deleted message to leave the inbox, or to be read once too often",
        DEFAULT_TIMEOUT,
        async || {
            make_outlook_retries_due(&stack).await?;
            let gone = count_in_view(&inbox, "inbox", "Deleted meanwhile").await? == 0;
            Ok((gone || reads_of_the_deleted() > MESSAGE_READS).then_some(()))
        },
    )
    .await?;
    assert_eq!(
        count_in_view(&inbox, "inbox", "Deleted meanwhile").await?,
        0,
        "the deleted message is still in the inbox"
    );
    assert_eq!(
        count_answered(&stack, &inbox, "messages.delta", 410),
        1,
        "the delta token never expired"
    );

    // Settled: later syncs do not read it again.
    inbox.deliver(&mail("After the resync"))?;
    inbox.wait_for_preview("inbox", "After the resync").await?;
    make_outlook_retries_due(&stack).await?;
    inbox.deliver(&mail("And one more"))?;
    inbox.wait_for_preview("inbox", "And one more").await?;
    let reads = reads_of_the_deleted();
    assert!(
        (1..=MESSAGE_READS).contains(&reads),
        "the deleted message was read {reads} times"
    );
    assert_eq!(count_in_view(&inbox, "inbox", "Kept").await?, 1);

    stack.finish().await
}

/// What the user does in Macro right after Graph throttled a background read
/// of the same mailbox is accepted and done: marking a thread read reaches
/// the provider and a message sent leaves, once the mailbox's cooldown is
/// over.
///
/// One Graph 429 makes Macro hold every request for the mailbox until the
/// `Retry-After` has passed, the user's writes included. Whether a user's
/// write should wait behind a background read's throttle, or go to Graph at
/// once, is a product decision that is still open; this scenario pins what
/// must hold either way: the write is not refused, and it is not lost.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_user_writes_made_while_the_mailbox_cools_down_are_not_refused()
-> Result<(), Report> {
    /// The `Retry-After` of the throttled read.
    const RETRY_AFTER_SECONDS: u64 = 6;

    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;
    let unread = inbox.deliver(&mail("Read me"))?;
    let preview = inbox.wait_for_preview("inbox", "Read me").await?;

    stack.outlook().inject_fault(outlook_emulator::Fault {
        mailbox: Some(inbox.email().to_owned()),
        route: Some(outlook_emulator::Route::MessagesGet),
        error: Some(outlook_emulator::FaultError::RateLimit),
        retry_after_seconds: Some(RETRY_AFTER_SECONDS),
        times: Some(1),
        ..Default::default()
    });
    inbox.deliver(&mail("Throttled"))?;
    eventually(
        "Graph to throttle the background read",
        DEFAULT_TIMEOUT,
        async || Ok((count_answered(&stack, &inbox, "messages.get", 429) == 1).then_some(())),
    )
    .await?;

    let marked = inbox
        .patch(
            &format!(
                "/email/threads/{}/state",
                preview["id"].as_str().unwrap_or_default()
            ),
            Some(&json!({ "field": "read", "value": true })),
        )
        .await?;
    assert!(
        (200..300).contains(&marked.status),
        "marking a thread read was refused: {marked:?}"
    );
    let sent = inbox
        .post(
            "/email/messages",
            Some(&json!({ "message": {
                "subject": "Sent while cooling down",
                "to": [{ "email": "grace@example.com" }],
                "body_text": "On its way.",
            }})),
        )
        .await?;
    assert!(
        (200..300).contains(&sent.status),
        "sending was refused: {sent:?}"
    );

    inbox
        .wait_for_provider_message("the message marked read", |message| {
            message.id == unread.id && message.read
        })
        .await?;
    inbox
        .wait_for_provider_message("the sent message", |message| {
            message.subject == "Sent while cooling down" && !message.in_inbox
        })
        .await?;
    // The throttled read itself is not lost either.
    inbox.wait_for_preview("inbox", "Throttled").await?;

    stack.finish().await
}
