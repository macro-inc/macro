//! Content and name search against a real OpenSearch: each search returns
//! exactly the documents, chats and calls its matching rules select, no fewer
//! and no more.
//!
//! The expected answer is computed without the query under test
//! ([`oracle`]): every seeded part (document chunk, chat message, call
//! segment), every name and every search term is tokenized with `_analyze` on
//! its index's field, and the rules the search builders define are applied to
//! those tokens directly.
//!
//! It needs an OpenSearch with the indices and aliases of
//! `infra/stacks/opensearch/helpers/scripts/create_indices.ts`, holding no
//! other documents, at `SEARCH_TEST_OPENSEARCH_URL` (default
//! `http://localhost:9200`), so `cargo test` runs it only when asked
//! (`--test content_search`, `test = false` in `Cargo.toml`). The crate's
//! `AGENTS.md` says how to start one; CI starts one for every change to this
//! crate.

mod database_rows;
mod email_operators;
mod fixtures;
mod oracle;

use std::collections::HashSet;

use anyhow::{Context, bail};
use models_opensearch::SearchEntityType;
use models_search_cursor::SearchCursorOption;
use opensearch::{
    CountParts, DeleteByQueryParts, OpenSearch,
    http::{
        Url,
        transport::{SingleNodeConnectionPool, TransportBuilder},
    },
    indices::{IndicesForcemergeParts, IndicesRefreshParts},
};
use opensearch_client::{
    OpensearchClient,
    date_format::EpochMillis,
    search::{
        call_records::CallRecordSearchMode,
        documents::DocumentSearchMode,
        model::SearchGotoContent,
        unified::{
            UnifiedCallRecordSearchArgs, UnifiedChatSearchArgs, UnifiedDocumentSearchArgs,
            UnifiedSearchArgs,
        },
    },
    upsert::{
        call_record::UpsertCallRecordSegmentArgs, chat_message::UpsertChatMessageArgs,
        document::UpsertDocumentArgs,
    },
};
use uuid::Uuid;

use crate::{
    fixtures::{
        Access, CASES, Case, Deleted, FIXTURES, KINDS, Kind, Mode, PUNCTUATED_OR_NON_ASCII_CASES,
        STILL_CAPPED_CASES,
    },
    oracle::{Expected, Oracle},
};

const DEFAULT_OPENSEARCH_URL: &str = "http://localhost:9200";

/// The user every search runs as.
const VIEWER: &str = "macro|search-test-viewer@example.com";
/// The owner of everything the viewer must not find.
const OTHER: &str = "macro|search-test-other@example.com";

/// Every seeded id starts with these bits, so a failure names test data.
const ID_PREFIX: u128 = 0x5ea4_c400_0000_0000_0000_0000_0000_0000;
const UPDATED_AT_MILLIS: i64 = 1_763_000_000_000;

/// Other users' entities, each holding [`CROWD_WORDS_PER_ENTITY`] distinct
/// words per crowded prefix, such as `con`, that sort before the viewer's
/// word (`conveyor`). A prefix query that expands to only the first terms of
/// a shard's dictionary, before access filtering, never reaches the viewer's
/// word. Spread over this many entities, every shard of a three- or six-shard
/// index holds several hundred of them.
const CROWD_ENTITIES: usize = 100;
const CROWD_WORDS_PER_ENTITY: usize = 30;

/// The tests share the search aliases, so they seed and search one at a
/// time: across processes through their nextest test group, within one
/// `cargo test` process through this lock.
static SEARCH_INDICES: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// A seeded entity of one kind, with the ids its index holds.
pub(crate) struct Seeded {
    pub(crate) kind: Kind,
    /// The entity's name, which documents and calls are searched by.
    pub(crate) name: String,
    access: Access,
    pub(crate) id: Uuid,
    /// Each part's id and content.
    parts: Vec<(String, String)>,
    deleted: Deleted,
}

impl Seeded {
    pub(crate) fn visible(&self) -> bool {
        self.access != Access::Other && self.deleted != Deleted::Whole
    }

    pub(crate) fn live_parts(&self) -> impl Iterator<Item = (usize, &(String, String))> {
        let deleted_part = match (self.kind, self.deleted) {
            (Kind::Call, _) => None,
            (_, Deleted::Part(part)) => Some(part),
            _ => None,
        };
        self.parts
            .iter()
            .enumerate()
            .filter(move |(part, _)| Some(*part) != deleted_part)
    }
}

