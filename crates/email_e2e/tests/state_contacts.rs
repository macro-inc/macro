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
                    photo: None,
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
        "Grace Example",
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
        "Grace Example"
    );

    // A person saved after linking arrives with the periodic refresh.
    save_in_address_book(
        &stack,
        provider,
        ada.email(),
        "linus@example.com",
        "Linus Example",
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
        "Linus Example"
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

/// The smallest PNG there is: one transparent pixel.
const PIXEL_PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/// The pushes that told the user's open app the inbox has its photo.
fn photo_pushes(stack: &Stack, inbox: &Inbox) -> usize {
    let link_id = inbox.link_id().to_string();
    stack
        .service_requests()
        .into_iter()
        .filter(|request| request.service == "connection-gateway")
        .filter_map(|request| request.body)
        .filter(|body| {
            body["message_type"] == "refresh_email"
                && body["message"]["event"] == "photo_synced"
                && body["message"]["link_id"] == link_id.as_str()
        })
        .count()
}

/// The photo the owner has at Outlook becomes the inbox's photo in Macro:
/// it is read from Outlook, kept with Macro's static files, shown on the
/// inbox, and the open app is told to read it.
///
/// When it fails: an Outlook inbox never gets its owner's picture, or gets
/// it only after the app is reloaded.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_the_owners_photo_becomes_the_inboxs() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    stack
        .outlook()
        .add_mailbox(&email_e2e::outlook_emulator::SeedMailbox {
            email: ada.email().to_owned(),
            photo: Some(email_e2e::outlook_emulator::SeedPhoto {
                mime_type: Some("image/png".to_owned()),
                base64: PIXEL_PNG_BASE64.to_owned(),
            }),
            ..Default::default()
        })?;
    let inbox = ada.link_outlook().await?;

    let photo_url = email_e2e::eventually(
        "the inbox to show its owner's photo",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let link = inbox.link().await?;
            Ok(link["photo_url"].as_str().map(str::to_owned))
        },
    )
    .await?;
    assert!(
        provider_calls(&stack, Provider::Outlook, ada.email(), "me.photo") > 0,
        "the photo was not read from Outlook"
    );
    let stored = stack
        .service_requests()
        .into_iter()
        .filter(|request| request.service == "static-files" && request.method == "PUT")
        .count();
    assert!(stored > 0, "the photo was not kept");
    assert!(photo_url.contains("static-files"), "{photo_url}");
    email_e2e::eventually(
        "the open app to be told of the photo",
        email_e2e::DEFAULT_TIMEOUT,
        async || Ok((photo_pushes(&stack, &inbox) > 0).then_some(())),
    )
    .await?;

    stack.finish().await
}

/// The photo Macro keeps for an address of the inbox's contacts, as
/// `GET /email/contacts` answers it; none while the contact is not listed
/// or has no photo.
async fn contact_photo_url(inbox: &Inbox, address: &str) -> Result<Option<String>, Report> {
    let contacts = inbox.get("/email/contacts").await?.ok()?;
    Ok(contacts["contacts"][inbox.link_id().to_string()]
        .as_array()
        .into_iter()
        .flatten()
        .find(|contact| contact["email_address"] == address)
        .and_then(|contact| contact["photo_url"].as_str())
        .map(str::to_owned))
}

/// How many files the services have put with Macro's static files.
fn stored_files(stack: &Stack) -> usize {
    stack
        .service_requests()
        .into_iter()
        .filter(|request| request.service == "static-files" && request.method == "PUT")
        .count()
}

/// A person saved in the Outlook address book with a photo shows that photo
/// in Macro: it is read from Outlook and kept with Macro's static files.
/// A person saved without one gets none.
///
/// When it fails: the people of an Outlook address book never get their
/// pictures in Macro, or a picture lands on the wrong person.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_contacts_photo_shows_in_macro() -> Result<(), Report> {
    use email_e2e::outlook_emulator::{Route, SeedContact, SeedPhoto};

    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    stack.seed_mailbox(Provider::Outlook, ada.email(), &[])?;
    stack.outlook().upsert_contact(
        ada.email(),
        None,
        &SeedContact {
            email: "grace@example.com".to_owned(),
            name: Some("Grace Example".to_owned()),
            photo: Some(SeedPhoto {
                mime_type: Some("image/png".to_owned()),
                base64: PIXEL_PNG_BASE64.to_owned(),
            }),
        },
    )?;
    stack.outlook().upsert_contact(
        ada.email(),
        None,
        &SeedContact {
            email: "alan@example.com".to_owned(),
            name: Some("Alan Example".to_owned()),
            photo: None,
        },
    )?;
    let inbox = ada.link_outlook().await?;
    // Macro lists the people the user has written to.
    inbox
        .send(&json!({
            "subject": "Compiler notes",
            "to": [{ "email": "grace@example.com" }, { "email": "alan@example.com" }],
            "body_text": "Here are my notes.",
        }))
        .await?;

    let photo_url = email_e2e::eventually(
        "Grace to have her photo in Macro",
        email_e2e::DEFAULT_TIMEOUT,
        async || contact_photo_url(&inbox, "grace@example.com").await,
    )
    .await?;
    assert!(photo_url.contains("static-files"), "{photo_url}");
    assert!(
        provider_calls(&stack, Provider::Outlook, ada.email(), "contacts.photo") > 0,
        "the photo was not read from Outlook"
    );
    assert_eq!(stored_files(&stack), 1, "one photo was kept");

    // Outlook was asked for Alan's photo as well and has none.
    email_e2e::eventually(
        "Macro to ask Outlook for the photo Alan does not have",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            Ok(stack
                .outlook()
                .requests()
                .iter()
                .any(|request| request.route == Some(Route::ContactsPhoto) && request.status == 404)
                .then_some(()))
        },
    )
    .await?;
    wait_for_picker_name(&inbox, "alan@example.com").await?;
    assert_eq!(contact_photo_url(&inbox, "alan@example.com").await?, None);
    assert_eq!(stored_files(&stack), 1, "no photo was kept for Alan");

    stack.finish().await
}
