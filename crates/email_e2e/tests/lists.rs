//! The thread lists and by-id reads the web app gets from document
//! storage: the list filters, and threads outside the inbox.

#![expect(
    clippy::disallowed_methods,
    reason = "a test query against the scenario's database, which the offline query cache does not cover"
)]

use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Provider, Report, Stack, StackOptions, User, eventually,
    gmail_emulator, outlook_emulator,
};
use serde_json::{Value, json};

const SENDER: &str = "Mallory <mallory@example.net>";

/// Puts one message in the mailbox at the provider: in the inbox, read or
/// not, or in the Gmail label / Outlook folder named.
fn deliver(
    stack: &Stack,
    inbox: &Inbox,
    subject: &str,
    read: bool,
    place: Option<(&str, &str)>,
) -> Result<(), Report> {
    match inbox.provider() {
        Provider::Gmail => {
            let mut labels = vec![place.map_or("INBOX", |(label, _)| label).to_owned()];
            if !read {
                labels.push("UNREAD".to_owned());
            }
            stack.gmail().deliver(
                inbox.email(),
                &gmail_emulator::NewMessage {
                    from: Some(SENDER.to_owned()),
                    subject: Some(subject.to_owned()),
                    text: Some("Body.".to_owned()),
                    labels: Some(labels),
                    ..Default::default()
                },
            )?;
        }
        Provider::Outlook => {
            stack.outlook().deliver(
                inbox.email(),
                &outlook_emulator::NewMessage {
                    from: Some(SENDER.to_owned()),
                    subject: Some(subject.to_owned()),
                    text: Some("Body.".to_owned()),
                    folder: place.map(|(_, folder)| folder.to_owned()),
                    read: Some(read),
                    ..Default::default()
                },
            )?;
        }
    }
    Ok(())
}

/// Every page of the user's inbox under `filter`, twenty threads a page:
/// the size of each page and the threads' names with their read state.
async fn all_pages(
    user: &User,
    filter: &Value,
) -> Result<(Vec<usize>, Vec<(String, bool)>), Report> {
    let mut sizes = Vec::new();
    let mut threads = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let page = user
            .email_list_page(
                &json!({ "ef": filter, "emailView": "inbox", "limit": 20 }),
                cursor.as_deref(),
            )
            .await?
            .ok()?;
        let items = page["items"].as_array().cloned().unwrap_or_default();
        sizes.push(items.len());
        threads.extend(items.iter().map(|item| {
            (
                item["data"]["name"].as_str().unwrap_or_default().to_owned(),
                item["data"]["isRead"] == true,
            )
        }));
        cursor = page["next_cursor"].as_str().map(str::to_owned);
        if cursor.is_none() || items.is_empty() {
            break;
        }
    }
    Ok((sizes, threads))
}

