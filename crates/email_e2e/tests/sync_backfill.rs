//! The first import of a mailbox when it is linked.

#![expect(
    clippy::disallowed_methods,
    reason = "test support: fixture rows and what the API cannot answer are not checked against the query cache"
)]

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use email_e2e::redis::AsyncCommands;
use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, User, eventually, gmail_emulator,
    outlook_emulator,
};
use rootcause::prelude::*;
use serde_json::{Value, json};
use uuid::Uuid;

const REPORT: &[u8] = b"%PDF-1.4 the quarterly report";

/// Where a seeded message lies in the mailbox.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Place {
    Inbox,
    Sent,
    Draft,
    Archive,
}

/// A message a mailbox holds before it is linked.
#[derive(Clone)]
struct Letter {
    from: String,
    to: Option<String>,
    subject: String,
    text: String,
    place: Place,
    read: bool,
    message_id: Option<String>,
    in_reply_to: Option<String>,
    attachment: Option<(&'static str, &'static str, &'static [u8])>,
}

impl Letter {
    fn received(subject: &str, read: bool) -> Self {
        Self {
            from: "Grace <grace@example.com>".to_owned(),
            to: None,
            subject: subject.to_owned(),
            text: format!("Body of {subject}."),
            place: Place::Inbox,
            read,
            message_id: None,
            in_reply_to: None,
            attachment: None,
        }
    }

    fn sent(owner: &str, subject: &str) -> Self {
        Self {
            from: owner.to_owned(),
            to: Some("grace@example.com".to_owned()),
            place: Place::Sent,
            read: true,
            ..Self::received(subject, true)
        }
    }

    fn placed(mut self, place: Place) -> Self {
        self.place = place;
        self
    }

    fn id(mut self, message_id: &str) -> Self {
        self.message_id = Some(message_id.to_owned());
        self
    }

    fn reply_to(mut self, message_id: &str) -> Self {
        self.in_reply_to = Some(message_id.to_owned());
        self
    }
}

/// Creates the mailbox `address` at the provider, holding `letters`, oldest first.
fn seed_mailbox(
    stack: &Stack,
    provider: Provider,
    address: &str,
    letters: &[Letter],
) -> Result<(), Report> {
    match provider {
        Provider::Gmail => {
            let messages = letters
                .iter()
                .map(|letter| {
                    let mut labels = match letter.place {
                        Place::Inbox => vec!["INBOX".to_owned()],
                        Place::Sent => vec!["SENT".to_owned()],
                        Place::Draft => vec!["DRAFT".to_owned()],
                        Place::Archive => Vec::new(),
                    };
                    if !letter.read {
                        labels.push("UNREAD".to_owned());
                    }
                    gmail_emulator::NewMessage {
                        from: Some(letter.from.clone()),
                        to: letter.to.clone(),
                        subject: Some(letter.subject.clone()),
                        text: Some(letter.text.clone()),
                        labels: Some(labels),
                        message_id: letter.message_id.clone(),
                        in_reply_to: letter.in_reply_to.clone(),
                        attachments: letter
                            .attachment
                            .iter()
                            .map(
                                |(filename, mime_type, bytes)| gmail_emulator::NewAttachment {
                                    filename: (*filename).to_owned(),
                                    mime_type: Some((*mime_type).to_owned()),
                                    base64: Some(STANDARD.encode(bytes)),
                                    ..Default::default()
                                },
                            )
                            .collect(),
                        ..Default::default()
                    }
                })
                .collect();
            stack.gmail().add_mailbox(&gmail_emulator::SeedMailbox {
                email: address.to_owned(),
                messages,
                ..Default::default()
            })?;
        }
        Provider::Outlook => {
            let messages = letters
                .iter()
                .map(|letter| outlook_emulator::NewMessage {
                    from: Some(letter.from.clone()),
                    to: letter.to.clone(),
                    subject: Some(letter.subject.clone()),
                    text: Some(letter.text.clone()),
                    folder: Some(
                        match letter.place {
                            Place::Inbox => "inbox",
                            Place::Sent => "sentitems",
                            Place::Draft => "drafts",
                            Place::Archive => "archive",
                        }
                        .to_owned(),
                    ),
                    read: Some(letter.read),
                    message_id: letter.message_id.clone(),
                    in_reply_to: letter.in_reply_to.clone(),
                    attachments: letter
                        .attachment
                        .iter()
                        .map(
                            |(filename, mime_type, bytes)| outlook_emulator::NewAttachment {
                                filename: (*filename).to_owned(),
                                mime_type: Some((*mime_type).to_owned()),
                                base64: Some(STANDARD.encode(bytes)),
                                ..Default::default()
                            },
                        )
                        .collect(),
                    ..Default::default()
                })
                .collect();
            stack
                .outlook()
                .add_mailbox(&outlook_emulator::SeedMailbox {
                    email: address.to_owned(),
                    messages,
                    ..Default::default()
                })?;
        }
    }
    Ok(())
}

/// A lived-in mailbox: 18 single messages in the inbox (the odd ones read),
/// three conversations of three messages with the owner's reply in the
/// middle, a message with an attachment, four sent messages, a draft and
/// five archived messages. 32 threads, 38 messages.
fn lived_in_mailbox(owner: &str) -> Vec<Letter> {
    let mut letters = Vec::new();
    for number in 1..=18 {
        letters.push(Letter::received(
            &format!("Note {number:02}"),
            number % 2 == 1,
        ));
    }
    for name in ["Plan A", "Plan B", "Plan C"] {
        let slug = name.replace(' ', "-").to_lowercase();
        let first = format!("{slug}-1@mail.example.com");
        let second = format!("{slug}-2@mail.example.com");
        letters.push(Letter::received(name, true).id(&first));
        letters.push(
            Letter::sent(owner, &format!("Re: {name}"))
                .id(&second)
                .reply_to(&first),
        );
        letters.push(Letter::received(&format!("Re: {name}"), false).reply_to(&second));
    }
    let mut report = Letter::received("The report", false);
    report.attachment = Some(("report.pdf", "application/pdf", REPORT));
    letters.push(report);
    for number in 1..=4 {
        letters.push(Letter::sent(owner, &format!("Sent {number}")));
    }
    letters.push(Letter::sent(owner, "Draft idea").placed(Place::Draft));
    for number in 1..=5 {
        letters.push(Letter::received(&format!("Archived {number}"), true).placed(Place::Archive));
    }
    letters
}

/// The scope a Gmail inbox is linked with.
const GMAIL_SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";
/// The link status the API reports while the first import runs.
const SYNCING: &str = "SYNCING";
/// How long a scenario waits for a backfill whose worker was killed: the
/// queue redelivers after 60 s and the job's lease lasts two minutes.
const RECOVERY_TIMEOUT: Duration = Duration::from_secs(300);

/// How many previews of a view carry this name.
fn named(previews: &[Value], name: &str) -> usize {
    previews
        .iter()
        .filter(|preview| preview["name"] == name)
        .count()
}

/// The preview of the thread whose name ends with `suffix`.
fn preview_ending<'a>(previews: &'a [Value], suffix: &str) -> Option<&'a Value> {
    previews.iter().find(|preview| {
        preview["name"]
            .as_str()
            .is_some_and(|name| name.ends_with(suffix))
    })
}

