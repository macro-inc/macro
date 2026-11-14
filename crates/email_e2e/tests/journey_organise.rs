//! Organising a mailbox the way the web app does: star, trash and restore,
//! mark as junk, Done for several threads at once, a label of the user's
//! own from creation to deletion, and a thread filed in a project.
//!
//! Each change is checked in Macro's lists and at the provider, where the
//! user's other mail clients see it.

use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, ProviderMessage, Report, Stack, StackOptions,
    eventually,
};
use reqwest::Method;
use serde_json::{Value, json};

/// A stack that serves the GraphQL API and the project routes.
async fn stack_with_graphql() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await
}

/// Where a provider keeps a message: a Gmail system label, or the display
/// name of an Outlook folder.
#[derive(Clone, Copy)]
struct Place {
    gmail: &'static str,
    outlook: &'static str,
}

const TRASH: Place = Place {
    gmail: "TRASH",
    outlook: "Deleted Items",
};
const JUNK: Place = Place {
    gmail: "SPAM",
    outlook: "Junk Email",
};

fn is_in(message: &ProviderMessage, provider: Provider, place: Place) -> bool {
    let name = match provider {
        Provider::Gmail => place.gmail,
        Provider::Outlook => place.outlook,
    };
    message
        .labels
        .iter()
        .any(|label| label.eq_ignore_ascii_case(name))
}

/// Whether the provider's own inbox view shows the message: Gmail hides a
/// message in Trash or Spam from every label view, whatever labels it
/// keeps; an Outlook message is in the Inbox folder or not.
fn in_inbox_view(message: &ProviderMessage, provider: Provider) -> bool {
    message.in_inbox
        && !(provider == Provider::Gmail
            && (is_in(message, provider, TRASH) || is_in(message, provider, JUNK)))
}

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

