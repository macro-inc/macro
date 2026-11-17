//! The owner keeps using Gmail or Outlook itself next to Macro: a flag,
//! an archive, junk, a delete or a label made there shows in Macro, and a
//! star made in Macro can be taken off there.
//!
//! Each change is made on the emulator, as the provider's own client makes
//! it, and checked in Macro's views and threads.

use std::time::Duration;

use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, ProviderMessage, Report, Stack, eventually,
};
use outlook_emulator::MessageChange;
use serde_json::json;

/// How long Outlook takes to settle a message it no longer finds: three
/// looks, 30 s and 60 s apart, with room to spare.
const DELETION_SETTLES: Duration = Duration::from_secs(240);

/// Delivers a mail from Grace and returns the thread's id in Macro and the
/// message at the provider.
async fn receive(inbox: &Inbox, subject: &str) -> Result<(String, ProviderMessage), Report> {
    let message = inbox.deliver(&Mail::new("Grace <grace@example.com>", subject, "Hello."))?;
    let preview = inbox.wait_for_preview("inbox", subject).await?;
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();
    Ok((thread_id, message))
}

/// Whether a view of the inbox lists the thread.
async fn lists(inbox: &Inbox, view: &str, thread_id: &str) -> Result<bool, Report> {
    Ok(inbox
        .previews(view)
        .await?
        .iter()
        .any(|preview| preview["id"] == thread_id))
}

/// Waits until a view of the inbox lists the thread, or stops listing it.
async fn wait_listed(
    inbox: &Inbox,
    view: &str,
    thread_id: &str,
    listed: bool,
) -> Result<(), Report> {
    let state = if listed { "list" } else { "stop listing" };
    eventually(
        &format!("the {view} view to {state} thread {thread_id}"),
        DEFAULT_TIMEOUT,
        async || Ok((lists(inbox, view, thread_id).await? == listed).then_some(())),
    )
    .await
}

/// The owner changes the message in the provider's own client.
enum Change<'a> {
    Flag(bool),
    Archive,
    BackToInbox,
    Junk,
    /// A Gmail label id, or an Outlook category name.
    Label(&'a str, bool),
}

fn change_at_provider(
    stack: &Stack,
    inbox: &Inbox,
    message_id: &str,
    change: Change<'_>,
) -> Result<(), Report> {
    match inbox.provider() {
        Provider::Gmail => {
            let labels = |names: &[&str]| -> Vec<String> {
                names.iter().map(|name| (*name).to_owned()).collect()
            };
            let (add, remove) = match change {
                Change::Flag(true) => (labels(&["STARRED"]), Vec::new()),
                Change::Flag(false) => (Vec::new(), labels(&["STARRED"])),
                Change::Archive => (Vec::new(), labels(&["INBOX"])),
                Change::BackToInbox => (labels(&["INBOX"]), labels(&["SPAM"])),
                Change::Junk => (labels(&["SPAM"]), labels(&["INBOX"])),
                Change::Label(id, true) => (labels(&[id]), Vec::new()),
                Change::Label(id, false) => (Vec::new(), labels(&[id])),
            };
            stack
                .gmail()
                .modify_labels(inbox.email(), message_id, &add, &remove)?;
        }
        Provider::Outlook => {
            let change = match change {
                Change::Flag(flagged) => MessageChange {
                    flagged: Some(flagged),
                    ..MessageChange::default()
                },
                Change::Archive => MessageChange {
                    folder: Some("archive".to_owned()),
                    ..MessageChange::default()
                },
                Change::BackToInbox => MessageChange {
                    folder: Some("inbox".to_owned()),
                    ..MessageChange::default()
                },
                Change::Junk => MessageChange {
                    folder: Some("junkemail".to_owned()),
                    ..MessageChange::default()
                },
                Change::Label(name, on) => MessageChange {
                    categories: Some(if on {
                        vec![name.to_owned()]
                    } else {
                        Vec::new()
                    }),
                    ..MessageChange::default()
                },
            };
            stack
                .outlook()
                .update_message(inbox.email(), message_id, &change)?;
        }
    }
    Ok(())
}

/// A flag both ways: Ada stars a thread in Macro and the provider flags
/// it; she takes the flag off in Gmail or Outlook and Macro's Starred view
/// drops it; a flag she puts on another thread there shows in Macro.
///
/// When it fails, a star made on one side never reaches the other, or
/// Macro keeps showing a flag the owner took off at the provider.
async fn flag_both_ways(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (contract, contract_message) = receive(&inbox, "Contract draft").await?;
    let (lunch, lunch_message) = receive(&inbox, "Team lunch").await?;

    inbox
        .patch(
            &format!("/email/threads/{contract}/state"),
            Some(&json!({ "field": "starred", "value": true })),
        )
        .await?
        .ok()?;
    inbox
        .wait_for_provider_message("the contract flagged", |message| {
            message.id == contract_message.id && message.starred
        })
        .await?;
    wait_listed(&inbox, "starred", &contract, true).await?;

    change_at_provider(&stack, &inbox, &contract_message.id, Change::Flag(false))?;
    inbox
        .wait_for_thread(&contract, "the flag off in Macro", |thread| {
            thread["messages"]
                .as_array()
                .into_iter()
                .flatten()
                .all(|message| message["is_starred"] == false)
        })
        .await?;
    wait_listed(&inbox, "starred", &contract, false).await?;

    change_at_provider(&stack, &inbox, &lunch_message.id, Change::Flag(true))?;
    wait_listed(&inbox, "starred", &lunch, true).await?;
    assert!(
        !lists(&inbox, "starred", &contract).await?,
        "the unflagged contract came back to Starred"
    );

    stack.finish().await
}

