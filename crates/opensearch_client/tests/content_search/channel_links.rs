//! A link a channel message shares is found by the words a person remembers
//! about it: the site's name inside its host, the domain, the words of its
//! path, and its label. The message is the result, with the matched part of
//! the link as its snippet when its text did not match.

use std::collections::BTreeSet;

use anyhow::bail;
use models_opensearch::OpenSearchEntityType;
use models_search_cursor::SearchCursorOption;
use opensearch::{DeleteByQueryParts, OpenSearch};
use opensearch_client::{
    OpensearchClient,
    date_format::EpochMillis,
    search::{
        channels::{ChannelSearchArgs, ChannelSortMode},
        model::{SearchGotoContent, SearchHit},
        unified::{UnifiedChannelMessageSearchArgs, UnifiedSearchArgs},
    },
    upsert::channel_message::UpsertChannelMessageArgs,
};
use uuid::Uuid;

use crate::{SEARCH_INDICES, UPDATED_AT_MILLIS, VIEWER, count_documents, refresh, test_clients};

const CHANNELS: &str = "channels";
const CHANNEL: Uuid = Uuid::from_u128(0x5ea4_c400_0000_4000_8000_0000_0000_c000);

fn message(n: u128) -> Uuid {
    Uuid::from_u128(0x5ea4_c400_0000_4000_8000_0000_0000_c100 + n)
}

/// A message as the indexer writes it: its text, and the links it shares.
struct Message {
    n: u128,
    content: &'static str,
    links: &'static [&'static str],
}

const MESSAGES: [Message; 4] = [
    // A link whose label is its URL, on a host with a subdomain.
    Message {
        n: 1,
        content: "These are the latest designs https://app.sketchpad.design/file/0ABC",
        links: &["https://app.sketchpad.design/file/0ABC"],
    },
    // A link behind a label, whose URL the text does not hold.
    Message {
        n: 2,
        content: "Notes are in the spec",
        links: &["https://docs.example.com/d/1AbC/edit?usp=sharing"],
    },
    Message {
        n: 3,
        content: "The sketchpad review moved to Friday",
        links: &[],
    },
    Message {
        n: 4,
        content: "Merged https://github.com/example/repo/pull/12",
        links: &["https://github.com/example/repo/pull/12"],
    },
];

struct Case {
    terms: &'static [&'static str],
    match_type: &'static str,
    expected: &'static [u128],
}

const CASES: [Case; 12] = [
    // The site's name inside the host, which `content` keeps as one token.
    Case {
        terms: &["sketchpad"],
        match_type: "partial",
        expected: &[1, 3],
    },
    Case {
        terms: &["sketchpad.design"],
        match_type: "partial",
        expected: &[1],
    },
    Case {
        terms: &["https://app.sketchpad.design/file"],
        match_type: "partial",
        expected: &[1],
    },
    Case {
        terms: &["sketchpad design"],
        match_type: "exact",
        expected: &[1],
    },
    // A labelled link, found by its host and its path.
    Case {
        terms: &["docs"],
        match_type: "partial",
        expected: &[2],
    },
    Case {
        terms: &["example.com"],
        match_type: "partial",
        expected: &[2],
    },
    Case {
        terms: &["docs.example.com", "spec"],
        match_type: "partial",
        expected: &[2],
    },
    Case {
        terms: &["edit"],
        match_type: "partial",
        expected: &[2],
    },
    // Its label is still its text.
    Case {
        terms: &["spec"],
        match_type: "partial",
        expected: &[2],
    },
    // Words every link holds find only messages whose text holds them.
    Case {
        terms: &["https"],
        match_type: "partial",
        expected: &[1, 4],
    },
    Case {
        terms: &["www"],
        match_type: "partial",
        expected: &[],
    },
    // A host ending alone names no site; beside its domain it narrows.
    Case {
        terms: &["com"],
        match_type: "partial",
        expected: &[],
    },
];

#[tokio::test]
async fn a_shared_link_is_found_by_the_words_of_its_url() -> anyhow::Result<()> {
    let _one_at_a_time = SEARCH_INDICES.lock().await;
    let (client, raw, url) = test_clients()?;

    let others = count_documents(
        &raw,
        CHANNELS,
        serde_json::json!({ "bool": { "must_not": [{ "term": { "entity_id": CHANNEL.to_string() } }] } }),
    )
    .await?;
    if others != 0 {
        bail!("`{CHANNELS}` at {url} holds {others} documents this test did not write");
    }

    let result = seed_and_search(&client, &raw).await;
    let removed = remove(&raw).await;
    let failures = match (result, removed) {
        (Err(error), Err(cleanup)) => {
            bail!("{error:#}; removing what it seeded also failed: {cleanup:#}")
        }
        (result, removed) => {
            removed?;
            result?
        }
    };
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    Ok(())
}