/// The user's backfill jobs, as `GET /email/backfill/gmail` lists them.
async fn backfill_jobs(inbox: &Inbox) -> Result<Vec<Value>, Report> {
    let listed = inbox.get("/email/backfill/gmail").await?.ok()?;
    Ok(listed["jobs"].as_array().cloned().unwrap_or_default())
}

/// How many requests of a route the Gmail emulator answered for a mailbox,
/// with a status below 400.
fn gmail_calls(stack: &Stack, mailbox: &str, route: gmail_emulator::Route) -> usize {
    stack
        .gmail()
        .requests()
        .iter()
        .filter(|request| {
            request.route == Some(route)
                && request.mailbox.as_deref() == Some(mailbox)
                && request.status < 400
        })
        .count()
}

/// Makes the provider refuse the listing a first import starts with, until
/// the returned fault is removed: the import cannot finish meanwhile.
fn hold_import(stack: &Stack, provider: Provider, address: &str) -> u64 {
    match provider {
        Provider::Gmail => stack.gmail().inject_fault(gmail_emulator::Fault {
            mailbox: Some(address.to_owned()),
            route: Some(gmail_emulator::Route::ThreadsList),
            error: Some(gmail_emulator::FaultError::RateLimit),
            retry_after_seconds: Some(1),
            ..Default::default()
        }),
        Provider::Outlook => stack.outlook().inject_fault(outlook_emulator::Fault {
            mailbox: Some(address.to_owned()),
            route: Some(outlook_emulator::Route::MessagesDelta),
            error: Some(outlook_emulator::FaultError::RateLimit),
            retry_after_seconds: Some(1),
            ..Default::default()
        }),
    }
}

fn release_import(stack: &Stack, provider: Provider, fault: u64) {
    match provider {
        Provider::Gmail => stack.gmail().remove_fault(fault),
        Provider::Outlook => stack.outlook().remove_fault(fault),
    };
}

/// Asserts the lived-in mailbox is in Macro as the provider holds it.
async fn assert_lived_in_mailbox_imported(inbox: &Inbox) -> Result<(), Report> {
    let in_inbox = inbox.previews("inbox").await?;
    let sent = inbox.previews("sent").await?;
    let all = inbox.previews("all").await?;
    assert_eq!(in_inbox.len(), 22, "threads in the inbox view");
    assert_eq!(sent.len(), 7, "threads in the sent view");
    assert_eq!(all.len(), 32, "threads in the all view");

    for number in 1..=18 {
        let name = format!("Note {number:02}");
        assert_eq!(named(&all, &name), 1, "{name} is imported once");
        let preview = in_inbox
            .iter()
            .find(|preview| preview["name"] == name.as_str());
        let is_read = preview.map(|preview| preview["isRead"].clone());
        assert_eq!(
            is_read,
            Some(json!(number % 2 == 1)),
            "read state of {name}"
        );
    }
    for plan in ["Plan A", "Plan B", "Plan C"] {
        let Some(preview) = preview_ending(&in_inbox, plan) else {
            bail!("the conversation {plan} is not in the inbox view");
        };
        assert_eq!(preview["isRead"], false, "{plan} ends with an unread reply");
        assert!(
            preview_ending(&sent, plan).is_some(),
            "{plan} holds a reply the owner sent"
        );
        let thread = inbox
            .thread(preview["id"].as_str().unwrap_or_default())
            .await?;
        let messages = thread["messages"].as_array().map_or(0, Vec::len);
        assert_eq!(messages, 3, "messages of {plan}");
    }
    for number in 1..=4 {
        let name = format!("Sent {number}");
        assert_eq!(named(&sent, &name), 1, "{name} in the sent view");
        assert_eq!(named(&in_inbox, &name), 0, "{name} in the inbox view");
    }
    for number in 1..=5 {
        let name = format!("Archived {number}");
        assert_eq!(named(&all, &name), 1, "{name} in the all view");
        assert_eq!(named(&in_inbox, &name), 0, "{name} in the inbox view");
    }
    let draft = all.iter().find(|preview| preview["name"] == "Draft idea");
    assert_eq!(
        draft.map(|draft| draft["isDraft"].clone()),
        Some(json!(true))
    );

    let Some(report) = in_inbox
        .iter()
        .find(|preview| preview["name"] == "The report")
    else {
        bail!("the message with an attachment is not in the inbox view");
    };
    let thread = inbox
        .wait_for_thread(
            report["id"].as_str().unwrap_or_default(),
            "the imported message to list its attachment",
            |thread| thread["messages"][0]["attachments"][0]["db_id"].is_string(),
        )
        .await?;
    let attachment = &thread["messages"][0]["attachments"][0];
    assert_eq!(attachment["filename"], "report.pdf");
    let bytes = inbox
        .download_attachment(attachment["db_id"].as_str().unwrap_or_default())
        .await?;
    assert_eq!(bytes.as_ref(), REPORT);
    Ok(())
}