/// Whether the inbox the web app shows (document storage's item list,
/// email view `inbox`) lists the thread.
async fn in_app_inbox(inbox: &Inbox, thread_id: &str) -> Result<bool, Report> {
    let page = inbox
        .user()
        .email_list_page(&json!({ "emailView": "inbox", "limit": 100 }), None)
        .await?
        .ok()?;
    Ok(page["items"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|item| item["data"]["id"] == thread_id || item["id"] == thread_id))
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

/// `PATCH /email/threads/{id}/state`, as the thread's toolbar sends it.
async fn set_state(inbox: &Inbox, thread_id: &str, field: &str, value: bool) -> Result<(), Report> {
    inbox
        .patch(
            &format!("/email/threads/{thread_id}/state"),
            Some(&json!({ "field": field, "value": value })),
        )
        .await?
        .ok()?;
    Ok(())
}

/// The ids of the labels on a thread's messages, as Macro answers them.
async fn thread_label_ids(inbox: &Inbox, thread_id: &str) -> Result<Vec<String>, Report> {
    let thread = inbox.thread(thread_id).await?;
    Ok(thread["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|message| message["labels"].as_array().cloned().unwrap_or_default())
        .filter_map(|label| label["provider_label_id"].as_str().map(str::to_owned))
        .collect())
}

/// Star, trash and restore: the thread toolbar's actions on three
/// threads reach the provider and move the threads between Macro's views,
/// and the threads left alone stay where they were.
///
/// When it fails, a toolbar action changes only Macro's copy (Gmail or
/// Outlook still shows the thread where it was) or the views list a thread
/// in the wrong place.
async fn star_trash_and_restore(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_graphql().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (contract, contract_message) = receive(&inbox, "Contract draft").await?;
    let (newsletter, newsletter_message) = receive(&inbox, "Monthly newsletter").await?;
    let (lunch, lunch_message) = receive(&inbox, "Team lunch").await?;

    // Star the contract.
    set_state(&inbox, &contract, "starred", true).await?;
    inbox
        .wait_for_provider_message("the contract to be starred", |message| {
            message.id == contract_message.id && message.starred
        })
        .await?;
    wait_listed(&inbox, "starred", &contract, true).await?;

    // Trash the newsletter, then take it back.
    set_state(&inbox, &newsletter, "trashed", true).await?;
    inbox
        .wait_for_provider_message("the newsletter in the trash", |message| {
            message.id == newsletter_message.id
                && is_in(message, provider, TRASH)
                && !in_inbox_view(message, provider)
        })
        .await?;
    wait_listed(&inbox, "trash", &newsletter, true).await?;
    assert!(
        !lists(&inbox, "inbox", &newsletter).await?,
        "a trashed thread is in the inbox view"
    );
    assert!(
        !in_app_inbox(&inbox, &newsletter).await?,
        "a trashed thread is in the web app's inbox"
    );
    set_state(&inbox, &newsletter, "trashed", false).await?;
    inbox
        .wait_for_provider_message("the newsletter back in the inbox", |message| {
            message.id == newsletter_message.id
                && !is_in(message, provider, TRASH)
                && in_inbox_view(message, provider)
        })
        .await?;
    wait_listed(&inbox, "inbox", &newsletter, true).await?;
    wait_listed(&inbox, "trash", &newsletter, false).await?;

    // The lunch thread was left alone: still in the inbox and unstarred,
    // here and at the provider. The contract stays starred and in the inbox.
    let at_provider = inbox.provider_messages()?;
    let lunch_now = at_provider
        .iter()
        .find(|message| message.id == lunch_message.id)
        .ok_or_else(|| rootcause::report!("the lunch mail is gone at the provider"))?;
    assert!(lunch_now.in_inbox && !lunch_now.starred, "{lunch_now:?}");
    let contract_now = at_provider
        .iter()
        .find(|message| message.id == contract_message.id)
        .ok_or_else(|| rootcause::report!("the contract is gone at the provider"))?;
    assert!(
        contract_now.in_inbox && contract_now.starred,
        "{contract_now:?}"
    );
    assert!(lists(&inbox, "inbox", &lunch).await?);
    assert!(
        in_app_inbox(&inbox, &lunch).await?,
        "the web app's inbox lost a thread"
    );
    assert!(lists(&inbox, "inbox", &contract).await?);
    assert!(!lists(&inbox, "starred", &lunch).await?);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_star_trash_and_restore() -> Result<(), Report> {
    star_trash_and_restore(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_star_trash_and_restore() -> Result<(), Report> {
    star_trash_and_restore(Provider::Outlook).await
}

/// Mark as junk: the thread goes to the provider's junk (Gmail's Spam, the
/// Outlook Junk Email folder), Macro lists it under Spam and no longer in
/// the inbox, the one the web app shows included; the thread left alone
/// stays in the inbox.
///
/// When it fails, a thread the user called junk stays in their inbox, or
/// junk does not reach Gmail or Outlook.
async fn junk_leaves_the_inbox(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_graphql().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (offer, offer_message) = receive(&inbox, "You won a prize").await?;
    let (kept, _) = receive(&inbox, "Team lunch").await?;

    set_state(&inbox, &offer, "junk", true).await?;
    inbox
        .wait_for_provider_message("the offer in junk", |message| {
            message.id == offer_message.id
                && is_in(message, provider, JUNK)
                && !in_inbox_view(message, provider)
        })
        .await?;
    wait_listed(&inbox, "spam", &offer, true).await?;
    assert!(
        !lists(&inbox, "inbox", &offer).await?,
        "a junk thread is in the inbox view"
    );
    assert!(
        !in_app_inbox(&inbox, &offer).await?,
        "a junk thread is in the web app's inbox"
    );
    assert!(lists(&inbox, "inbox", &kept).await?);
    assert!(in_app_inbox(&inbox, &kept).await?);

    stack.finish().await
}

/// Gmail keeps INBOX on a message it files as spam and hides it from every
/// view but Spam; Macro counts the INBOX label and keeps listing it.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: gmail-junk-stays-in-inbox"]
async fn gmail_junk_leaves_the_inbox() -> Result<(), Report> {
    junk_leaves_the_inbox(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_junk_leaves_the_inbox() -> Result<(), Report> {
    junk_leaves_the_inbox(Provider::Outlook).await
}

/// Done for a selection: `setEmailThreadsArchived` on two of three threads
/// takes both out of the inbox at the provider and in Macro, leaves the
/// third, and Undo (archived false) brings both back.
///
/// When it fails, a bulk Done reaches only some of the threads, touches one
/// that was not selected, or cannot be undone.
async fn done_for_several_threads_at_once(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_graphql().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (first, first_message) = receive(&inbox, "Invoice 1").await?;
    let (second, second_message) = receive(&inbox, "Invoice 2").await?;
    let (kept, kept_message) = receive(&inbox, "Invoice 3").await?;

    let archive = async |archived: bool| -> Result<Value, Report> {
        let data = ada
            .graphql(
                "mutation($input: SetEmailThreadsArchivedInput!) { \
                 setEmailThreadsArchived(input: $input) { threads { id inboxVisible } failedThreadIds } }",
                &json!({ "input": { "threadIds": [first, second], "archived": archived } }),
            )
            .await?;
        Ok(data["setEmailThreadsArchived"].clone())
    };

    let done = archive(true).await?;
    assert_eq!(done["failedThreadIds"], json!([]), "{done}");
    let threads = done["threads"].as_array().cloned().unwrap_or_default();
    assert_eq!(threads.len(), 2, "{done}");
    assert!(
        threads.iter().all(|thread| thread["inboxVisible"] == false),
        "{done}"
    );
    for (id, message) in [(&first, &first_message), (&second, &second_message)] {
        inbox
            .wait_for_provider_message("a selected thread to leave the inbox", |at| {
                at.id == message.id && !at.in_inbox
            })
            .await?;
        assert!(
            !lists(&inbox, "inbox", id).await?,
            "{id} is still in the inbox"
        );
    }
    assert!(
        lists(&inbox, "inbox", &kept).await?,
        "the unselected thread left the inbox"
    );

    let undone = archive(false).await?;
    assert_eq!(undone["failedThreadIds"], json!([]), "{undone}");
    for (id, message) in [(&first, &first_message), (&second, &second_message)] {
        inbox
            .wait_for_provider_message("a thread to come back to the inbox", |at| {
                at.id == message.id && at.in_inbox
            })
            .await?;
        wait_listed(&inbox, "inbox", id, true).await?;
    }
    let kept_now = inbox
        .provider_message(&kept_message.id)?
        .ok_or_else(|| rootcause::report!("the unselected mail is gone at the provider"))?;
    assert!(kept_now.in_inbox, "{kept_now:?}");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_done_for_several_threads_at_once() -> Result<(), Report> {
    done_for_several_threads_at_once(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_done_for_several_threads_at_once() -> Result<(), Report> {
    done_for_several_threads_at_once(Provider::Outlook).await
}

/// A label of the user's own, from start to end: created in Macro it
/// appears at the provider (a Gmail label, an Outlook category), put on a
/// thread it shows on the message there, taken off (the GraphQL mutation)
/// it leaves, and deleted it is gone from the provider and from Macro's
/// label list.
///
/// When it fails, a label made in Macro never reaches Gmail or Outlook,
/// labelling a thread stays local, or a deleted label lingers.
async fn own_label_from_creation_to_deletion(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_graphql().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (thread, message) = receive(&inbox, "Quarterly figures").await?;

    let created = inbox
        .post("/email/labels", Some(&json!({ "label_name": "Clients" })))
        .await?
        .ok()?;
    let label_id = created["label"]["id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    eventually(
        "the label to exist at the provider",
        DEFAULT_TIMEOUT,
        async || {
            Ok(stack
                .provider_labels(&inbox)
                .await?
                .iter()
                .any(|name| name == "Clients")
                .then_some(()))
        },
    )
    .await?;
    // The provider's id for it, once Macro has learned it.
    let provider_label = eventually(
        "Macro to know the provider's label",
        DEFAULT_TIMEOUT,
        async || {
            let labels = ada.get("/email/labels").await?.ok()?;
            Ok(labels["labels"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|label| label["id"] == label_id.as_str())
                .and_then(|label| label["providerLabelId"].as_str())
                .filter(|id| provider == Provider::Outlook || *id != "Clients")
                .map(str::to_owned))
        },
    )
    .await?;

    // On the thread, as the label picker sends it.
    inbox
        .patch(
            &format!("/email/threads/{thread}/labels"),
            Some(&json!({ "label_id": label_id, "value": true })),
        )
        .await?
        .ok()?;
    let on_message = |at: &ProviderMessage| match provider {
        Provider::Gmail => at.labels.contains(&provider_label),
        Provider::Outlook => at
            .labels
            .iter()
            .skip(1)
            .any(|category| category == "Clients"),
    };
    inbox
        .wait_for_provider_message("the label on the message", |at| {
            at.id == message.id && on_message(at)
        })
        .await?;
    assert!(
        thread_label_ids(&inbox, &thread)
            .await?
            .contains(&provider_label)
    );

    // Off again, through GraphQL.
    let taken_off = ada
        .graphql(
            "mutation($input: UpdateEmailThreadLabelInput!) { \
             updateEmailThreadLabel(input: $input) { id } }",
            &json!({ "input": { "threadId": thread, "labelId": label_id, "value": false } }),
        )
        .await?;
    assert_eq!(
        taken_off["updateEmailThreadLabel"]["id"],
        thread.as_str(),
        "{taken_off}"
    );
    inbox
        .wait_for_provider_message("the label off the message", |at| {
            at.id == message.id && !on_message(at)
        })
        .await?;
    assert!(
        !thread_label_ids(&inbox, &thread)
            .await?
            .contains(&provider_label)
    );

    // Deleted.
    inbox
        .delete(&format!("/email/labels/{label_id}"), None)
        .await?
        .ok()?;
    eventually(
        "the label to be gone at the provider",
        DEFAULT_TIMEOUT,
        async || {
            Ok((!stack
                .provider_labels(&inbox)
                .await?
                .iter()
                .any(|name| name == "Clients"))
            .then_some(()))
        },
    )
    .await?;
    eventually(
        "the label to leave Macro's list",
        DEFAULT_TIMEOUT,
        async || {
            let labels = ada.get("/email/labels").await?.ok()?;
            Ok((!labels.to_string().contains(&label_id)).then_some(()))
        },
    )
    .await?;
    let still = inbox.provider_message(&message.id)?;
    assert!(
        still.is_some_and(|at| at.in_inbox),
        "deleting the label moved the mail"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_own_label_from_creation_to_deletion() -> Result<(), Report> {
    own_label_from_creation_to_deletion(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_own_label_from_creation_to_deletion() -> Result<(), Report> {
    own_label_from_creation_to_deletion(Provider::Outlook).await
}

/// Filing a thread in a project: the thread then belongs to the project as
/// the app reads it, moving it to another project answers the first one,
/// and someone else cannot file Ada's thread.
///
/// When it fails, a thread put in a project does not show there, or a user
/// can move a thread that is not theirs.
async fn thread_is_filed_in_a_project(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_graphql().await?;
    let ada = stack.user("ada").await?;
    let mallory = stack.user("mallory").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (thread, _) = receive(&inbox, "Venue contract").await?;

    let project = async |name: &str| -> Result<String, Report> {
        let created = ada
            .document_storage_request(Method::POST, "/projects", Some(&json!({ "name": name })))
            .await?
            .ok()?;
        Ok(created["data"]["id"]
            .as_str()
            .unwrap_or_default()
            .to_owned())
    };
    let offsite = project("Offsite").await?;
    let archive = project("Archive 2026").await?;
    let file = async |project: &str| -> Result<Value, Report> {
        inbox
            .patch(
                &format!("/email/threads/{thread}/project"),
                Some(&json!({ "projectId": project })),
            )
            .await?
            .ok()
    };
    let project_of = async || -> Result<Value, Report> {
        let data = ada
            .graphql(
                "query($threadId: ID!) { user { id emailThread(input: { threadId: $threadId }) { id projectId } } }",
                &json!({ "threadId": thread }),
            )
            .await?;
        Ok(data["user"]["emailThread"]["projectId"].clone())
    };

    let first = file(&offsite).await?;
    assert_eq!(first["oldProjectId"], Value::Null, "{first}");
    assert_eq!(project_of().await?, offsite.as_str());
    let moved = file(&archive).await?;
    assert_eq!(moved["oldProjectId"], offsite.as_str(), "{moved}");
    assert_eq!(project_of().await?, archive.as_str());

    let refused = mallory
        .patch(
            &format!("/email/threads/{thread}/project"),
            Some(&json!({ "projectId": Value::Null })),
        )
        .await?;
    assert!(
        !(200..300).contains(&refused.status),
        "another user moved the thread: {}",
        refused.text
    );
    assert_eq!(project_of().await?, archive.as_str());

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_thread_is_filed_in_a_project() -> Result<(), Report> {
    thread_is_filed_in_a_project(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_thread_is_filed_in_a_project() -> Result<(), Report> {
    thread_is_filed_in_a_project(Provider::Outlook).await
}