async fn seed_and_search(
    client: &OpensearchClient,
    raw: &OpenSearch,
) -> anyhow::Result<Vec<String>> {
    for message in &MESSAGES {
        client
            .upsert_channel_message(&upsert_args(message)?, None)
            .await?;
    }
    refresh(raw, CHANNELS).await?;

    let mut failures = Vec::new();
    for case in &CASES {
        let terms: Vec<String> = case.terms.iter().map(|term| term.to_string()).collect();
        let (hits, _) = client
            .search_unified(UnifiedSearchArgs {
                user_id: VIEWER.to_string(),
                page_size: 50,
                match_type: case.match_type.to_string(),
                cursor: SearchCursorOption::default(),
                search_indices: [OpenSearchEntityType::Channels].into(),
                channel_message_search_args: UnifiedChannelMessageSearchArgs {
                    terms: terms.clone(),
                    channel_ids: vec![CHANNEL.to_string()],
                    ..Default::default()
                },
                ..Default::default()
            })
            .await?;
        let found = found_messages(&hits);
        let expected: BTreeSet<Uuid> = case.expected.iter().map(|n| message(*n)).collect();
        if found != expected {
            failures.push(format!(
                "{:?} ({}): expected {expected:?}, found {found:?}",
                case.terms, case.match_type
            ));
        }
    }

    // A message found through its link shows the link with the match in it,
    // in unified search and in the channel's own search alike.
    let (unified, _) = client
        .search_unified(UnifiedSearchArgs {
            user_id: VIEWER.to_string(),
            page_size: 50,
            match_type: "partial".to_string(),
            cursor: SearchCursorOption::default(),
            search_indices: [OpenSearchEntityType::Channels].into(),
            channel_message_search_args: UnifiedChannelMessageSearchArgs {
                terms: vec!["sketchpad".to_string()],
                channel_ids: vec![CHANNEL.to_string()],
                ..Default::default()
            },
            ..Default::default()
        })
        .await?;
    let in_channel = client
        .search_channel(ChannelSearchArgs {
            user_id: VIEWER.to_string(),
            page_size: 50,
            match_type: "partial".to_string(),
            cursor: SearchCursorOption::default(),
            terms: vec!["sketchpad".to_string()],
            channel_ids: vec![CHANNEL.to_string()],
            sort_mode: ChannelSortMode::Message,
            ..Default::default()
        })
        .await?
        .hits;
    for (search, hits) in [("unified", &unified), ("channel", &in_channel)] {
        for (n, snippet) in [
            (
                1,
                "https://app.<macro_em>sketchpad</macro_em>.design/file/0ABC",
            ),
            (
                3,
                "The <macro_em>sketchpad</macro_em> review moved to Friday",
            ),
        ] {
            let snippets = snippets_of(hits, message(n));
            if snippets != [snippet] {
                failures.push(format!(
                    "{search} search: message {n} expected snippet {snippet:?}, found {snippets:?}"
                ));
            }
        }
    }
    Ok(failures)
}

fn upsert_args(seeded: &Message) -> anyhow::Result<UpsertChannelMessageArgs> {
    let id = message(seeded.n).to_string();
    Ok(UpsertChannelMessageArgs {
        channel_id: CHANNEL.to_string(),
        channel_type: "private".to_string(),
        org_id: None,
        message_id: id.clone(),
        thread_id: id,
        sender_id: VIEWER.to_string(),
        imported_author: None,
        mentions: Vec::new(),
        content: seeded.content.to_string(),
        links: seeded.links.iter().map(|link| link.to_string()).collect(),
        created_at_millis: EpochMillis::new(UPDATED_AT_MILLIS)?,
        updated_at_millis: EpochMillis::new(UPDATED_AT_MILLIS)?,
    })
}

fn message_id(hit: &SearchHit) -> Option<Uuid> {
    match &hit.goto {
        Some(SearchGotoContent::Channels(goto)) => Some(goto.channel_message_id),
        _ => None,
    }
}

fn found_messages(hits: &[SearchHit]) -> BTreeSet<Uuid> {
    hits.iter().filter_map(message_id).collect()
}

fn snippets_of(hits: &[SearchHit], id: Uuid) -> Vec<String> {
    hits.iter()
        .filter(|hit| message_id(hit) == Some(id))
        .flat_map(|hit| hit.highlight.content.clone())
        .collect()
}

async fn remove(raw: &OpenSearch) -> anyhow::Result<()> {
    refresh(raw, CHANNELS).await?;
    raw.delete_by_query(DeleteByQueryParts::Index(&[CHANNELS]))
        .refresh(true)
        .body(serde_json::json!({ "query": { "term": { "entity_id": CHANNEL.to_string() } } }))
        .send()
        .await?
        .error_for_status_code()?;
    Ok(())
}