/// Mail a mailbox held before it was linked is all in Macro once the link
/// reports up to date: every thread once, in the right views, with the read
/// state and the attachment the provider holds. When it fails, a first
/// import lost, duplicated or misfiled mail.
async fn mail_present_before_linking_is_imported(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    seed_mailbox(
        &stack,
        provider,
        ada.email(),
        &lived_in_mailbox(ada.email()),
    )?;

    let inbox = ada.link(provider, ada.email()).await?;
    assert_lived_in_mailbox_imported(&inbox).await?;

    if provider == Provider::Gmail {
        let jobs = backfill_jobs(&inbox).await?;
        assert_eq!(jobs.len(), 1, "backfill jobs of the link: {jobs:?}");
        assert_eq!(jobs[0]["status"], "Complete");
        assert_eq!(jobs[0]["total_threads"], 32);
        let active = inbox.get("/email/backfill/gmail/active").await?;
        assert_eq!(active.status, 204, "no job is active: {}", active.text);
    }

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_mail_present_before_linking_is_imported() -> Result<(), Report> {
    mail_present_before_linking_is_imported(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_mail_present_before_linking_is_imported() -> Result<(), Report> {
    mail_present_before_linking_is_imported(Provider::Outlook).await
}

/// Mail that arrives while the first import is still running is in Macro
/// once, next to everything the import brought. When it fails, the import
/// and the live sync lost a message between them or both stored it.
async fn mail_arriving_during_the_import_is_kept_once(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    seed_mailbox(
        &stack,
        provider,
        ada.email(),
        &lived_in_mailbox(ada.email()),
    )?;

    let held = hold_import(&stack, provider, ada.email());
    let inbox = ada.start_link(provider, ada.email()).await?;
    inbox.deliver(&Mail::new(
        "Alan <alan@example.com>",
        "Arrived meanwhile",
        "Sent while you were connecting.",
    ))?;
    // The import was still running after the message arrived.
    assert_eq!(inbox.link().await?["sync_status"], SYNCING);
    release_import(&stack, provider, held);

    inbox.wait_until_synced().await?;
    let arrived = inbox.wait_for_preview("inbox", "Arrived meanwhile").await?;
    assert_eq!(arrived["isRead"], false);

    // A later message is the event after which a duplicate would show.
    inbox.deliver(&Mail::new(
        "Alan <alan@example.com>",
        "Arrived afterwards",
        "Sent once you were connected.",
    ))?;
    inbox
        .wait_for_preview("inbox", "Arrived afterwards")
        .await?;
    let all = inbox.previews("all").await?;
    assert_eq!(named(&all, "Arrived meanwhile"), 1);
    assert_eq!(all.len(), 34, "threads in the all view");
    assert_eq!(inbox.previews("inbox").await?.len(), 24);
    let thread = inbox
        .thread(arrived["id"].as_str().unwrap_or_default())
        .await?;
    assert_eq!(thread["messages"].as_array().map_or(0, Vec::len), 1);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_mail_arriving_during_the_import_is_kept_once() -> Result<(), Report> {
    mail_arriving_during_the_import_is_kept_once(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_mail_arriving_during_the_import_is_kept_once() -> Result<(), Report> {
    mail_arriving_during_the_import_is_kept_once(Provider::Outlook).await
}

/// Linking a mailbox that is already linked and imported answers the same
/// inbox and lists no thread twice; for Gmail, where the import is a job
/// and its requests can be counted, it also starts no second import and
/// reads the mailbox no further. When it fails, a repeated sign-in
/// duplicated threads or, for Gmail, ran the whole import a second time.
async fn linking_again_imports_nothing_twice(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    seed_mailbox(
        &stack,
        provider,
        ada.email(),
        &lived_in_mailbox(ada.email()),
    )?;
    let inbox = ada.link(provider, ada.email()).await?;
    let listings = gmail_calls(&stack, ada.email(), gmail_emulator::Route::ThreadsList);
    let thread_reads = gmail_calls(&stack, ada.email(), gmail_emulator::Route::ThreadsGet);

    let again = ada.start_link(provider, ada.email()).await?;
    assert_eq!(again.link_id(), inbox.link_id());
    again.wait_until_synced().await?;

    // A later message is the event after which a second import would show.
    inbox.deliver(&Mail::new(
        "Alan <alan@example.com>",
        "After linking again",
        "Still one of each?",
    ))?;
    inbox
        .wait_for_preview("inbox", "After linking again")
        .await?;
    assert_eq!(inbox.previews("all").await?.len(), 33);
    assert_no_thread_listed_twice(&inbox).await?;
    let links = ada.get("/email/links").await?.ok()?;
    assert_eq!(links["links"].as_array().map_or(0, Vec::len), 1);

    if provider == Provider::Gmail {
        assert_eq!(backfill_jobs(&inbox).await?.len(), 1);
        assert_eq!(
            gmail_calls(&stack, ada.email(), gmail_emulator::Route::ThreadsList),
            listings,
            "the mailbox was listed again"
        );
        // The message delivered above is the one thread read since.
        let read_since = gmail_calls(&stack, ada.email(), gmail_emulator::Route::ThreadsGet);
        assert!(
            read_since <= thread_reads + 1,
            "threads were read again: {read_since} after {thread_reads}"
        );
    }

    stack.finish().await
}

/// No two threads of the all view share a name, a leading "Re: " aside.
async fn assert_no_thread_listed_twice(inbox: &Inbox) -> Result<(), Report> {
    let all = inbox.previews("all").await?;
    let mut names: Vec<&str> = all
        .iter()
        .filter_map(|preview| preview["name"].as_str())
        .map(|name| name.trim_start_matches("Re: "))
        .collect();
    names.sort_unstable();
    let before = names.len();
    names.dedup();
    assert_eq!(names.len(), before, "a thread is in the all view twice");
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_linking_again_imports_nothing_twice() -> Result<(), Report> {
    linking_again_imports_nothing_twice(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_linking_again_imports_nothing_twice() -> Result<(), Report> {
    linking_again_imports_nothing_twice(Provider::Outlook).await
}

/// A provider that refuses a few requests of the first import, with a short
/// `Retry-After`, costs no mail: the import asks again and finishes. When it
/// fails, a throttled read dropped its thread or folder, or the import stuck.
async fn provider_throttling_during_the_import_loses_no_mail(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    seed_mailbox(
        &stack,
        provider,
        ada.email(),
        &lived_in_mailbox(ada.email()),
    )?;
    match provider {
        Provider::Gmail => {
            stack.gmail().inject_fault(gmail_emulator::Fault {
                mailbox: Some(ada.email().to_owned()),
                route: Some(gmail_emulator::Route::ThreadsGet),
                error: Some(gmail_emulator::FaultError::RateLimit),
                retry_after_seconds: Some(1),
                times: Some(3),
                ..Default::default()
            });
        }
        Provider::Outlook => {
            stack.outlook().inject_fault(outlook_emulator::Fault {
                mailbox: Some(ada.email().to_owned()),
                route: Some(outlook_emulator::Route::MessagesDelta),
                error: Some(outlook_emulator::FaultError::RateLimit),
                retry_after_seconds: Some(1),
                times: Some(1),
                ..Default::default()
            });
        }
    }

    let inbox = ada.link(provider, ada.email()).await?;
    assert_lived_in_mailbox_imported(&inbox).await?;
    let refused = match provider {
        Provider::Gmail => stack
            .gmail()
            .requests()
            .iter()
            .filter(|request| request.status == 429)
            .count(),
        Provider::Outlook => stack
            .outlook()
            .requests()
            .iter()
            .filter(|request| request.status == 429)
            .count(),
    };
    let expected = if provider == Provider::Gmail { 3 } else { 1 };
    assert_eq!(refused, expected, "requests the provider refused");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_provider_throttling_during_the_import_loses_no_mail() -> Result<(), Report> {
    provider_throttling_during_the_import_loses_no_mail(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_provider_throttling_during_the_import_loses_no_mail() -> Result<(), Report> {
    provider_throttling_during_the_import_loses_no_mail(Provider::Outlook).await
}

/// Records a finished Gmail sign-in for the user, as the authentication
/// service does, and returns the attempt `POST /email/init` is called with.
async fn finished_gmail_sign_in(stack: &Stack, user: &User, address: &str) -> Result<Uuid, Report> {
    let attempt = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO in_progress_user_link \
             (id, macro_user_id, linked_email, email_provider, requested_google_scopes, granted_google_scopes) \
         VALUES ($1, $2, $3, 'GMAIL'::email_user_provider_enum, $4, $4)",
    )
    .bind(attempt)
    .bind(user.fusion_id())
    .bind(address)
    .bind(vec![GMAIL_SCOPE.to_owned()])
    .execute(stack.db())
    .await
    .context("could not record the finished sign-in")?;
    Ok(attempt)
}

/// Five `POST /email/init` at once for one sign-in, and one more while the
/// backfill runs, start one backfill: every call answers the same inbox and
/// job, and the mailbox is listed and read once. When it fails, a double
/// click or a client that posts init twice multiplies the provider traffic
/// and the connection history of one inbox.
#[tokio::test(flavor = "multi_thread")]
async fn concurrent_init_calls_start_one_backfill() -> Result<(), Report> {
    const CALLS: usize = 5;
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let letters: Vec<Letter> = (1..=50)
        .map(|number| Letter::received(&format!("Note {number:02}"), false))
        .collect();
    seed_mailbox(&stack, Provider::Gmail, ada.email(), &letters)?;
    // Every call is inside its `users.watch` request before the first one
    // creates the inbox, so all of them go on to start a backfill.
    let slow_watch = stack.gmail().inject_fault(gmail_emulator::Fault {
        mailbox: Some(ada.email().to_owned()),
        route: Some(gmail_emulator::Route::Watch),
        delay_ms: Some(1500),
        ..Default::default()
    });

    let attempt = finished_gmail_sign_in(&stack, &ada, ada.email()).await?;
    let mut calls = tokio::task::JoinSet::new();
    for _ in 0..CALLS {
        let ada = ada.clone();
        calls.spawn(async move {
            ada.post(&format!("/email/init?link_id={attempt}"), None)
                .await
        });
    }
    let mut answers = Vec::new();
    while let Some(call) = calls.join_next().await {
        answers.push(call.context("an init call was aborted")??.ok()?);
    }
    stack.gmail().remove_fault(slow_watch);

    let link_id = answers[0]["link_id"].clone();
    let job_id = answers[0]["backfill_job_id"].clone();
    assert!(link_id.is_string() && job_id.is_string(), "{answers:?}");
    for answer in &answers {
        assert_eq!(answer["link_id"], link_id, "{answers:?}");
        assert_eq!(answer["backfill_job_id"], job_id, "{answers:?}");
    }

    // The client posting init once more, as on the next page load.
    let inbox = ada.start_link(Provider::Gmail, ada.email()).await?;
    assert_eq!(json!(inbox.link_id().to_string()), link_id);
    inbox.wait_until_synced().await?;

    let jobs = backfill_jobs(&inbox).await?;
    assert_eq!(jobs.len(), 1, "backfill jobs: {jobs:?}");
    assert_eq!(jobs[0]["id"], job_id);
    assert_eq!(jobs[0]["status"], "Complete");
    assert_eq!(inbox.previews("all").await?.len(), 50);

    // One listing for the priority pass and one for the sweep; one read per thread.
    assert_eq!(
        gmail_calls(&stack, ada.email(), gmail_emulator::Route::ThreadsList),
        2
    );
    assert_eq!(
        gmail_calls(&stack, ada.email(), gmail_emulator::Route::ThreadsGet),
        50
    );

    let connections: i64 =
        sqlx::query_scalar("SELECT count(*) FROM email_links_history WHERE link_id = $1")
            .bind(inbox.link_id())
            .fetch_one(stack.db())
            .await?;
    assert_eq!(connections, 1, "connections recorded for the inbox");
    let job_rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM email_backfill_jobs WHERE link_id = $1")
            .bind(inbox.link_id())
            .fetch_one(stack.db())
            .await?;
    assert_eq!(job_rows, 1);

    stack.finish().await
}

/// A user whose earlier connections left failed and cancelled backfill jobs
/// can disconnect an inbox, connect it again and connect a fourth one: each
/// is listed, imports its mail and reports up to date. When it fails, the
/// connect answers 429 or the inbox it just created is gone.
#[tokio::test(flavor = "multi_thread")]
async fn reconnecting_and_a_fourth_inbox_are_not_refused() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    // More than two inboxes need the professional plan.
    sqlx::query(
        r#"INSERT INTO "RolesOnUsers" ("userId", "roleId") VALUES ($1, 'professional_subscriber')"#,
    )
    .bind(ada.macro_id())
    .execute(stack.db())
    .await
    .context("could not grant the professional role")?;

    let addresses = [
        ada.email().to_owned(),
        "ada.work@example.com".to_owned(),
        "ada.side@example.com".to_owned(),
        "ada.club@example.com".to_owned(),
    ];
    for address in &addresses {
        let letters: Vec<Letter> = (1..=3)
            .map(|number| Letter::received(&format!("Note {number:02}"), false))
            .collect();
        seed_mailbox(&stack, Provider::Gmail, address, &letters)?;
    }
    let first = ada.link(Provider::Gmail, &addresses[0]).await?;
    let second = ada.link(Provider::Gmail, &addresses[1]).await?;
    let third = ada.link(Provider::Gmail, &addresses[2]).await?;

    // What earlier attempts on the third inbox left behind.
    for status in ["Failed", "Failed", "Cancelled"] {
        sqlx::query(
            "INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, status, created_at, updated_at) \
             VALUES ($1, $2, $3, $4::email_backfill_job_status, now() - interval '10 minutes', now() - interval '10 minutes')",
        )
        .bind(Uuid::now_v7())
        .bind(third.link_id())
        .bind(ada.fusion_id().to_string())
        .bind(status)
        .execute(stack.db())
        .await
        .context("could not record an earlier backfill job")?;
    }

    // Disconnect the third inbox and connect it again.
    let removed = ada
        .delete(&format!("/email/links/{}", third.link_id()), None)
        .await?;
    assert_eq!(removed.status, 204, "{}", removed.text);
    third
        .wait_for_link("the disconnected inbox to be gone", Value::is_null)
        .await?;
    let reconnected = ada.link(Provider::Gmail, &addresses[2]).await?;
    assert_eq!(reconnected.previews("all").await?.len(), 3);

    let fourth = ada.link(Provider::Gmail, &addresses[3]).await?;
    assert_eq!(fourth.previews("all").await?.len(), 3);

    let links = ada.get("/email/links").await?.ok()?;
    let mut listed: Vec<&str> = links["links"]
        .as_array()
        .map(|links| {
            links
                .iter()
                .filter_map(|link| link["email_address"].as_str())
                .collect()
        })
        .unwrap_or_default();
    listed.sort_unstable();
    let mut expected: Vec<&str> = addresses.iter().map(String::as_str).collect();
    expected.sort_unstable();
    assert_eq!(listed, expected, "{links}");
    for inbox in [&first, &second, &reconnected, &fourth] {
        assert_eq!(inbox.link().await?["sync_status"], "UP_TO_DATE");
    }

    stack.finish().await
}

/// An Outlook folder with more than a hundred messages is imported whole:
/// 250 in the inbox and 120 in a folder of the user's own. When it fails,
/// the import reports complete with only the newest hundred of each folder.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_folders_over_a_hundred_messages_are_imported_whole() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let message = |subject: String, folder: &str| outlook_emulator::NewMessage {
        from: Some("Grace <grace@example.com>".to_owned()),
        subject: Some(subject),
        text: Some("One of many.".to_owned()),
        folder: Some(folder.to_owned()),
        ..Default::default()
    };
    let messages = (1..=250)
        .map(|number| message(format!("Inbox {number:03}"), "inbox"))
        .chain((1..=120).map(|number| message(format!("Project {number:03}"), "Projects")))
        .collect();
    stack
        .outlook()
        .add_mailbox(&outlook_emulator::SeedMailbox {
            email: ada.email().to_owned(),
            folders: vec![outlook_emulator::SeedFolder {
                name: "Projects".to_owned(),
                parent: None,
            }],
            messages,
            ..Default::default()
        })?;

    let inbox = ada.link_outlook().await?;
    let in_inbox = inbox.previews("inbox").await?;
    let all = inbox.previews("all").await?;
    assert_eq!(in_inbox.len(), 250, "threads in the inbox view");
    assert_eq!(all.len(), 370, "threads in the all view");
    // The oldest of each folder are the ones a capped round leaves out.
    for oldest in ["Inbox 001", "Project 001"] {
        assert_eq!(named(&all, oldest), 1, "{oldest} in the all view");
    }

    // A folder round is paged by preference; `$top` would cap the round.
    let rounds: Vec<String> = stack
        .outlook()
        .requests()
        .into_iter()
        .filter(|request| request.route == Some(outlook_emulator::Route::MessagesDelta))
        .map(|request| request.path)
        .collect();
    assert!(
        rounds.iter().all(|path| !path.contains("top=")),
        "a folder delta request carries $top: {rounds:?}"
    );

    stack.finish().await
}

/// A backfill whose worker is killed while it initializes the job is taken
/// up again: the job completes and the inbox stops showing as syncing. When
/// it fails, the inbox says "syncing" for ever after a deploy or a crash.
#[tokio::test(flavor = "multi_thread")]
async fn backfill_completes_after_its_worker_died_during_init() -> Result<(), Report> {
    let mut stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let letters: Vec<Letter> = (1..=30)
        .map(|number| Letter::received(&format!("Note {number:02}"), false))
        .collect();
    seed_mailbox(&stack, Provider::Gmail, ada.email(), &letters)?;
    // Init reads the labels, then the profile: it hangs on the profile.
    stack.gmail().inject_fault(gmail_emulator::Fault {
        mailbox: Some(ada.email().to_owned()),
        route: Some(gmail_emulator::Route::GetProfile),
        delay_ms: Some(30_000),
        times: Some(1),
        ..Default::default()
    });

    let inbox = ada.start_link(Provider::Gmail, ada.email()).await?;
    eventually(
        "the backfill's init step to read the labels",
        DEFAULT_TIMEOUT,
        async || {
            let read = gmail_calls(&stack, ada.email(), gmail_emulator::Route::LabelsList);
            Ok((read > 0).then_some(()))
        },
    )
    .await?;
    stack.stop_workers().await;
    let jobs = backfill_jobs(&inbox).await?;
    assert_eq!(jobs.len(), 1, "{jobs:?}");
    assert_eq!(jobs[0]["status"], "Init", "the worker died during init");
    stack.start_workers()?;

    eventually(
        "the backfill job to complete after its worker died",
        RECOVERY_TIMEOUT,
        async || {
            let jobs = backfill_jobs(&inbox).await?;
            Ok((jobs.len() == 1 && jobs[0]["status"] == "Complete").then_some(()))
        },
    )
    .await?;
    assert_eq!(inbox.link().await?["sync_status"], "UP_TO_DATE");
    assert_eq!(inbox.previews("all").await?.len(), 30);

    stack.finish().await
}

/// Links a Gmail mailbox of `threads` one-message threads and returns once
/// its backfill has listed them all and imported none: the provider answers
/// each read of a thread late until the returned fault is removed.
async fn backfill_held_after_listing(
    stack: &Stack,
    user: &User,
    threads: usize,
) -> Result<(Inbox, u64), Report> {
    let letters: Vec<Letter> = (1..=threads)
        .map(|number| Letter::received(&format!("Note {number:02}"), false))
        .collect();
    seed_mailbox(stack, Provider::Gmail, user.email(), &letters)?;
    let held = stack.gmail().inject_fault(gmail_emulator::Fault {
        mailbox: Some(user.email().to_owned()),
        route: Some(gmail_emulator::Route::ThreadsGet),
        delay_ms: Some(5_000),
        ..Default::default()
    });
    let inbox = user.start_link(Provider::Gmail, user.email()).await?;
    eventually(
        "the backfill to list every thread",
        DEFAULT_TIMEOUT,
        async || {
            let jobs = backfill_jobs(&inbox).await?;
            let listed = jobs.len() == 1 && jobs[0]["threads_retrieved_count"] == threads;
            Ok(listed.then_some(()))
        },
    )
    .await?;
    Ok((inbox, held))
}

/// The Redis keys that count the finished threads of backfill jobs, one
/// per running job.
async fn backfill_progress_keys(stack: &Stack) -> Result<Vec<String>, Report> {
    let mut redis = stack.redis().await?;
    let keys: Vec<String> = redis.keys("bf_job_status:*").await?;
    Ok(keys)
}

/// The "import is done" events the client was sent for an inbox.
fn backfill_done_events(stack: &Stack, inbox: &Inbox) -> usize {
    let link_id = inbox.link_id().to_string();
    stack
        .service_requests()
        .iter()
        .filter(|request| {
            request.service == "connection-gateway"
                && request.body.as_ref().is_some_and(|body| {
                    body["message"]["event"] == "backfill_progress"
                        && body["message"]["status"] == "complete"
                        && body["message"]["link_id"] == link_id.as_str()
                })
        })
        .count()
}

/// A backfill whose progress counters vanish from Redis while it runs (a
/// Redis restart or eviction) still finishes: the job completes, the inbox
/// stops showing as syncing and all mail is there. When it fails, the job
/// stays in progress and the inbox says "syncing" for ever.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: backfill-job-never-completes"]
async fn backfill_completes_after_its_progress_counters_were_lost() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let (inbox, held) = backfill_held_after_listing(&stack, &ada, 30).await?;

    let counters = backfill_progress_keys(&stack).await?;
    assert_eq!(counters.len(), 1, "the job's progress counters");
    let mut redis = stack.redis().await?;
    let removed: usize = redis.del(&counters).await?;
    assert_eq!(removed, 1, "the progress counters were removed");
    stack.gmail().remove_fault(held);

    eventually(
        "the backfill job to complete after its progress counters were lost",
        RECOVERY_TIMEOUT,
        async || {
            let jobs = backfill_jobs(&inbox).await?;
            Ok((jobs.len() == 1 && jobs[0]["status"] == "Complete").then_some(()))
        },
    )
    .await?;
    assert_eq!(inbox.link().await?["sync_status"], "UP_TO_DATE");
    assert_eq!(inbox.previews("all").await?.len(), 30);
    assert_eq!(stack.dead_letters("backfill").await?, 0);

    stack.finish().await
}

/// A backfill whose completion message could not be put on the queue once
/// is still finished off: the job completes, the inbox stops showing as
/// syncing, all mail is there and the client is told the import is done,
/// once. When it fails, what follows a backfill (the remaining attachments,
/// the contacts, the "done" event the client waits for) never happens.
#[tokio::test(flavor = "multi_thread")]
async fn backfill_is_finished_off_after_its_completion_was_not_enqueued() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let (inbox, held) = backfill_held_after_listing(&stack, &ada, 30).await?;

    // The job cannot be marked complete while its row is locked, so once
    // every thread is counted the next send is the completion message.
    let mut job_row = stack.db().begin().await?;
    sqlx::query("SELECT id FROM email_backfill_jobs WHERE link_id = $1 FOR UPDATE")
        .bind(inbox.link_id())
        .execute(&mut *job_row)
        .await?;
    stack.gmail().remove_fault(held);
    eventually(
        "every thread of the backfill to be counted",
        DEFAULT_TIMEOUT,
        async || {
            let counters = backfill_progress_keys(&stack).await?;
            Ok(counters.is_empty().then_some(()))
        },
    )
    .await?;
    let jobs = backfill_jobs(&inbox).await?;
    assert_eq!(
        jobs[0]["status"], "InProgress",
        "the job while its row is locked"
    );
    stack.refuse_queue_sends("backfill", 1)?;
    job_row.rollback().await?;

    eventually(
        "the client to be told the import is done",
        DEFAULT_TIMEOUT,
        async || Ok((backfill_done_events(&stack, &inbox) > 0).then_some(())),
    )
    .await?;
    assert!(
        stack
            .workers_log()
            .contains("the scenario refused this send"),
        "no send to the backfill queue was refused"
    );
    let jobs = backfill_jobs(&inbox).await?;
    assert_eq!(jobs.len(), 1, "{jobs:?}");
    assert_eq!(jobs[0]["status"], "Complete");
    assert_eq!(inbox.link().await?["sync_status"], "UP_TO_DATE");
    assert_eq!(inbox.previews("all").await?.len(), 30);
    // A second "done" would come from a backfill message handled again:
    // none is left, and mail that arrives later has been synced since.
    eventually("the backfill queue to empty", DEFAULT_TIMEOUT, async || {
        Ok((stack.queue_depth("backfill").await? == 0).then_some(()))
    })
    .await?;
    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "After the import",
        "Marker.",
    ))?;
    inbox.wait_for_preview("inbox", "After the import").await?;
    assert_eq!(backfill_done_events(&stack, &inbox), 1, "done events");
    assert_eq!(stack.dead_letters("backfill").await?, 0);

    stack.finish().await
}

/// The attachments the services asked document storage to keep as
/// documents, each counted once.
fn imported_attachments(stack: &Stack) -> usize {
    let mut attachments: Vec<String> = stack
        .service_requests()
        .into_iter()
        .filter(|request| {
            request.service == "document-storage" && request.path == "/internal/documents"
        })
        .filter_map(|request| {
            request.body?["emailAttachmentId"]
                .as_str()
                .map(str::to_owned)
        })
        .collect();
    attachments.sort_unstable();
    attachments.dedup();
    attachments.len()
}

/// Links a Gmail mailbox of twenty messages with an attachment each while
/// Gmail answers the first five attachment downloads with `error`, and
/// expects every attachment to become a document.
async fn backfilled_attachments_are_all_imported(
    error: gmail_emulator::FaultError,
) -> Result<(), Report> {
    const MESSAGES: usize = 20;
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let letters: Vec<Letter> = (1..=MESSAGES)
        .map(|number| {
            let mut letter = Letter::received(&format!("Invoice {number:02}"), false);
            letter.attachment = Some(("invoice.pdf", "application/pdf", REPORT));
            letter
        })
        .collect();
    seed_mailbox(&stack, Provider::Gmail, ada.email(), &letters)?;
    stack.gmail().inject_fault(gmail_emulator::Fault {
        mailbox: Some(ada.email().to_owned()),
        route: Some(gmail_emulator::Route::AttachmentsGet),
        error: Some(error),
        retry_after_seconds: Some(1),
        times: Some(5),
        ..Default::default()
    });

    let inbox = ada.link_gmail().await?;
    assert_eq!(inbox.previews("all").await?.len(), MESSAGES);
    // A document is asked for before its file is uploaded: wait for both.
    let stored_files = || {
        stack
            .stored_objects()
            .iter()
            .filter(|object| object.bytes.as_ref() == REPORT)
            .count()
    };
    eventually(
        "every backfilled attachment to be imported as a document and its file stored",
        DEFAULT_TIMEOUT,
        async || {
            Ok(
                (imported_attachments(&stack) == MESSAGES && stored_files() >= MESSAGES)
                    .then_some(()),
            )
        },
    )
    .await?;
    let refused = stack
        .gmail()
        .requests()
        .iter()
        .filter(|request| {
            request.route == Some(gmail_emulator::Route::AttachmentsGet) && request.status >= 400
        })
        .count();
    assert_eq!(refused, 5, "attachment downloads Gmail refused");

    stack.finish().await
}

/// Every attachment of backfilled mail is imported as a document although
/// Gmail throttles the first attachment downloads. When it fails, some
/// attachments of a newly linked mailbox never become documents and nothing
/// retries them.
#[tokio::test(flavor = "multi_thread")]
async fn backfilled_attachments_are_all_imported_despite_throttling() -> Result<(), Report> {
    backfilled_attachments_are_all_imported(gmail_emulator::FaultError::RateLimit).await
}

/// Every attachment of backfilled mail is imported as a document although
/// Gmail fails the first attachment downloads with a server error. When it
/// fails, an attachment whose download failed once is never a document.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: backfill-attachment-loss-ordering"]
async fn backfilled_attachments_are_all_imported_despite_provider_errors() -> Result<(), Report> {
    backfilled_attachments_are_all_imported(gmail_emulator::FaultError::Internal).await
}

/// Linking a mailbox with no mail finishes at once: the job is complete and
/// the inbox up to date, and mail that arrives next is synced. When it
/// fails, a new, empty inbox shows "syncing" for ever.
async fn an_empty_mailbox_finishes_its_import(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;

    let inbox = ada.link(provider, ada.email()).await?;
    assert!(inbox.previews("all").await?.is_empty());
    if provider == Provider::Gmail {
        let jobs = backfill_jobs(&inbox).await?;
        assert_eq!(jobs.len(), 1, "{jobs:?}");
        assert_eq!(jobs[0]["status"], "Complete");
        assert_eq!(jobs[0]["total_threads"], 0);
    }
    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "First mail",
        "Welcome.",
    ))?;
    inbox.wait_for_preview("inbox", "First mail").await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_an_empty_mailbox_finishes_its_import() -> Result<(), Report> {
    an_empty_mailbox_finishes_its_import(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_an_empty_mailbox_finishes_its_import() -> Result<(), Report> {
    an_empty_mailbox_finishes_its_import(Provider::Outlook).await
}

/// A Gmail mailbox whose profile counts threads that the listing does not
/// return (here: everything is in the bin) still finishes its backfill.
/// When it fails, such an inbox shows "syncing" for ever.
#[tokio::test(flavor = "multi_thread")]
async fn a_mailbox_whose_listing_is_empty_finishes_its_backfill() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let messages = (1..=3)
        .map(|number| gmail_emulator::NewMessage {
            from: Some("Grace <grace@example.com>".to_owned()),
            subject: Some(format!("Binned {number}")),
            text: Some("Thrown away.".to_owned()),
            labels: Some(vec!["TRASH".to_owned()]),
            ..Default::default()
        })
        .collect();
    stack.gmail().add_mailbox(&gmail_emulator::SeedMailbox {
        email: ada.email().to_owned(),
        messages,
        ..Default::default()
    })?;

    let inbox = ada.link_gmail().await?;
    let jobs = backfill_jobs(&inbox).await?;
    assert_eq!(jobs.len(), 1, "{jobs:?}");
    assert_eq!(jobs[0]["status"], "Complete");
    // The profile counted the binned threads; the listing returned none.
    assert_eq!(jobs[0]["total_threads"], 3);
    assert_eq!(jobs[0]["threads_retrieved_count"], 0);
    assert_eq!(
        gmail_calls(&stack, ada.email(), gmail_emulator::Route::ThreadsGet),
        0
    );

    stack.finish().await
}

/// A backfill reads each thread with one `threads.get` and no message with
/// a `messages.get` of its own, however many messages the thread holds.
/// When it fails, connecting a large mailbox costs the provider and the
/// database one round per message again.
#[tokio::test(flavor = "multi_thread")]
async fn backfill_reads_each_thread_once() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let mut letters = Vec::new();
    for number in 1..=10 {
        letters.push(Letter::received(&format!("Single {number:02}"), false));
    }
    for number in 1..=10 {
        let ids: Vec<String> = (1..=4)
            .map(|part| format!("long-{number}-{part}@mail.example.com"))
            .collect();
        letters.push(Letter::received(&format!("Long {number:02}"), true).id(&ids[0]));
        for part in 1..4 {
            letters.push(
                Letter::received(&format!("Re: Long {number:02}"), true)
                    .id(&ids[part])
                    .reply_to(&ids[part - 1]),
            );
        }
    }
    seed_mailbox(&stack, Provider::Gmail, ada.email(), &letters)?;

    let inbox = ada.link_gmail().await?;
    let all = inbox.previews("all").await?;
    assert_eq!(all.len(), 20, "threads in the all view");
    let Some(long) = preview_ending(&all, "Long 07") else {
        bail!("a long thread is missing from the all view");
    };
    let thread = inbox
        .thread(long["id"].as_str().unwrap_or_default())
        .await?;
    assert_eq!(thread["messages"].as_array().map_or(0, Vec::len), 4);

    assert_eq!(
        gmail_calls(&stack, ada.email(), gmail_emulator::Route::ThreadsGet),
        20,
        "one read per thread"
    );
    assert_eq!(
        gmail_calls(&stack, ada.email(), gmail_emulator::Route::MessagesGet),
        0,
        "no message is read on its own"
    );

    stack.finish().await
}