/// The unread filter lists exactly the unread threads, a full page at a
/// time, and the read filter the rest. When this fails the Unread view
/// mixes in read mail, or shows a few unread threads per page as the user
/// scrolls.
async fn unread_filter_lists_exactly_the_unread_threads(provider: Provider) -> Result<(), Report> {
    const THREADS: usize = 60;
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    for number in 0..THREADS {
        deliver(
            &stack,
            &inbox,
            &format!("Thread {number:02}"),
            number % 3 != 0,
            None,
        )?;
    }
    eventually("every thread to be synced", DEFAULT_TIMEOUT, async || {
        let synced: i64 = sqlx::query_scalar("SELECT count(*) FROM email_threads")
            .fetch_one(stack.db())
            .await?;
        Ok((synced == THREADS as i64).then_some(()))
    })
    .await?;

    let (sizes, unread) = all_pages(&ada, &json!({ "l": { "Read": false } })).await?;
    let mut names: Vec<&str> = unread.iter().map(|(name, _)| name.as_str()).collect();
    names.sort_unstable();
    let expected: Vec<String> = (0..THREADS)
        .step_by(3)
        .map(|number| format!("Thread {number:02}"))
        .collect();
    assert_eq!(names, expected, "the unread threads, each once");
    assert!(unread.iter().all(|(_, read)| !read));
    assert_eq!(sizes[0], 20, "the first page is full: {sizes:?}");

    let (_, read) = all_pages(&ada, &json!({ "l": { "Read": true } })).await?;
    assert_eq!(read.len(), THREADS - expected.len());
    assert!(read.iter().all(|(_, read)| *read));

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_unread_filter_lists_exactly_the_unread_threads() -> Result<(), Report> {
    unread_filter_lists_exactly_the_unread_threads(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_unread_filter_lists_exactly_the_unread_threads() -> Result<(), Report> {
    unread_filter_lists_exactly_the_unread_threads(Provider::Outlook).await
}

const THREAD_BY_ID: &str = "query($input: EmailThreadInput!) { \
     user { id emailThread(input: $input) { id name isRead inboxVisible } } }";
const SET_STATE: &str = "mutation($input: SetEmailThreadStateInput!) { \
     setEmailThreadState(input: $input) { id name isRead } }";
const SET_ARCHIVED: &str = "mutation($input: SetEmailThreadArchivedInput!) { \
     setEmailThreadArchived(input: $input) { id name inboxVisible } }";

/// A thread wholly in Trash or Spam opens by its id, and changing it
/// answers the changed thread, so the writes queued behind it go through.
/// When this fails opening such a thread shows "not found", or a change to
/// it never settles in the client and holds every later change back.
async fn trashed_and_junk_threads_open_and_change_by_id(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    deliver(
        &stack,
        &inbox,
        "Thrown away",
        false,
        Some(("TRASH", "deleteditems")),
    )?;
    deliver(
        &stack,
        &inbox,
        "Junk offer",
        false,
        Some(("SPAM", "junkemail")),
    )?;
    deliver(&stack, &inbox, "Kept", false, None)?;
    let id = |preview: Value| preview["id"].as_str().unwrap_or_default().to_owned();
    let trashed = id(inbox.wait_for_preview("trash", "Thrown away").await?);
    let junk = id(inbox.wait_for_preview("spam", "Junk offer").await?);
    let kept = id(inbox.wait_for_preview("inbox", "Kept").await?);

    for (thread, name) in [(&trashed, "Thrown away"), (&junk, "Junk offer")] {
        let read = ada
            .graphql(THREAD_BY_ID, &json!({ "input": { "threadId": thread } }))
            .await?;
        assert_eq!(read["user"]["emailThread"]["name"], name, "{read}");
        assert_eq!(read["user"]["emailThread"]["isRead"], false);

        let changed = ada
            .graphql(
                SET_STATE,
                &json!({ "input": { "threadId": thread, "field": "READ", "value": true } }),
            )
            .await?;
        assert_eq!(changed["setEmailThreadState"]["isRead"], true, "{changed}");
    }

    let archived = ada
        .graphql(
            SET_ARCHIVED,
            &json!({ "input": { "threadId": trashed, "archived": true } }),
        )
        .await?;
    assert_eq!(
        archived["setEmailThreadArchived"]["id"], trashed,
        "{archived}"
    );
    let later = ada
        .graphql(
            SET_STATE,
            &json!({ "input": { "threadId": kept, "field": "READ", "value": true } }),
        )
        .await?;
    assert_eq!(later["setEmailThreadState"]["isRead"], true);
    inbox
        .wait_for_provider_message("the later change", |message| {
            message.subject == "Kept" && message.read
        })
        .await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_trashed_and_junk_threads_open_and_change_by_id() -> Result<(), Report> {
    trashed_and_junk_threads_open_and_change_by_id(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_trashed_and_junk_threads_open_and_change_by_id() -> Result<(), Report> {
    trashed_and_junk_threads_open_and_change_by_id(Provider::Outlook).await
}

const FOCUS: &str = "query { user { id emailFocus { id name inboxVisible \
     focus { isFocus category needsReply } } } }";

/// The threads Home lists for the user as worth their attention.
async fn on_home(user: &User) -> Result<Vec<Value>, Report> {
    let read = user.graphql(FOCUS, &json!({})).await?;
    Ok(read["user"]["emailFocus"]
        .as_array()
        .cloned()
        .unwrap_or_default())
}

/// Home lists the mail classified as worth the user's attention and no
/// other mail, and marking a thread done from there takes it out of the
/// inbox at the provider and off Home.
///
/// When it fails: Home shows no mail or all of it, or a thread marked done
/// there stays in the mailbox and on the list.
async fn mail_on_home_is_listed_and_marked_done(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    deliver(&stack, &inbox, "Needs an answer", false, None)?;
    deliver(&stack, &inbox, "Newsletter", false, None)?;
    let needed = inbox.wait_for_preview("inbox", "Needs an answer").await?;
    inbox.wait_for_preview("inbox", "Newsletter").await?;
    let thread = needed["id"].as_str().unwrap_or_default();
    assert_eq!(on_home(&ada).await?, Vec::<Value>::new());

    // The worker that classifies mail asks a model and is not started: its
    // verdict on the first thread is written here.
    let message = inbox.thread(thread).await?["messages"][0]["db_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    sqlx::query(
        "INSERT INTO email_thread_focus \
             (thread_id, link_id, classified_message_id, classified_message_ts, is_focus, \
              category, importance, needs_reply, needs_follow_up, scores, model, classified_at, \
              pinned) \
         VALUES ($1::uuid, $2, $3::uuid, now(), TRUE, 'known', 80, TRUE, FALSE, '{}', \
                 'scenario', now(), TRUE)",
    )
    .bind(thread)
    .bind(inbox.link_id())
    .bind(message)
    .execute(stack.db())
    .await?;

    let listed = on_home(&ada).await?;
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!(listed[0]["id"], thread);
    assert_eq!(listed[0]["name"], "Needs an answer");
    assert_eq!(listed[0]["inboxVisible"], true);
    assert_eq!(
        listed[0]["focus"],
        json!({ "isFocus": true, "category": "KNOWN", "needsReply": true })
    );

    let done = ada
        .graphql(
            SET_ARCHIVED,
            &json!({ "input": { "threadId": listed[0]["id"], "archived": true } }),
        )
        .await?;
    assert_eq!(
        done["setEmailThreadArchived"]["inboxVisible"], false,
        "{done}"
    );
    inbox
        .wait_for_provider_message("the thread marked done to leave the inbox", |message| {
            message.subject == "Needs an answer" && !message.in_inbox
        })
        .await?;
    assert_eq!(on_home(&ada).await?, Vec::<Value>::new());
    // The other mail was not touched.
    let kept = inbox
        .provider_messages()?
        .into_iter()
        .find(|message| message.subject == "Newsletter");
    assert!(kept.is_some_and(|message| message.in_inbox));

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_mail_on_home_is_listed_and_marked_done() -> Result<(), Report> {
    mail_on_home_is_listed_and_marked_done(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_mail_on_home_is_listed_and_marked_done() -> Result<(), Report> {
    mail_on_home_is_listed_and_marked_done(Provider::Outlook).await
}