fn seeded_entities(crowded_prefixes: &[&str]) -> Vec<Seeded> {
    let mut entities = Vec::new();
    for kind in KINDS {
        let fixtures = FIXTURES.iter().map(|fixture| {
            let parts = fixture.parts.iter().map(|part| part.to_string()).collect();
            (
                fixture.name.to_string(),
                fixture.access,
                parts,
                fixture.deleted,
            )
        });
        let crowd = (0..CROWD_ENTITIES).map(|entity| {
            let words: Vec<String> = crowded_prefixes
                .iter()
                .flat_map(|prefix| {
                    (0..CROWD_WORDS_PER_ENTITY)
                        .map(move |word| crowd_word(prefix, entity * CROWD_WORDS_PER_ENTITY + word))
                })
                .collect();
            // Its name holds the same words, so name searches are crowded too.
            let words = words.join(" ");
            (
                format!("crowd {entity}: {words}"),
                Access::Other,
                vec![words],
                Deleted::Nothing,
            )
        });
        // The crowd is written first, so its words come first in each shard
        // before the merge too.
        for (number, (name, access, parts, deleted)) in crowd.chain(fixtures).enumerate() {
            let id = Uuid::from_u128(ID_PREFIX | (kind as u128) << 40 | (number as u128) << 16);
            let parts = parts
                .into_iter()
                .enumerate()
                .map(|(part, content)| {
                    let part_id = match kind {
                        Kind::Document => part.to_string(),
                        Kind::Chat | Kind::Call => {
                            Uuid::from_u128(id.as_u128() | (part as u128 + 1)).to_string()
                        }
                    };
                    (part_id, content)
                })
                .collect();
            entities.push(Seeded {
                kind,
                name,
                access,
                id,
                parts,
                deleted,
            });
        }
    }
    entities
}

/// The `n`th word of a crowd: `conaaa`, `conaab`, … The 3,000 a crowd holds
/// all sort before `conveyor` and `naïveté`, precomposed or not.
fn crowd_word(prefix: &str, n: usize) -> String {
    let letter = |value: usize| char::from(b'a' + u8::try_from(value % 26).unwrap_or(0));
    format!("{prefix}{}{}{}", letter(n / 676), letter(n / 26), letter(n))
}

#[tokio::test]
async fn content_search_returns_exactly_the_entities_its_rules_match() -> anyhow::Result<()> {
    run_cases(CASES, &["con"]).await
}

#[tokio::test]
async fn a_punctuated_or_non_ascii_prefix_finds_words_past_the_first_256() -> anyhow::Result<()> {
    run_cases(
        PUNCTUATED_OR_NON_ASCII_CASES,
        &["con", "naï", "nai\u{0308}"],
    )
    .await
}

#[tokio::test]
#[ignore = "known bug: the last word of a multi-word content prefix and a name prefix under three characters still expand to only the first 256 terms of a shard"]
async fn a_multi_word_or_short_name_prefix_finds_words_past_the_first_256() -> anyhow::Result<()> {
    run_cases(STILL_CAPPED_CASES, &["con"]).await
}

/// Seed the fixtures and a crowd for each of `crowded_prefixes`, run every
/// case, remove what was seeded, and fail listing each search that returned
/// other entities than its rules match.
/// The client under test and a raw client for seeding and counting, both on
/// the test cluster, and its URL.
fn test_clients() -> anyhow::Result<(OpensearchClient, OpenSearch, String)> {
    #[expect(
        clippy::disallowed_methods,
        reason = "test support: where the test cluster answers comes from the process environment"
    )]
    let url = std::env::var("SEARCH_TEST_OPENSEARCH_URL")
        .unwrap_or_else(|_| DEFAULT_OPENSEARCH_URL.to_string());
    let client = OpensearchClient::new(url.clone(), String::new(), String::new())?;
    let raw = OpenSearch::new(
        TransportBuilder::new(SingleNodeConnectionPool::new(Url::parse(&url)?))
            .disable_proxy()
            .build()?,
    );
    Ok((client, raw, url))
}

