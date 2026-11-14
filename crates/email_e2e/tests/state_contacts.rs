//! Senders, recipients and the contacts Macro derives from mail.

use std::collections::BTreeSet;

use email_e2e::{Inbox, Mail, Provider, Report, Stack};
use serde_json::{Value, json};

/// The pairs of users a contacts message connects, each pair sorted.
fn connections(message: &Value) -> BTreeSet<(String, String)> {
    message["connections"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|pair| {
            let first = pair["first"].as_str().unwrap_or_default().to_owned();
            let second = pair["second"].as_str().unwrap_or_default().to_owned();
            if first <= second {
                (first, second)
            } else {
                (second, first)
            }
        })
        .collect()
}

/// Mail the user sends to several people connects the user with each of
/// them, and not the recipients with one another.
///
/// When it fails: everyone on a mail becomes a contact of everyone else on
/// it, so people see strangers from a colleague's mail as their contacts.
async fn sent_mail_connects_the_sender_with_each_recipient(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    stack.take_queue_messages("contacts").await?;

    inbox
        .send(&json!({
            "subject": "Kickoff",
            "to": [{ "email": "xavier@example.com" }],
            "cc": [{ "email": "yara@example.com" }, { "email": "zoe@example.com" }],
            "body_text": "See you all there.",
        }))
        .await?;
    inbox.wait_for_preview("sent", "Kickoff").await?;

    // A later mail, so that everything the first one caused has been seen
    // by the time its own contact arrives.
    inbox
        .send(&json!({
            "subject": "Afterwards",
            "to": [{ "email": "walt@example.com" }],
            "body_text": "One more.",
        }))
        .await?;
    inbox.wait_for_preview("sent", "Afterwards").await?;

    let mut seen = Vec::new();
    let expected: BTreeSet<(String, String)> = ["walt", "xavier", "yara", "zoe"]
        .into_iter()
        .map(|name| {
            (
                ada.macro_id().to_owned(),
                format!("macro|{name}@example.com"),
            )
        })
        .collect();
    email_e2e::eventually(
        "the contacts of the sent mail",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            seen.extend(stack.take_queue_messages("contacts").await?);
            let all: BTreeSet<_> = seen.iter().flat_map(connections).collect();
            Ok(all.is_superset(&expected).then_some(()))
        },
    )
    .await?;
    let all: BTreeSet<_> = seen.iter().flat_map(connections).collect();
    assert_eq!(
        all, expected,
        "only the sender is connected with each recipient"
    );
    assert!(
        seen.iter().all(|message| message.get("users").is_none()),
        "no message asks to connect a whole group: {seen:?}"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_sent_mail_connects_the_sender_with_each_recipient() -> Result<(), Report> {
    sent_mail_connects_the_sender_with_each_recipient(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_sent_mail_connects_the_sender_with_each_recipient() -> Result<(), Report> {
    sent_mail_connects_the_sender_with_each_recipient(Provider::Outlook).await
}

/// Received mail connects the inbox's owner with its sender.
///
/// When it fails: people who wrote to the user are missing from their
/// contacts, or the sender is connected with the mail's other recipients.
async fn received_mail_connects_the_owner_with_the_sender(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    stack.take_queue_messages("contacts").await?;

    let mut mail = Mail::new("Grace <grace@example.com>", "Intro", "Meet Alan.");
    mail.cc = Some("Alan <alan@example.com>".to_owned());
    inbox.deliver(&mail)?;
    inbox.wait_for_preview("inbox", "Intro").await?;
    // A later mail, so that everything the first one caused has been seen
    // by the time its own contact arrives.
    inbox.deliver(&Mail::new("Walt <walt@example.com>", "Afterwards", "Hi."))?;
    inbox.wait_for_preview("inbox", "Afterwards").await?;

    let mut seen = Vec::new();
    let wanted = (
        ada.macro_id().to_owned(),
        "macro|walt@example.com".to_owned(),
    );
    let from_grace = (
        ada.macro_id().to_owned(),
        "macro|grace@example.com".to_owned(),
    );
    email_e2e::eventually(
        "the contact of the received mail",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            seen.extend(stack.take_queue_messages("contacts").await?);
            let all: BTreeSet<_> = seen.iter().flat_map(connections).collect();
            Ok((all.contains(&wanted) && all.contains(&from_grace)).then_some(()))
        },
    )
    .await?;
    let all: BTreeSet<_> = seen.iter().flat_map(connections).collect();
    assert!(
        !all.contains(&(
            "macro|alan@example.com".to_owned(),
            "macro|grace@example.com".to_owned()
        )),
        "the sender and the other recipient are not connected: {all:?}"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_received_mail_connects_the_owner_with_the_sender() -> Result<(), Report> {
    received_mail_connects_the_owner_with_the_sender(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_received_mail_connects_the_owner_with_the_sender() -> Result<(), Report> {
    received_mail_connects_the_owner_with_the_sender(Provider::Outlook).await
}

/// Two mails from one address under different names each show the name
/// they were sent under, in the list and in the thread.
///
/// When it fails: every mail from a shared address (a ticket system, a
/// team mailbox) shows the name of whoever wrote from it first or last.
async fn each_mail_shows_the_name_it_was_sent_under(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.deliver(&Mail::new(
        "Billing Team <desk@example.net>",
        "Your invoice",
        "Attached.",
    ))?;
    let invoice = inbox.wait_for_preview("inbox", "Your invoice").await?;
    inbox.deliver(&Mail::new(
        "Sam from Support <desk@example.net>",
        "Your ticket",
        "Solved.",
    ))?;
    let ticket = inbox.wait_for_preview("inbox", "Your ticket").await?;
    let invoice = inbox
        .wait_for_preview_where("inbox", "the first mail after the second", |preview| {
            preview["id"] == invoice["id"]
        })
        .await?;

    assert_eq!(invoice["senderName"], "Billing Team");
    assert_eq!(ticket["senderName"], "Sam from Support");
    assert_eq!(invoice["senderEmail"], "desk@example.net");
    for (preview, name) in [(&invoice, "Billing Team"), (&ticket, "Sam from Support")] {
        let thread = inbox
            .thread(preview["id"].as_str().unwrap_or_default())
            .await?;
        assert_eq!(thread["messages"][0]["from"]["name"], name);
        assert_eq!(thread["messages"][0]["from"]["email"], "desk@example.net");
    }

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_each_mail_shows_the_name_it_was_sent_under() -> Result<(), Report> {
    each_mail_shows_the_name_it_was_sent_under(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_each_mail_shows_the_name_it_was_sent_under() -> Result<(), Report> {
    each_mail_shows_the_name_it_was_sent_under(Provider::Outlook).await
}

/// The list row of an Outlook reply shows what the sender wrote, not the
/// quoted mail under it.
///
/// When it fails: Outlook threads preview the quoted original ("On Monday
/// Ada wrote…") instead of the new text.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_reply_is_previewed_by_its_new_text() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;

    let mut mail = Mail::new("Grace <grace@example.com>", "Re: Friday", "See you then!");
    mail.html = Some(
        "<div>See you then!</div>\
         <blockquote><div>On Monday Ada wrote:</div><div>Are we still on for Friday?</div></blockquote>"
            .to_owned(),
    );
    inbox.deliver(&mail)?;
    let preview = inbox.wait_for_preview("inbox", "Re: Friday").await?;
    assert_eq!(
        preview["snippet"].as_str().map(str::trim),
        Some("See you then!")
    );

    stack.finish().await
}

/// Saves a person in the mailbox owner's address book at the provider, as
/// the provider's own contacts app does.
fn save_in_address_book(
    stack: &Stack,
    provider: Provider,
    mailbox: &str,
    address: &str,
    name: &str,
) -> Result<(), Report> {
    match provider {
        Provider::Gmail => stack.gmail().upsert_contact(
            mailbox,
            email_e2e::gmail_emulator::SeedContact {
                email: address.to_owned(),
                name: Some(name.to_owned()),
                photo_url: None,
            },
            false,
        )?,
        Provider::Outlook => {
            stack.outlook().upsert_contact(
                mailbox,
                None,
                &email_e2e::outlook_emulator::SeedContact {
                    email: address.to_owned(),
                    name: Some(name.to_owned()),
                },
            )?;
        }
    }
    Ok(())
}

/// How many requests of one route the provider answered the mailbox with
/// success.
fn provider_calls(stack: &Stack, provider: Provider, mailbox: &str, route: &str) -> usize {
    match provider {
        Provider::Gmail => stack
            .gmail()
            .requests()
            .iter()
            .filter(|request| {
                request.mailbox.as_deref() == Some(mailbox)
                    && request.route.is_some_and(|name| name.to_string() == route)
                    && request.status < 300
            })
            .count(),
        Provider::Outlook => stack
            .outlook()
            .requests()
            .iter()
            .filter(|request| {
                request.mailbox.as_deref() == Some(mailbox)
                    && request.route.is_some_and(|name| name.to_string() == route)
                    && request.status < 300
            })
            .count(),
    }
}

/// Waits until the recipient picker lists an address with a name, and
/// answers the name.
async fn wait_for_picker_name(inbox: &Inbox, address: &str) -> Result<String, Report> {
    let link_id = inbox.link_id().to_string();
    email_e2e::eventually(
        &format!("the recipient picker to list {address} with a name"),
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let contacts = inbox.get("/email/contacts").await?.ok()?;
            Ok(contacts["contacts"][&link_id]
                .as_array()
                .into_iter()
                .flatten()
                .find(|contact| contact["email_address"] == address)
                .and_then(|contact| contact["name"].as_str())
                .map(str::to_owned))
        },
    )
    .await
}

/// The provider's address book reaches Macro: the people saved there
/// before the inbox was linked, and one saved later, at the next refresh.
/// Someone the user then writes to by a bare address is listed by the
/// recipient picker under the name the address book gives them.
///
/// When it fails: the address book is read and thrown away, so people the
/// user saved at the provider have no name in Macro until they write
/// themselves, or contacts saved after linking never arrive.
async fn address_book_names_the_people_the_user_writes_to(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    stack.seed_mailbox(provider, ada.email(), &[])?;
    save_in_address_book(
        &stack,
        provider,
        ada.email(),
        "grace@example.com",
        "Grace Brewster Hopper",
    )?;
    let inbox = ada.link(provider, ada.email()).await?;

    // The provider was asked for the address book.
    let routes = match provider {
        Provider::Gmail => ["people.connections.list", "otherContacts.list"],
        Provider::Outlook => ["contactFolders.list", "contacts.list"],
    };
    for route in routes {
        email_e2e::eventually(
            &format!("Macro to ask the provider for {route}"),
            email_e2e::DEFAULT_TIMEOUT,
            async || Ok((provider_calls(&stack, provider, ada.email(), route) > 0).then_some(())),
        )
        .await?;
    }

    inbox
        .send(&json!({
            "subject": "Compiler notes",
            "to": [{ "email": "grace@example.com" }],
            "body_text": "Here are my notes.",
        }))
        .await?;
    assert_eq!(
        wait_for_picker_name(&inbox, "grace@example.com").await?,
        "Grace Brewster Hopper"
    );

    // A person saved after linking arrives with the periodic refresh.
    save_in_address_book(
        &stack,
        provider,
        ada.email(),
        "linus@example.com",
        "Linus Benedict Torvalds",
    )?;
    stack
        .send_to_queue(
            "link-manager",
            &json!({ "operation": "Refresh", "link_id": inbox.link_id() }),
        )
        .await?;
    inbox
        .send(&json!({
            "subject": "Kernel notes",
            "to": [{ "email": "linus@example.com" }],
            "body_text": "And these.",
        }))
        .await?;
    assert_eq!(
        wait_for_picker_name(&inbox, "linus@example.com").await?,
        "Linus Benedict Torvalds"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_address_book_names_the_people_the_user_writes_to() -> Result<(), Report> {
    address_book_names_the_people_the_user_writes_to(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_address_book_names_the_people_the_user_writes_to() -> Result<(), Report> {
    address_book_names_the_people_the_user_writes_to(Provider::Outlook).await
}
