//! The thread lists: what each view holds and how it pages.

use std::collections::BTreeSet;

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
                && spam.iter().any(|preview| preview["name"] == last_junk.as_str())
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