async fn run_cases(cases: &[Case], crowded_prefixes: &[&str]) -> anyhow::Result<()> {
    let _one_at_a_time = SEARCH_INDICES.lock().await;
    let (client, raw, url) = test_clients()?;
    let entities = seeded_entities(crowded_prefixes);

    // Nothing is written or deleted on a cluster that holds anything but this
    // test's own documents, which a run that stopped part way leaves behind.
    for kind in KINDS {
        let index = kind.index().index_name();
        let others = count_documents(&raw, index, other_than(kind, &entities)).await?;
        if others != 0 {
            bail!(
                "`{index}` at {url} holds {others} documents this test did not write; it \
                 writes to the search aliases, so it needs an OpenSearch with empty search indices"
            );
        }
    }
    remove_seeded(&raw, &entities).await?;

    let result = seed_and_search(&client, &raw, &entities, cases).await;
    let removed = remove_seeded(&raw, &entities).await;
    let failures = match (result, removed) {
        (Err(error), Err(cleanup)) => {
            bail!("{error:#}; removing what it seeded also failed: {cleanup:#}")
        }
        (result, removed) => {
            removed?;
            result?
        }
    };
    assert!(
        failures.is_empty(),
        "{} of {} searches returned other entities than their rules match:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
    Ok(())
}

async fn seed_and_search(
    client: &OpensearchClient,
    raw: &OpenSearch,
    entities: &[Seeded],
    cases: &[Case],
) -> anyhow::Result<Vec<String>> {
    seed(client, entities).await?;
    for kind in KINDS {
        let index = kind.index().index_name();
        refresh(raw, index).await?;
        // One segment per shard, so each shard's term dictionary is one
        // sorted list, as in the large merged segments that hold most of a
        // deployed shard.
        raw.indices()
            .forcemerge(IndicesForcemergeParts::Index(&[index]))
            .max_num_segments(1)
            .send()
            .await?
            .error_for_status_code()?;
    }
    delete_parts(client, entities).await?;
    for kind in KINDS {
        refresh(raw, kind.index().index_name()).await?;
    }

    let oracle = Oracle::new(raw, entities).await?;
    let mut failures = Vec::new();
    for case in cases {
        let found = search(client, entities, case).await?;
        let expected = oracle.expected(raw, case).await?;
        let mismatches = compare(case, entities, &expected, &found);
        if !mismatches.is_empty() {
            failures.push(mismatches.join("\n"));
        }
    }
    Ok(failures)
}

async fn seed(client: &OpensearchClient, entities: &[Seeded]) -> anyhow::Result<()> {
    let updated_at = EpochMillis::new(UPDATED_AT_MILLIS)?;
    let owner = |access: Access| match access {
        Access::Own => VIEWER,
        Access::Shared | Access::Other => OTHER,
    };

    let mut chunks = Vec::new();
    let mut segments = Vec::new();
    for entity in entities {
        for (sequence_num, (part_id, content)) in entity.parts.iter().enumerate() {
            match entity.kind {
                Kind::Document => chunks.push(UpsertDocumentArgs {
                    document_id: entity.id.to_string(),
                    node_id: part_id.clone(),
                    document_name: entity.name.clone(),
                    file_type: "md".to_string(),
                    owner_id: owner(entity.access).to_string(),
                    raw_content: None,
                    content: content.clone(),
                    updated_at_millis: updated_at,
                    sub_type: None,
                    properties: Vec::new(),
                    is_email_attachment: false,
                }),
                Kind::Chat => {
                    let message = UpsertChatMessageArgs {
                        chat_id: entity.id.to_string(),
                        chat_message_id: part_id.clone(),
                        user_id: owner(entity.access).to_string(),
                        role: "user".to_string(),
                        created_at_millis: updated_at,
                        updated_at_millis: updated_at,
                        title: entity.name.clone(),
                        content: content.clone(),
                        properties: Vec::new(),
                    };
                    client.upsert_chat_message(&message, None).await?;
                }
                Kind::Call => segments.push(UpsertCallRecordSegmentArgs {
                    call_id: entity.id.to_string(),
                    transcript_id: part_id.clone(),
                    channel_id: None,
                    participant_ids: vec![owner(entity.access).to_string()],
                    channel_name: None,
                    name: Some(entity.name.clone()),
                    speaker_id: owner(entity.access).to_string(),
                    sequence_num: i32::try_from(sequence_num)?,
                    content: content.clone(),
                    started_at_millis: updated_at,
                    ended_at_millis: None,
                    properties: Vec::new(),
                }),
            }
        }
    }
    client.bulk_upsert_documents(&chunks, None).await?;
    client
        .bulk_upsert_call_record_segments(&segments, None)
        .await?;
    Ok(())
}

async fn delete_parts(client: &OpensearchClient, entities: &[Seeded]) -> anyhow::Result<()> {
    for entity in entities {
        let id = entity.id.to_string();
        match (entity.kind, entity.deleted) {
            (_, Deleted::Nothing) | (Kind::Call, Deleted::Part(_)) => {}
            (Kind::Document, Deleted::Part(_)) => {
                let kept: Vec<&str> = entity
                    .live_parts()
                    .map(|(_, (node_id, _))| node_id.as_str())
                    .collect();
                client
                    .delete_stale_document_chunks(&id, &kept, None)
                    .await?;
            }
            (Kind::Chat, Deleted::Part(part)) => {
                client
                    .delete_chat_message(&id, &entity.parts[part].0, None)
                    .await?;
            }
            (Kind::Document, Deleted::Whole) => client.delete_document(&id, None).await?,
            (Kind::Chat, Deleted::Whole) => client.delete_chat(&id, None).await?,
            (Kind::Call, Deleted::Whole) => client.delete_call_record(&id, None).await?,
        }
    }
    Ok(())
}

/// The entities each search found: their ids, and the ids of the parts its
/// matches pointed to.
struct Found {
    entities: HashSet<(Kind, Uuid)>,
    parts: HashSet<(Kind, Uuid, String)>,
}

async fn search(
    client: &OpensearchClient,
    entities: &[Seeded],
    case: &Case,
) -> anyhow::Result<Found> {
    let ids_with = |kind: Kind, access: &[Access]| -> Vec<String> {
        entities
            .iter()
            .filter(|entity| entity.kind == kind && access.contains(&entity.access))
            .map(|entity| entity.id.to_string())
            .collect()
    };
    let terms: Vec<String> = case.terms.iter().map(|term| term.to_string()).collect();
    // A name search covers the kinds that have names; chats have none.
    let (searched, document_mode, call_mode) = match case.mode {
        Mode::Content => (
            KINDS.to_vec(),
            DocumentSearchMode::Content,
            CallRecordSearchMode::Content,
        ),
        Mode::Name => (
            vec![Kind::Document, Kind::Call],
            DocumentSearchMode::Name,
            CallRecordSearchMode::Name,
        ),
    };
    let args = UnifiedSearchArgs {
        user_id: VIEWER.to_string(),
        page_size: 200,
        match_type: case.match_type.to_string(),
        cursor: SearchCursorOption::default(),
        search_indices: searched.iter().map(|kind| kind.index()).collect(),
        document_search_args: UnifiedDocumentSearchArgs {
            terms: terms.clone(),
            document_ids: ids_with(Kind::Document, &[Access::Shared]),
            mode: document_mode,
            term_matching: case.matching,
            ..Default::default()
        },
        chat_search_args: UnifiedChatSearchArgs {
            terms: terms.clone(),
            chat_ids: ids_with(Kind::Chat, &[Access::Shared]),
            ..Default::default()
        },
        call_record_search_args: UnifiedCallRecordSearchArgs {
            terms,
            call_ids: ids_with(Kind::Call, &[Access::Own, Access::Shared]),
            ids_only: true,
            mode: call_mode,
            ..Default::default()
        },
        ..Default::default()
    };

    let (hits, cursor) = client.search_unified(args).await?;
    if !matches!(cursor, SearchCursorOption::Done) {
        bail!("{:?} filled a whole page; raise page_size", case.terms);
    }

    let mut found = Found {
        entities: HashSet::new(),
        parts: HashSet::new(),
    };
    for hit in hits {
        let kind = match hit.entity_type {
            SearchEntityType::Documents => Kind::Document,
            SearchEntityType::Chats => Kind::Chat,
            SearchEntityType::CallRecords => Kind::Call,
            other => bail!("a search of three indices returned a {other:?} hit"),
        };
        found.entities.insert((kind, hit.entity_id));
        let part = match hit.goto {
            Some(SearchGotoContent::Documents(goto)) => Some(goto.node_id),
            Some(SearchGotoContent::Chats(goto)) => Some(goto.chat_message_id.to_string()),
            Some(SearchGotoContent::CallRecords(goto)) => Some(goto.transcript_id.to_string()),
            _ => None,
        };
        if let Some(part) = part {
            found.parts.insert((kind, hit.entity_id, part));
        }
    }
    Ok(found)
}

fn compare(case: &Case, entities: &[Seeded], expected: &Expected, found: &Found) -> Vec<String> {
    let name = |kind: Kind, id: Uuid| {
        entities
            .iter()
            .find(|entity| entity.kind == kind && entity.id == id)
            .map_or_else(|| format!("unknown {id}"), |entity| entity.name.clone())
    };
    let label = format!(
        "{:?} ({:?}, {}, {:?})",
        case.terms, case.mode, case.match_type, case.matching
    );

    let mut failures = Vec::new();
    for kind in KINDS {
        let missing: Vec<String> = expected
            .entities
            .iter()
            .filter(|(expected_kind, id)| {
                *expected_kind == kind && !found.entities.contains(&(kind, *id))
            })
            .map(|(_, id)| format!("{} ({id})", name(kind, *id)))
            .collect();
        let unexpected: Vec<String> = found
            .entities
            .iter()
            .filter(|(found_kind, id)| {
                *found_kind == kind && !expected.entities.contains(&(kind, *id))
            })
            .map(|(_, id)| format!("{} ({id})", name(kind, *id)))
            .collect();
        // A name match has no part to point to: a call's carries an empty one.
        let unexpected_parts: Vec<String> = found
            .parts
            .iter()
            .filter(|_| case.mode == Mode::Content)
            .filter(|part| part.0 == kind && expected.entities.contains(&(kind, part.1)))
            .filter(|part| !expected.parts.contains(*part))
            .map(|(_, id, part)| format!("part {part} of {}", name(kind, *id)))
            .collect();
        // A content match points to at least one of its matching parts; the
        // builders cap how many, so not to all of them.
        let without_parts: Vec<String> = expected
            .entities
            .iter()
            .filter(|(expected_kind, id)| {
                case.mode == Mode::Content
                    && *expected_kind == kind
                    && found.entities.contains(&(kind, *id))
                    && !found
                        .parts
                        .iter()
                        .any(|part| part.0 == kind && part.1 == *id)
            })
            .map(|(_, id)| format!("{} ({id})", name(kind, *id)))
            .collect();
        if missing.is_empty()
            && unexpected.is_empty()
            && unexpected_parts.is_empty()
            && without_parts.is_empty()
        {
            continue;
        }
        failures.push(format!(
            "{label} {kind:?}: missing {missing:?}, unexpected {unexpected:?}, unmatched parts {unexpected_parts:?}, found without a part {without_parts:?}"
        ));
    }
    failures
}

async fn refresh(raw: &OpenSearch, index: &str) -> anyhow::Result<()> {
    raw.indices()
        .refresh(IndicesRefreshParts::Index(&[index]))
        .send()
        .await?
        .error_for_status_code()?;
    Ok(())
}

/// How many documents of `index` match `query`, from every shard: a count
/// some shards failed to give proves nothing.
async fn count_documents(
    raw: &OpenSearch,
    index: &str,
    query: serde_json::Value,
) -> anyhow::Result<u64> {
    let body: serde_json::Value = raw
        .count(CountParts::Index(&[index]))
        .body(serde_json::json!({ "query": query }))
        .send()
        .await?
        .error_for_status_code()?
        .json()
        .await?;
    if body["_shards"]["failed"].as_u64() != Some(0) {
        bail!("`{index}` answered a count with failed shards: {body}");
    }
    body["count"]
        .as_u64()
        .with_context(|| format!("no count in {body}"))
}

/// The `entity_id` of every document this test writes to `kind`'s index:
/// parents and chunks carry their document's id, messages and segments their
/// own.
fn seeded_ids(kind: Kind, entities: &[Seeded]) -> Vec<String> {
    let mut ids = Vec::new();
    for entity in entities.iter().filter(|entity| entity.kind == kind) {
        ids.push(entity.id.to_string());
        if kind != Kind::Document {
            ids.extend(entity.parts.iter().map(|(part_id, _)| part_id.clone()));
        }
    }
    ids
}

/// Every document of `kind`'s index that this test did not write.
fn other_than(kind: Kind, entities: &[Seeded]) -> serde_json::Value {
    serde_json::json!({ "bool": { "must_not": [{ "terms": { "entity_id": seeded_ids(kind, entities) } }] } })
}

/// Remove everything this test writes, by the ids it writes.
async fn remove_seeded(raw: &OpenSearch, entities: &[Seeded]) -> anyhow::Result<()> {
    for kind in KINDS {
        let ids = seeded_ids(kind, entities);
        let index = kind.index().index_name();
        // A seed that failed part way has written documents no search sees
        // until a refresh, and the delete finds only what a search sees.
        refresh(raw, index).await?;
        raw.delete_by_query(DeleteByQueryParts::Index(&[index]))
            .refresh(true)
            .body(serde_json::json!({ "query": { "terms": { "entity_id": ids } } }))
            .send()
            .await?
            .error_for_status_code()?;
    }
    Ok(())
}