/// Gmail's label sync takes STARRED on or off a message's labels but
/// leaves its starred state, which Macro's views and thread read: a flag
/// changed in Gmail never shows in Macro.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: labels-starred-removed-flag-kept"]
async fn gmail_flag_both_ways() -> Result<(), Report> {
    flag_both_ways(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_flag_both_ways() -> Result<(), Report> {
    flag_both_ways(Provider::Outlook).await
}

/// Filing in the provider's own client: Ada archives a thread there and
/// Macro's inbox drops it, moves it back and Macro lists it again, sends
/// another to junk and Macro lists it under Spam, and deletes a third for
/// good and Macro forgets it. A thread she left alone stays in the inbox.
///
/// When it fails, Macro's inbox keeps mail the owner filed away in Gmail
/// or Outlook, misses mail she moved back, or keeps a thread she deleted.
async fn filing_at_the_provider(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (report, report_message) = receive(&inbox, "Quarterly report").await?;
    let (offer, offer_message) = receive(&inbox, "Limited offer").await?;
    let (old, old_message) = receive(&inbox, "Old notice").await?;
    let (lunch, _) = receive(&inbox, "Team lunch").await?;

    change_at_provider(&stack, &inbox, &report_message.id, Change::Archive)?;
    wait_listed(&inbox, "inbox", &report, false).await?;
    change_at_provider(&stack, &inbox, &report_message.id, Change::BackToInbox)?;
    wait_listed(&inbox, "inbox", &report, true).await?;

    change_at_provider(&stack, &inbox, &offer_message.id, Change::Junk)?;
    wait_listed(&inbox, "spam", &offer, true).await?;
    wait_listed(&inbox, "inbox", &offer, false).await?;

    match provider {
        Provider::Gmail => stack
            .gmail()
            .delete_message(inbox.email(), &old_message.id)?,
        Provider::Outlook => stack
            .outlook()
            .delete_message(inbox.email(), &old_message.id)?,
    }
    wait_listed(&inbox, "inbox", &old, false).await?;
    // Gmail's deletion removes the message. Outlook looks for a message it
    // cannot find twice more, 30 s and 60 s later, before it takes it out of
    // every view, so this wait may outlast the default one.
    eventually(
        "the deleted thread to leave every view",
        DELETION_SETTLES,
        async || Ok((!lists(&inbox, "all", &old).await?).then_some(())),
    )
    .await?;

    assert!(
        lists(&inbox, "inbox", &lunch).await?,
        "a thread left alone left the inbox"
    );
    assert!(lists(&inbox, "inbox", &report).await?);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_filing_at_the_provider() -> Result<(), Report> {
    filing_at_the_provider(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_filing_at_the_provider() -> Result<(), Report> {
    filing_at_the_provider(Provider::Outlook).await
}

/// The names of the labels on a thread's messages, as Macro answers them.
async fn thread_label_names(inbox: &Inbox, thread_id: &str) -> Result<Vec<String>, Report> {
    let thread = inbox.thread(thread_id).await?;
    Ok(thread["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|message| message["labels"].as_array().cloned().unwrap_or_default())
        .filter_map(|label| label["name"].as_str().map(str::to_owned))
        .collect())
}

/// A label made in the provider's own client: Ada makes "Clients" in Gmail
/// (a label) or Outlook (a category) and puts it on a message there. Macro
/// shows it on the thread and among the labels Ada can pick; when she takes
/// it off there, the thread no longer carries it.
///
/// When it fails, a label the owner uses in Gmail or Outlook never shows in
/// Macro, or stays on a thread after she took it off.
async fn label_made_at_the_provider(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (thread, message) = receive(&inbox, "Contract draft").await?;
    let label = stack.make_provider_label(&inbox, "Clients").await?;

    change_at_provider(&stack, &inbox, &message.id, Change::Label(&label, true))?;
    eventually("the label on Macro's thread", DEFAULT_TIMEOUT, async || {
        let names = thread_label_names(&inbox, &thread).await?;
        Ok(names.iter().any(|name| name == "Clients").then_some(()))
    })
    .await?;
    let listed = ada.get("/email/labels").await?.ok()?;
    let pickable = listed["labels"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|label| label["name"] == "Clients" && label["linkId"] == inbox.link_id().to_string());
    assert!(pickable, "Ada cannot pick the label in Macro: {listed}");

    change_at_provider(&stack, &inbox, &message.id, Change::Label(&label, false))?;
    eventually(
        "the label off Macro's thread",
        DEFAULT_TIMEOUT,
        async || {
            let names = thread_label_names(&inbox, &thread).await?;
            Ok((!names.iter().any(|name| name == "Clients")).then_some(()))
        },
    )
    .await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_label_made_at_the_provider() -> Result<(), Report> {
    label_made_at_the_provider(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_label_made_at_the_provider() -> Result<(), Report> {
    label_made_at_the_provider(Provider::Outlook).await
}
