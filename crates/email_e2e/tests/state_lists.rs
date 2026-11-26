//! The thread lists: what each view holds and how it pages.

use std::collections::BTreeSet;
use std::time::Duration;

use email_e2e::{Inbox, Mail, Provider, Report, Stack, User, gmail_emulator, outlook_emulator};
use rootcause::prelude::*;
use serde_json::Value;

/// Where a message lies at the provider.
#[derive(Clone, Copy)]
enum Place {
    Inbox,
    Spam,
    Trash,
}

/// Puts a message in one of the mailbox's folders at the provider, as the
/// provider's own filing (spam filter, the owner's other client) would.
fn deliver_to(stack: &Stack, inbox: &Inbox, mail: &Mail, place: Place) -> Result<(), Report> {
    match inbox.provider() {
        Provider::Gmail => {
            let labels = match place {
                Place::Inbox => vec!["INBOX", "UNREAD"],
                Place::Spam => vec!["SPAM", "UNREAD"],
                Place::Trash => vec!["TRASH"],
            };
            stack.gmail().deliver(
                inbox.email(),
                &gmail_emulator::NewMessage {
                    from: Some(mail.from.clone()),
                    subject: Some(mail.subject.clone()),
                    text: Some(mail.text.clone()),
                    message_id: mail.message_id.clone(),
                    in_reply_to: mail.in_reply_to.clone(),
                    labels: Some(labels.into_iter().map(str::to_owned).collect()),
                    ..Default::default()
                },
            )?;
        }
        Provider::Outlook => {
            let folder = match place {
                Place::Inbox => "inbox",
                Place::Spam => "junkemail",
                Place::Trash => "deleteditems",
            };
            stack.outlook().deliver(
                inbox.email(),
                &outlook_emulator::NewMessage {
                    from: Some(mail.from.clone()),
                    subject: Some(mail.subject.clone()),
                    text: Some(mail.text.clone()),
                    message_id: mail.message_id.clone(),
                    in_reply_to: mail.in_reply_to.clone(),
                    folder: Some(folder.to_owned()),
                    ..Default::default()
                },
            )?;
        }
    }
    Ok(())
}

/// Reads a view page by page the way the list does, following the cursor
/// until the API gives none, and returns the pages.
async fn pages(user: &User, view: &str, page_size: usize) -> Result<Vec<Vec<Value>>, Report> {
    let mut pages = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut path = format!("/email/threads/previews/cursor/{view}?limit={page_size}");
        if let Some(cursor) = &cursor {
            path.push_str(&format!("&cursor={}", urlencoding::encode(cursor)));
        }
        let page = user.get(&path).await?.ok()?;
        let items = page["items"].as_array().cloned().unwrap_or_default();
        cursor = page["next_cursor"].as_str().map(str::to_owned);
        let last = cursor.is_none();
        if !items.is_empty() || !last {
            pages.push(items);
        }
        if last {
            return Ok(pages);
        }
        if pages.len() > 100 {
            bail!("the {view} view never stops paging");
        }
    }
}

/// The subjects of every thread on the pages.
fn subjects(pages: &[Vec<Value>]) -> Vec<String> {
    pages
        .iter()
        .flatten()
        .map(|preview| preview["name"].as_str().unwrap_or_default().to_owned())
        .collect()
}

