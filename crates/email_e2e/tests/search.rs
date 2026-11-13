//! Search over mail: the indexer that follows the mail's events and the
//! queries the web app sends.
//!
//! The search cluster and the indexer's consumer group are shared, so these
//! scenarios run one at a time and each user has an address of its own.

use std::{ops::Range, time::Duration};

use chrono::{DateTime, Utc};
use email_e2e::{
    DEFAULT_TIMEOUT, Mail, Provider, Report, Stack, StackOptions, User, eventually,
    gmail_emulator, outlook_emulator,
};
use serde_json::{Value, json};

/// The id that leaves a kind of item out of a search.
const NOTHING: &str = "00000000-0000-0000-0000-000000000000";

async fn search_stack() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        search: true,
        ..StackOptions::default()
    })
    .await
}

/// The subjects of the threads a search of the user's mail finds, sorted.
/// The request is the Email view's: mail only, names and content, a query
/// wholly in double quotes matched exactly.
async fn found(user: &User, query: &str) -> Result<Vec<String>, Report> {
    let quoted = query.len() >= 2 && query.starts_with('"') && query.ends_with('"');
    let answer = user
        .search(&json!({
            "query": query,
            "match_type": if quoted { "exact" } else { "partial" },
            "search_on": "name_content",
            "filters": {
                "calendar_event_filters": { "calendar_event_ids": [NOTHING] },
                "call_filters": { "call_ids": [NOTHING] },
                "channel_filters": { "channel_ids": [NOTHING] },
                "channel_thread_filters": { "thread_ids": [NOTHING] },
                "chat_filters": { "chat_ids": [NOTHING] },
                "crm_company_filters": { "company_ids": [NOTHING] },
                "document_filters": { "document_ids": [NOTHING] },
                "foreign_entity_filters": { "ids": [NOTHING] },
                "project_filters": { "project_ids": [NOTHING] },
            },
        }))
        .await?
        .ok()?;
    let mut subjects: Vec<String> = answer["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|hit: &Value| hit["subject"].as_str().map(str::to_owned))
        .collect();
    subjects.sort();
    subjects.dedup();
    Ok(subjects)
}

/// Waits until a search finds exactly these subjects.
async fn wait_for_found(user: &User, query: &str, subjects: &[&str]) -> Result<(), Report> {
    eventually(
        &format!("a search for {query} to find {subjects:?}"),
        DEFAULT_TIMEOUT,
        async || Ok((found(user, query).await? == subjects).then_some(())),
    )
    .await
}

/// Mail is found by the parts of its sender's address: the whole domain, a
/// word of it, the name before the `@`; and not by the beginning of a word.
/// When this fails, searching for a company finds none of the mail its
/// people sent.
async fn mail_is_found_by_the_parts_of_an_address(provider: Provider) -> Result<(), Report> {
    let stack = search_stack().await?;
    let ada = stack.unique_user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    inbox.deliver(&Mail::new(
        "Jane <jane.doe@acmewidgets.example>",
        "Quarterly numbers",
        "Attached as promised.",
    ))?;
    inbox.wait_for_preview("inbox", "Quarterly numbers").await?;

    wait_for_found(&ada, "acmewidgets.example", &["Quarterly numbers"]).await?;
    for part in ["acmewidgets", "jane.doe", "jane", "doe"] {
        assert_eq!(found(&ada, part).await?, ["Quarterly numbers"], "{part}");
    }
    assert_eq!(found(&ada, "acmewid").await?, [""; 0]);
    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_mail_is_found_by_the_parts_of_an_address() -> Result<(), Report> {
    mail_is_found_by_the_parts_of_an_address(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_mail_is_found_by_the_parts_of_an_address() -> Result<(), Report> {
    mail_is_found_by_the_parts_of_an_address(Provider::Outlook).await
}

/// A query in double quotes finds the mail that has those words next to
/// each other, whole. When this fails, a quoted search also lists mail with
/// the words apart, or with longer words that begin the same.
async fn a_quoted_query_finds_the_exact_phrase(provider: Provider) -> Result<(), Report> {
    let stack = search_stack().await?;
    let ada = stack.unique_user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    for (subject, text) in [
        ("Adjacent", "This is a reply test for the new plan."),
        ("Apart", "A test of whether the reply arrives."),
        ("Longer words", "Replying to all the tests, planning ahead."),
    ] {
        inbox.deliver(&Mail::new("Grace <grace@example.com>", subject, text))?;
    }

    // All three are indexed once the unquoted words find them all.
    wait_for_found(&ada, "repl", &["Adjacent", "Apart", "Longer words"]).await?;
    assert_eq!(found(&ada, "\"reply test\"").await?, ["Adjacent"]);
    assert_eq!(found(&ada, "\"plan\"").await?, ["Adjacent"]);
    // Without the quotes the same words are looser.
    assert_eq!(
        found(&ada, "reply test").await?,
        ["Adjacent", "Apart", "Longer words"]
    );
    assert_eq!(found(&ada, "plan").await?, ["Adjacent", "Longer words"]);
    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_quoted_query_finds_the_exact_phrase() -> Result<(), Report> {
    a_quoted_query_finds_the_exact_phrase(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_quoted_query_finds_the_exact_phrase() -> Result<(), Report> {
    a_quoted_query_finds_the_exact_phrase(Provider::Outlook).await
}

const SENDER: &str = "Grace <grace@example.com>";

/// A table whose cells span rows that do not exist.
const BROKEN_TABLE: &str = "<table><tr><td rowspan=\"0\">gooseberry</td><td rowspan=\"5\">x</td>\
     </tr><tr><td>y</td></tr></table>";

/// One message of a thread that is hard to index.
struct Odd {
    word: &'static str,
    html: Option<&'static str>,
    date: Option<DateTime<Utc>>,
    /// Whether it says who sent it.
    sender: bool,
}

/// Puts a thread of four messages in the mailbox at the provider: an
/// ordinary one, one with a broken table, one dated 1970, one without a
/// sender, each with a word of its own. `numbers` chooses which of the four
/// to put there now.
fn deliver_odd_thread(
    stack: &Stack,
    provider: Provider,
    address: &str,
    subject: &str,
    words: [&'static str; 4],
    numbers: Range<usize>,
) -> Result<(), Report> {
    let messages = [
        Odd { word: words[0], html: None, date: None, sender: true },
        Odd { word: words[1], html: Some(BROKEN_TABLE), date: None, sender: true },
        Odd { word: words[2], html: None, date: DateTime::from_timestamp(0, 0), sender: true },
        Odd { word: words[3], html: None, date: None, sender: false },
    ];
    let root = format!("{}@odd.example", words[0]);
    for (number, odd) in messages.iter().enumerate() {
        if !numbers.contains(&number) {
            continue;
        }
        let message_id = (number == 0).then(|| root.clone());
        let in_reply_to = (number > 0).then(|| root.clone());
        let text = format!("A message about {}.", odd.word);
        match provider {
            Provider::Gmail => {
                // Only a whole message can leave the sender out.
                let raw = (!odd.sender).then(|| {
                    format!(
                        "To: {address}\nSubject: {subject}\nMessage-ID: <{}@odd.example>\n\
                         In-Reply-To: <{root}>\nReferences: <{root}>\n\
                         Content-Type: text/plain\n\n{text}\n",
                        odd.word
                    )
                });
                stack.gmail().deliver(
                    address,
                    &gmail_emulator::NewMessage {
                        raw,
                        from: Some(SENDER.to_owned()),
                        subject: Some(subject.to_owned()),
                        text: Some(text),
                        html: odd.html.map(str::to_owned),
                        date: odd.date,
                        message_id,
                        in_reply_to,
                        ..Default::default()
                    },
                )?;
            }
            // Graph gives every received message a sender.
            Provider::Outlook if !odd.sender => {}
            Provider::Outlook => {
                stack.outlook().deliver(
                    address,
                    &outlook_emulator::NewMessage {
                        from: Some(SENDER.to_owned()),
                        subject: Some(subject.to_owned()),
                        text: Some(text),
                        html: odd.html.map(str::to_owned),
                        date: odd.date,
                        message_id,
                        in_reply_to,
                        ..Default::default()
                    },
                )?;
            }
        }
    }
    Ok(())
}

/// A thread with messages that are hard to index (a broken table, a date
/// of 1970, no sender) is still found by its other messages' words, both
/// when it was in the mailbox before linking and when it arrives later.
/// When this fails, one odd message keeps its whole thread, or everything
/// indexed along with it, out of search.
async fn an_odd_message_does_not_keep_its_thread_out_of_search(
    provider: Provider,
) -> Result<(), Report> {
    let stack = search_stack().await?;
    let ada = stack.unique_user("ada").await?;
    stack.seed_mailbox(provider, ada.email(), &[])?;
    deliver_odd_thread(
        &stack,
        provider,
        ada.email(),
        "Before linking",
        ["marmalade", "medlar", "mulberry", "muscadine"],
        0..4,
    )?;
    let inbox = ada.link(provider, ada.email()).await?;
    inbox.wait_for_preview("inbox", "Before linking").await?;
    // The thread is there before its odd messages arrive: mail that arrives
    // together in a new thread is another scenario.
    let after = ["persimmon", "pomelo", "plantain", "physalis"];
    deliver_odd_thread(&stack, provider, ada.email(), "After linking", after, 0..1)?;
    wait_for_found(&ada, "persimmon", &["After linking"]).await?;
    deliver_odd_thread(&stack, provider, ada.email(), "After linking", after, 1..4)?;

    // The message with the broken table has no text to be found by.
    let sender_optional = provider == Provider::Gmail;
    for word in ["marmalade", "mulberry", "muscadine"] {
        if word != "muscadine" || sender_optional {
            wait_for_found(&ada, word, &["Before linking"]).await?;
        }
    }
    for word in ["persimmon", "plantain", "physalis"] {
        if word != "physalis" || sender_optional {
            wait_for_found(&ada, word, &["After linking"]).await?;
        }
    }
    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_an_odd_message_does_not_keep_its_thread_out_of_search() -> Result<(), Report> {
    an_odd_message_does_not_keep_its_thread_out_of_search(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_an_odd_message_does_not_keep_its_thread_out_of_search() -> Result<(), Report> {
    an_odd_message_does_not_keep_its_thread_out_of_search(Provider::Outlook).await
}

/// The words of the messages that arrive together in one new thread.
const TOGETHER: [&str; 8] = [
    "quince", "quandong", "quenepa", "quararibea", "querina", "quinoa", "quillaja", "quassia",
];

/// Every message of a new thread is found, also when they arrive together.
/// When this fails, a message that was saved along with its thread by
/// another message's sync is never indexed: search does not find it by its
/// own words.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: search-new-thread-burst-not-indexed"]
async fn gmail_messages_arriving_together_in_a_new_thread_are_all_found() -> Result<(), Report> {
    let stack = search_stack().await?;
    let ada = stack.unique_user("ada").await?;
    let inbox = ada.link_gmail().await?;
    let root = "quince@together.example".to_owned();
    for (number, word) in TOGETHER.iter().enumerate() {
        stack.gmail().deliver(
            ada.email(),
            &gmail_emulator::NewMessage {
                from: Some(SENDER.to_owned()),
                subject: Some("Together".to_owned()),
                text: Some(format!("A message about {word}.")),
                message_id: (number == 0).then(|| root.clone()),
                in_reply_to: (number > 0).then(|| root.clone()),
                ..Default::default()
            },
        )?;
    }
    inbox.wait_for_preview("inbox", "Together").await?;

    // The preview shows the thread is saved; indexing follows within seconds.
    for word in TOGETHER {
        eventually(
            &format!("a search for {word} to find the thread"),
            Duration::from_secs(30),
            async || Ok((found(&ada, word).await? == ["Together"]).then_some(())),
        )
        .await?;
    }
    stack.finish().await
}
