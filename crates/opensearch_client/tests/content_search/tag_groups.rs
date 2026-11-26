//! Tags as groups that must each hold, any one tag of a group being enough:
//! `tag:finance OR tag:legal tag:q3` finds what is tagged Q3 and either
//! Finance or Legal, in documents and chats alike, whichever tag definition
//! each tag belongs to.

use std::collections::BTreeSet;

use anyhow::bail;
use models_opensearch::{OpenSearchEntityType, SearchEntityType};
use models_search_cursor::SearchCursorOption;
use opensearch::OpenSearch;
use opensearch_client::{
    OpensearchClient,
    date_format::EpochMillis,
    search::unified::{UnifiedChatSearchArgs, UnifiedDocumentSearchArgs, UnifiedSearchArgs},
    upsert::{
        chat_message::UpsertChatMessageArgs, document::UpsertDocumentArgs,
        properties::IndexedProperty,
    },
};
use uuid::Uuid;

use crate::{SEARCH_INDICES, UPDATED_AT_MILLIS, VIEWER, count_documents, refresh, test_clients};

const PERSONAL_TAGS: &str = "5ea4c400-0000-4000-8000-0000000074a0";
const TEAM_TAGS: &str = "5ea4c400-0000-4000-8000-0000000074a1";
const FINANCE: &str = "5ea4c400-0000-4000-8000-0000000074f1";
const LEGAL: &str = "5ea4c400-0000-4000-8000-0000000074f2";
const Q3: &str = "5ea4c400-0000-4000-8000-0000000074f3";

/// An item seeded as a document and as a chat, both holding `budget`.
struct Tagged {
    n: u128,
    /// Tags of the personal definition, and of the team's.
    personal: &'static [&'static str],
    team: &'static [&'static str],
}

const ITEMS: [Tagged; 5] = [
    Tagged {
        n: 1,
        personal: &[FINANCE, Q3],
        team: &[],
    },
    // Legal is the team's tag, on another nested entry than Q3.
    Tagged {
        n: 2,
        personal: &[Q3],
        team: &[LEGAL],
    },
    Tagged {
        n: 3,
        personal: &[Q3],
        team: &[],
    },
    Tagged {
        n: 4,
        personal: &[FINANCE],
        team: &[LEGAL],
    },
    Tagged {
        n: 5,
        personal: &[],
        team: &[],
    },
];

fn document(n: u128) -> Uuid {
    Uuid::from_u128(0x5ea4_c400_0000_4000_8000_0000_0000_7d00 + n)
}

fn chat(n: u128) -> Uuid {
    Uuid::from_u128(0x5ea4_c400_0000_4000_8000_0000_0000_7c00 + n)
}