/// All Mail holds neither junk nor trashed mail, its pages are full until
/// the last one, and a thread with a trashed message is previewed by the
/// message that is not.
///
/// When it fails: junk or deleted threads show in All Mail, the list stops
/// early with mail still below, or a row shows text the user deleted.
async fn all_mail_leaves_out_spam_and_trash(provider: Provider) -> Result<(), Report> {
    const NORMAL: usize = 11;
    const HIDDEN: usize = 5;
    const PAGE: usize = 4;

    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    // Interleaved, so that hidden threads sit between the listed ones in
    // time: a limit that counted them would cut pages short.
    for index in 0..NORMAL {
        let mail = Mail::new(
            "Grace <grace@example.com>",
            &format!("Normal {index:02}"),
            "Kept.",
        );
        deliver_to(&stack, &inbox, &mail, Place::Inbox)?;
        if index < HIDDEN {
            let junk = Mail::new(
                "Spammer <spam@example.net>",
                &format!("Junk {index:02}"),
                "Win.",
            );
            deliver_to(&stack, &inbox, &junk, Place::Spam)?;
            let deleted = Mail::new(
                "Alan <alan@example.com>",
                &format!("Deleted {index:02}"),
                "Gone.",
            );
            deliver_to(&stack, &inbox, &deleted, Place::Trash)?;
        }
    }
    // One thread with a kept message and a newer trashed reply.
    let mut first = Mail::new(
        "Grace <grace@example.com>",
        "Mixed thread",
        "The kept message.",
    );
    first.message_id = Some("mixed-1@example.com".to_owned());
    deliver_to(&stack, &inbox, &first, Place::Inbox)?;
    let reply = Mail::new(
        "Grace <grace@example.com>",
        "Re: Mixed thread",
        "The deleted reply.",
    )
    .in_reply_to("mixed-1@example.com");
    deliver_to(&stack, &inbox, &reply, Place::Trash)?;

    // Everything has been synced once each view the mail belongs to is full.
    let last_junk = format!("Junk {:02}", HIDDEN - 1);
    let last_deleted = format!("Deleted {:02}", HIDDEN - 1);
    email_e2e::eventually(
        "every delivered thread to be synced",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let spam = inbox.previews("spam").await?;
            let trash = inbox.previews("trash").await?;
            let all = inbox.previews("all").await?;
            let mixed_synced = trash
                .iter()
                .any(|preview| preview["name"] == "Re: Mixed thread");
            let done = spam.len() == HIDDEN
                && spam
                    .iter()
                    .any(|preview| preview["name"] == last_junk.as_str())
                && trash
                    .iter()
                    .any(|preview| preview["name"] == last_deleted.as_str())
                && mixed_synced
                && all.len() > NORMAL;
            Ok(done.then_some(()))
        },
    )
    .await?;

    let listed = pages(&ada, "all", PAGE).await?;
    let names = subjects(&listed);
    let expected: BTreeSet<String> = (0..NORMAL)
        .map(|index| format!("Normal {index:02}"))
        .chain(std::iter::once("Mixed thread".to_owned()))
        .collect();
    assert_eq!(
        names.iter().cloned().collect::<BTreeSet<_>>(),
        expected,
        "All Mail lists exactly the threads with mail outside Spam and Trash"
    );
    assert_eq!(names.len(), expected.len(), "no thread is listed twice");
    let sizes: Vec<usize> = listed.iter().map(Vec::len).collect();
    assert_eq!(
        sizes,
        vec![PAGE, PAGE, PAGE],
        "every page before the end is full"
    );

    let mixed = listed
        .iter()
        .flatten()
        .find(|preview| preview["name"] == "Mixed thread");
    assert_eq!(
        mixed.map(|preview| preview["snippet"].clone()),
        Some(Value::from("The kept message.")),
        "the row previews the message that is not in Trash"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_all_mail_leaves_out_spam_and_trash() -> Result<(), Report> {
    all_mail_leaves_out_spam_and_trash(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_all_mail_leaves_out_spam_and_trash() -> Result<(), Report> {
    all_mail_leaves_out_spam_and_trash(Provider::Outlook).await
}

/// The promotions-and-other list is paged over the mail that belongs in it:
/// newer mail of other kinds does not use up the page.
///
/// When it fails: the list shows fewer rows than its page size, or nothing,
/// while matching mail lies further down.
async fn other_view_pages_over_its_own_mail(provider: Provider) -> Result<(), Report> {
    const OTHER: usize = 6;
    const PRIMARY: usize = 12;
    const PAGE: usize = 3;

    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    // The promotions first, so that every primary thread is newer.
    for index in 0..OTHER {
        let subject = format!("Offer {index:02}");
        // A minute apart, an hour ago: no two rows share a timestamp.
        let age = Duration::from_secs(3600 - 60 * index as u64);
        match provider {
            Provider::Gmail => {
                stack.gmail().deliver(
                    inbox.email(),
                    &gmail_emulator::NewMessage {
                        from: Some("Shop <deals@example.net>".to_owned()),
                        subject: Some(subject),
                        date: Some(stack.gmail().now() - age),
                        text: Some("Sale.".to_owned()),
                        labels: Some(
                            ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"]
                                .map(str::to_owned)
                                .to_vec(),
                        ),
                        ..Default::default()
                    },
                )?;
            }
            Provider::Outlook => {
                stack.outlook().deliver(
                    inbox.email(),
                    &outlook_emulator::NewMessage {
                        from: Some("Shop <deals@example.net>".to_owned()),
                        subject: Some(subject),
                        date: Some(stack.outlook().now() - age),
                        text: Some("Sale.".to_owned()),
                        other: true,
                        ..Default::default()
                    },
                )?;
            }
        }
    }
    inbox
        .wait_for_preview("other", &format!("Offer {:02}", OTHER - 1))
        .await?;
    for index in 0..PRIMARY {
        inbox.deliver(&Mail::new(
            "Grace <grace@example.com>",
            &format!("Primary {index:02}"),
            "Hello.",
        ))?;
    }
    inbox
        .wait_for_preview("inbox", &format!("Primary {:02}", PRIMARY - 1))
        .await?;
    email_e2e::eventually(
        "every delivered thread to be synced",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let all = inbox.previews("all").await?;
            Ok((all.len() == OTHER + PRIMARY).then_some(()))
        },
    )
    .await?;

    let listed = pages(&ada, "other", PAGE).await?;
    let expected: BTreeSet<String> = (0..OTHER)
        .map(|index| format!("Offer {index:02}"))
        .collect();
    assert_eq!(
        subjects(&listed).into_iter().collect::<BTreeSet<_>>(),
        expected,
        "the list holds every promotion and nothing else"
    );
    let sizes: Vec<usize> = listed.iter().map(Vec::len).collect();
    assert_eq!(sizes, vec![PAGE, PAGE], "every page before the end is full");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_other_view_pages_over_its_own_mail() -> Result<(), Report> {
    other_view_pages_over_its_own_mail(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_other_view_pages_over_its_own_mail() -> Result<(), Report> {
    other_view_pages_over_its_own_mail(Provider::Outlook).await
}

/// The Sent list holds what the user sent from every inbox they linked, not
/// only from the first.
///
/// When it fails: mail sent from a second inbox is missing from Sent.
async fn sent_lists_mail_from_every_inbox(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let first = ada.link(provider, ada.email()).await?;
    let second = ada.link(provider, "ada.work@example.com").await?;

    first
        .send(&serde_json::json!({
            "subject": "From the first inbox",
            "to": [{ "email": "grace@example.com" }],
            "body_text": "One.",
        }))
        .await?;
    second
        .send(&serde_json::json!({
            "subject": "From the second inbox",
            "to": [{ "email": "grace@example.com" }],
            "body_text": "Two.",
        }))
        .await?;
    first
        .wait_for_preview("sent", "From the first inbox")
        .await?;
    second
        .wait_for_preview("sent", "From the second inbox")
        .await?;

    // The list as the app asks for it: no inbox named.
    let listed = pages(&ada, "sent", 20).await?;
    let by_subject = |subject: &str| {
        listed
            .iter()
            .flatten()
            .find(|preview| preview["name"] == subject)
            .map(|preview| preview["linkId"].clone())
    };
    assert_eq!(
        by_subject("From the first inbox"),
        Some(Value::from(first.link_id().to_string()))
    );
    assert_eq!(
        by_subject("From the second inbox"),
        Some(Value::from(second.link_id().to_string())),
        "mail sent from the second inbox is in Sent"
    );
    assert_eq!(
        subjects(&listed).len(),
        2,
        "each sent thread is listed once"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_sent_lists_mail_from_every_inbox() -> Result<(), Report> {
    sent_lists_mail_from_every_inbox(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_sent_lists_mail_from_every_inbox() -> Result<(), Report> {
    sent_lists_mail_from_every_inbox(Provider::Outlook).await
}