struct Case {
    groups: &'static [&'static [&'static str]],
    expected: &'static [u128],
}

const CASES: [Case; 4] = [
    // Finance or Legal, and Q3.
    Case {
        groups: &[&[FINANCE, LEGAL], &[Q3]],
        expected: &[1, 2],
    },
    // One group: any of its tags.
    Case {
        groups: &[&[FINANCE, LEGAL]],
        expected: &[1, 2, 4],
    },
    // One tag per group: every one of them.
    Case {
        groups: &[&[FINANCE], &[Q3]],
        expected: &[1],
    },
    Case {
        groups: &[&[LEGAL], &[FINANCE, Q3]],
        expected: &[2, 4],
    },
];

#[tokio::test]
async fn every_tag_group_holds_by_any_of_its_tags() -> anyhow::Result<()> {
    let _one_at_a_time = SEARCH_INDICES.lock().await;
    let (client, raw, url) = test_clients()?;

    for (index, id_of) in [("documents", document as fn(u128) -> Uuid), ("chats", chat)] {
        let ids: Vec<String> = ITEMS.iter().map(|item| id_of(item.n).to_string()).collect();
        let others = count_documents(
            &raw,
            index,
            serde_json::json!({ "bool": { "must_not": [{ "terms": { "entity_id": ids } }] } }),
        )
        .await?;
        if others != 0 {
            bail!("`{index}` at {url} holds {others} documents this test did not write");
        }
    }

    let result = seed_and_search(&client, &raw).await;
    let removed = remove(&client, &raw).await;
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

fn properties(item: &Tagged) -> Vec<IndexedProperty> {
    [(PERSONAL_TAGS, item.personal), (TEAM_TAGS, item.team)]
        .into_iter()
        .filter(|(_, tags)| !tags.is_empty())
        .map(|(definition, tags)| IndexedProperty {
            definition_id: definition.to_string(),
            values: tags.iter().map(|tag| tag.to_string()).collect(),
            number_value: None,
            date_value: None,
        })
        .collect()
}

async fn seed_and_search(
    client: &OpensearchClient,
    raw: &OpenSearch,
) -> anyhow::Result<Vec<String>> {
    let updated_at = EpochMillis::new(UPDATED_AT_MILLIS)?;
    let mut chunks = Vec::new();
    for item in &ITEMS {
        chunks.push(UpsertDocumentArgs {
            document_id: document(item.n).to_string(),
            node_id: format!("node-{}", item.n),
            document_name: format!("tagged {}", item.n),
            file_type: "md".to_string(),
            owner_id: VIEWER.to_string(),
            raw_content: None,
            content: "the budget for next year".to_string(),
            updated_at_millis: updated_at,
            sub_type: None,
            properties: properties(item),
            is_email_attachment: false,
        });
        let message = UpsertChatMessageArgs {
            chat_id: chat(item.n).to_string(),
            chat_message_id: Uuid::from_u128(0x5ea4_c400_0000_4000_8000_0000_0000_7b00 + item.n)
                .to_string(),
            user_id: VIEWER.to_string(),
            role: "user".to_string(),
            created_at_millis: updated_at,
            updated_at_millis: updated_at,
            title: format!("tagged {}", item.n),
            content: "the budget for next year".to_string(),
            properties: properties(item),
        };
        client.upsert_chat_message(&message, None).await?;
    }
    client.bulk_upsert_documents(&chunks, None).await?;
    refresh(raw, "documents").await?;
    refresh(raw, "chats").await?;

    let mut failures = Vec::new();
    for case in &CASES {
        let tag_groups: Vec<Vec<String>> = case
            .groups
            .iter()
            .map(|group| group.iter().map(|tag| tag.to_string()).collect())
            .collect();
        let terms = vec!["budget".to_string()];
        let (hits, _) = client
            .search_unified(UnifiedSearchArgs {
                user_id: VIEWER.to_string(),
                page_size: 50,
                match_type: "partial".to_string(),
                cursor: SearchCursorOption::default(),
                search_indices: [OpenSearchEntityType::Documents, OpenSearchEntityType::Chats]
                    .into(),
                document_search_args: UnifiedDocumentSearchArgs {
                    terms: terms.clone(),
                    tag_groups: tag_groups.clone(),
                    ..Default::default()
                },
                chat_search_args: UnifiedChatSearchArgs {
                    terms,
                    tag_groups,
                    ..Default::default()
                },
                ..Default::default()
            })
            .await?;
        for (kind, id_of) in [
            (SearchEntityType::Documents, document as fn(u128) -> Uuid),
            (SearchEntityType::Chats, chat),
        ] {
            let found: BTreeSet<Uuid> = hits
                .iter()
                .filter(|hit| hit.entity_type == kind)
                .map(|hit| hit.entity_id)
                .collect();
            let expected: BTreeSet<Uuid> = case.expected.iter().map(|n| id_of(*n)).collect();
            if found != expected {
                failures.push(format!(
                    "{:?} in {kind:?}: expected {expected:?}, found {found:?}",
                    case.groups
                ));
            }
        }
    }
    Ok(failures)
}

async fn remove(client: &OpensearchClient, raw: &OpenSearch) -> anyhow::Result<()> {
    refresh(raw, "documents").await?;
    refresh(raw, "chats").await?;
    for item in &ITEMS {
        client
            .delete_document(&document(item.n).to_string(), None)
            .await?;
        client.delete_chat(&chat(item.n).to_string(), None).await?;
    }
    refresh(raw, "documents").await?;
    refresh(raw, "chats").await?;
    Ok(())
}
