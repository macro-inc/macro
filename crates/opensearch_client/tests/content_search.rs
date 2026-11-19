//! Content search against a real OpenSearch: each search returns exactly the
//! documents, chats and calls its matching rules select, no fewer and no more.
//!
//! The expected answer is computed without the query under test: every seeded
//! part (document chunk, chat message, call segment) and every search term is
//! tokenized with `_analyze` on its index's `content` field, and the rules the
//! search builders define are applied to those tokens directly.
//!
//! It needs an OpenSearch with the indices and aliases of
//! `infra/stacks/opensearch/helpers/scripts/create_indices.ts`, holding no
//! other documents, at `SEARCH_TEST_OPENSEARCH_URL` (default
//! `http://localhost:9200`), so `cargo test` runs it only when asked
//! (`--test content_search`, `test = false` in `Cargo.toml`). The crate's
//! `AGENTS.md` says how to start one; CI starts one for every change to this
//! crate.

use std::collections::{BTreeSet, HashMap, HashSet};

use anyhow::{Context, bail};
use models_opensearch::{OpenSearchEntityType, SearchEntityType};
use models_search_cursor::SearchCursorOption;
use opensearch::{
    CountParts, DeleteByQueryParts, OpenSearch,
    http::{
        Url,
        transport::{SingleNodeConnectionPool, TransportBuilder},
    },
    indices::{IndicesAnalyzeParts, IndicesForcemergeParts, IndicesRefreshParts},
};
use opensearch_client::{
    OpensearchClient,
    date_format::EpochMillis,
    search::{
        call_records::CallRecordSearchMode,
        documents::{DocumentSearchMode, DocumentTermMatching},
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum Kind {
    Document,
    Chat,
    Call,
}

const KINDS: [Kind; 3] = [Kind::Document, Kind::Chat, Kind::Call];

impl Kind {
    fn index(self) -> OpenSearchEntityType {
        match self {
            Kind::Document => OpenSearchEntityType::Documents,
            Kind::Chat => OpenSearchEntityType::Chats,
            Kind::Call => OpenSearchEntityType::CallRecords,
        }
    }
}

/// Who may find an entity. A document or chat is the viewer's when they own
/// it, and shared when its id is among the ids the search is given; a call is
/// visible only when its id is given.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Access {
    Own,
    Shared,
    Other,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Deleted {
    Nothing,
    /// One part is removed through the crate's delete path after the merge,
    /// so its words stay in the shard's term dictionary. Call segments are
    /// only ever deleted with their call, so this applies to documents and
    /// chats.
    Part(usize),
    Whole,
}

/// One entity, seeded as a document, a chat and a call alike: its parts are
/// the document's chunks, the chat's messages and the call's segments.
struct Fixture {
    name: &'static str,
    access: Access,
    parts: &'static [&'static str],
    deleted: Deleted,
}

const FIXTURES: &[Fixture] = &[
    // The crowded prefix: `con` must find this past the crowd's words.
    Fixture {
        name: "conveyor",
        access: Access::Own,
        parts: &["The conveyor belt stopped at noon."],
        deleted: Deleted::Nothing,
    },
    // Access: another user's match is never returned, a shared one is.
    Fixture {
        name: "another user's conveyor",
        access: Access::Other,
        parts: &["Conveyor inventory for the plant"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "shared conveyor manual",
        access: Access::Shared,
        parts: &["Shared conveyor manual"],
        deleted: Deleted::Nothing,
    },
    // Several terms: `All` needs each term somewhere in the entity, in any
    // part; `Dynamic` needs most of them in one part.
    Fixture {
        name: "quarterly and forecast apart",
        access: Access::Own,
        parts: &["Quarterly revenue grew again", "The forecast for next year"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "quarterly alone",
        access: Access::Own,
        parts: &["Quarterly numbers are in"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "one passage",
        access: Access::Own,
        parts: &["The quarterly revenue forecast dashboard is ready"],
        deleted: Deleted::Nothing,
    },
    // A phrase: its tokens in order at consecutive positions.
    Fixture {
        name: "deal review",
        access: Access::Own,
        parts: &["Notes from the deal review on Friday"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "review the deal",
        access: Access::Own,
        parts: &["We will review the deal later"],
        deleted: Deleted::Nothing,
    },
    // Punctuation: the analyzer splits `e-mail` into `e` and `mail`, keeps
    // `o'brien` and `node.js` whole, and reads `C++` as `c`.
    Fixture {
        name: "punctuation",
        access: Access::Own,
        parts: &["Send the e-mail to O'Brien about node.js and C++"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "email",
        access: Access::Own,
        parts: &["Check your email inbox"],
        deleted: Deleted::Nothing,
    },
    // Non-ASCII: `café` is not folded to `cafe`, and CJK text is one token
    // per ideograph.
    Fixture {
        name: "non-ascii",
        access: Access::Own,
        parts: &["Lunch at the café in Zürich", "東京タワーの近く"],
        deleted: Deleted::Nothing,
    },
    // `naïveté` sorts after every `naï` word of the crowd that
    // [`CAPPED_CASES`] seeds.
    Fixture {
        name: "naïveté",
        access: Access::Own,
        parts: &["Its naïveté showed"],
        deleted: Deleted::Nothing,
    },
    // One- and two-character terms match as a phrase, never as a prefix.
    Fixture {
        name: "q3",
        access: Access::Own,
        parts: &["Q3 revenue and a plan"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "q34",
        access: Access::Own,
        parts: &["Q34 targets"],
        deleted: Deleted::Nothing,
    },
    // Stopwords: `the` is an ordinary prefix in `All`; `Dynamic` leaves a
    // stopword out of its count unless it is the last term.
    Fixture {
        name: "theme",
        access: Access::Own,
        parts: &["There is a theme to this"],
        deleted: Deleted::Nothing,
    },
    // Deleted: a removed part and a removed entity match nothing.
    Fixture {
        name: "airship with a deleted part",
        access: Access::Own,
        parts: &["Airship schedule for spring", "The zeppelin landed early"],
        deleted: Deleted::Part(1),
    },
    Fixture {
        name: "deleted zeppelin",
        access: Access::Own,
        parts: &["The zeppelin hangar"],
        deleted: Deleted::Whole,
    },
];

struct Case {
    terms: &'static [&'static str],
    match_type: &'static str,
    /// Documents only; chats and calls always need every term.
    matching: DocumentTermMatching,
}

const CASES: &[Case] = &[
    // A crowded prefix, then the whole word.
    Case {
        terms: &["con"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["conveyor"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    // An exact search matches whole tokens only.
    Case {
        terms: &["conveyor"],
        match_type: "exact",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["conv"],
        match_type: "exact",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["quarterly", "forecast"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["quarterly", "revenue", "forecast"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["quarterly", "revenue", "forecast"],
        match_type: "partial",
        matching: DocumentTermMatching::Dynamic,
    },
    // Three of four counted terms in one part, the last one a prefix.
    Case {
        terms: &["quarterly", "revenue", "forecast", "dash"],
        match_type: "partial",
        matching: DocumentTermMatching::Dynamic,
    },
    // A stopword in the middle is not counted; one typed last is.
    Case {
        terms: &["deal", "the", "review", "notes"],
        match_type: "partial",
        matching: DocumentTermMatching::Dynamic,
    },
    Case {
        terms: &["revenue", "q3", "the"],
        match_type: "partial",
        matching: DocumentTermMatching::Dynamic,
    },
    Case {
        terms: &["deal review"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["e-mail"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["e-ma"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["o'brien"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["node.js"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["café"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["cafe"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["zür"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["東京"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["q3"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["a"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["the"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["zeppelin"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["airship"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
];

/// Crowded prefixes the search still expands to only the first 256 terms of a
/// shard: a term with punctuation or a non-ASCII letter matches as a phrase
/// prefix. `c++` has three characters, so the short-term rule, which counts
/// the term as typed, leaves it a prefix; it analyzes to `c`.
///
/// A deleted document keeps its words in the shard's dictionary for a while
/// (soft deletes outlive a merge), so the `naï` crowd these cases seed would
/// still crowd a later [`CASES`] run: no case there searches a `naï` prefix.
const CAPPED_CASES: &[Case] = &[
    Case {
        terms: &["con."],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["c++"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
    Case {
        terms: &["naï"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
    },
];

/// Lucene's English stop set, which `DocumentTermMatching::Dynamic` leaves
/// out of its count.
const STOPWORDS: [&str; 33] = [
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in", "into", "is", "it",
    "no", "not", "of", "on", "or", "such", "that", "the", "their", "then", "there", "these",
    "they", "this", "to", "was", "will", "with",
];

/// A seeded entity of one kind, with the ids its index holds.
struct Seeded {
    kind: Kind,
    name: String,
    access: Access,
    id: Uuid,
    /// Each part's id and content.
    parts: Vec<(String, String)>,
    deleted: Deleted,
}

impl Seeded {
    fn visible(&self) -> bool {
        self.access != Access::Other && self.deleted != Deleted::Whole
    }

    fn live_parts(&self) -> impl Iterator<Item = (usize, &(String, String))> {
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
            (
                format!("crowd {entity}"),
                Access::Other,
                vec![words.join(" ")],
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
/// all sort before `conveyor` and `naïveté`.
fn crowd_word(prefix: &str, n: usize) -> String {
    let letter = |value: usize| char::from(b'a' + u8::try_from(value % 26).unwrap_or(0));
    format!("{prefix}{}{}{}", letter(n / 676), letter(n / 26), letter(n))
}

#[tokio::test]
async fn content_search_returns_exactly_the_entities_its_rules_match() -> anyhow::Result<()> {
    run_cases(CASES, &["con"]).await
}

#[tokio::test]
#[ignore = "known bug: a content prefix with punctuation or a non-ASCII letter still expands to only the first 256 terms of a shard"]
async fn a_punctuated_or_non_ascii_prefix_finds_words_past_the_first_256() -> anyhow::Result<()> {
    run_cases(CAPPED_CASES, &["con", "naï"]).await
}

/// Seed the fixtures and a crowd for each of `crowded_prefixes`, run every
/// case, remove what was seeded, and fail listing each search that returned
/// other entities than its rules match.
async fn run_cases(cases: &[Case], crowded_prefixes: &[&str]) -> anyhow::Result<()> {
    let _one_at_a_time = SEARCH_INDICES.lock().await;
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
    let entities = seeded_entities(crowded_prefixes);

    remove_seeded(&raw, &entities).await?;
    for kind in KINDS {
        let index = kind.index().index_name();
        let count = count_documents(&raw, index).await?;
        if count != 0 {
            bail!(
                "`{index}` at {url} holds {count} documents; this test writes to the search \
                 aliases, so it needs an OpenSearch with empty search indices"
            );
        }
    }

    let result = seed_and_search(&client, &raw, &entities, cases).await;
    remove_seeded(&raw, &entities).await?;
    let failures = result?;
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
    let args = UnifiedSearchArgs {
        user_id: VIEWER.to_string(),
        page_size: 200,
        match_type: case.match_type.to_string(),
        cursor: SearchCursorOption::default(),
        search_indices: KINDS.iter().map(|kind| kind.index()).collect(),
        document_search_args: UnifiedDocumentSearchArgs {
            terms: terms.clone(),
            document_ids: ids_with(Kind::Document, &[Access::Shared]),
            mode: DocumentSearchMode::Content,
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
            mode: CallRecordSearchMode::Content,
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

/// The tokens `_analyze` gives each visible part, in position order.
struct Oracle {
    tokens: HashMap<(Kind, Uuid, String), Vec<String>>,
}

/// What a case should find: the matching entities, and the parts of them a
/// match may point to.
struct Expected {
    entities: BTreeSet<(Kind, Uuid)>,
    parts: HashSet<(Kind, Uuid, String)>,
}

/// One search term as one rule applies it.
struct Term {
    tokens: Vec<String>,
    prefix: bool,
}

impl Oracle {
    async fn new(raw: &OpenSearch, entities: &[Seeded]) -> anyhow::Result<Self> {
        let mut tokens = HashMap::new();
        for entity in entities.iter().filter(|entity| entity.visible()) {
            for (_, (part_id, content)) in entity.live_parts() {
                let part_tokens = analyze(raw, entity.kind, content).await?;
                tokens.insert((entity.kind, entity.id, part_id.clone()), part_tokens);
            }
        }
        Ok(Self { tokens })
    }

    async fn expected(&self, raw: &OpenSearch, case: &Case) -> anyhow::Result<Expected> {
        let mut expected = Expected {
            entities: BTreeSet::new(),
            parts: HashSet::new(),
        };
        for kind in KINDS {
            let mut all_terms = Vec::new();
            for term in case.terms {
                all_terms.push(Term {
                    tokens: analyze(raw, kind, term).await?,
                    prefix: is_prefix(term, case.match_type),
                });
            }
            let passage = match (kind, case.matching) {
                (Kind::Document, DocumentTermMatching::Dynamic) => {
                    passage_terms(raw, kind, case).await?
                }
                _ => None,
            };

            let mut parts_by_entity: HashMap<Uuid, Vec<(&String, &Vec<String>)>> = HashMap::new();
            for ((part_kind, entity, part), tokens) in &self.tokens {
                if *part_kind == kind {
                    parts_by_entity
                        .entry(*entity)
                        .or_default()
                        .push((part, tokens));
                }
            }

            for (entity, parts) in parts_by_entity {
                let matching_parts: Vec<&String> = match &passage {
                    // `Dynamic`: one part holds enough of the counted terms.
                    Some((terms, required)) => parts
                        .iter()
                        .filter(|(_, tokens)| {
                            let held = terms.iter().filter(|term| term.matches(tokens)).count();
                            held >= *required
                        })
                        .map(|(part, _)| *part)
                        .collect(),
                    // `All`: every term matches some part; a match points to
                    // a part that holds one of them.
                    None => {
                        let every_term_matches = all_terms
                            .iter()
                            .all(|term| parts.iter().any(|(_, tokens)| term.matches(tokens)));
                        if !every_term_matches {
                            continue;
                        }
                        parts
                            .iter()
                            .filter(|(_, tokens)| all_terms.iter().any(|term| term.matches(tokens)))
                            .map(|(part, _)| *part)
                            .collect()
                    }
                };
                if matching_parts.is_empty() {
                    continue;
                }
                expected.entities.insert((kind, entity));
                for part in matching_parts {
                    expected.parts.insert((kind, entity, part.clone()));
                }
            }
        }
        Ok(expected)
    }
}

/// The per-term rule of every content search: a term matches as a prefix
/// unless the search is exact, the term holds whitespace (a quoted phrase),
/// or it has fewer than three characters; those match as a phrase.
fn is_prefix(term: &str, match_type: &str) -> bool {
    match_type != "exact" && !term.chars().any(char::is_whitespace) && term.chars().count() >= 3
}

/// The terms `DocumentTermMatching::Dynamic` counts and how many of them one
/// part must hold, or `None` when the search keeps `All`: fewer than three
/// terms, or none left to count. Every term but the last is exact; a repeated
/// term counts once; a stopword is not counted unless it is the last term and
/// matches as a prefix. A part must hold all counted terms up to two, three
/// quarters of them (rounded down) beyond that.
async fn passage_terms(
    raw: &OpenSearch,
    kind: Kind,
    case: &Case,
) -> anyhow::Result<Option<(Vec<Term>, usize)>> {
    if case.terms.len() < 3 {
        return Ok(None);
    }
    let mut counted: Vec<String> = Vec::new();
    let mut terms = Vec::new();
    for (position, term) in case.terms.iter().enumerate() {
        let last = position + 1 == case.terms.len();
        let prefix = last && is_prefix(term, case.match_type);
        let lowercase = term.to_lowercase();
        if counted.contains(&lowercase) || (STOPWORDS.contains(&lowercase.as_str()) && !prefix) {
            continue;
        }
        counted.push(lowercase);
        terms.push(Term {
            tokens: analyze(raw, kind, term).await?,
            prefix,
        });
    }
    if terms.is_empty() {
        return Ok(None);
    }
    let required = if terms.len() <= 2 {
        terms.len()
    } else {
        terms.len() * 3 / 4
    };
    Ok(Some((terms, required)))
}

impl Term {
    /// A phrase matches a part holding the term's tokens in order at
    /// consecutive positions. As a prefix, its last token may be the start of
    /// a longer one. A term with no tokens matches nothing.
    fn matches(&self, part: &[String]) -> bool {
        let Some((last, leading)) = self.tokens.split_last() else {
            return false;
        };
        part.windows(self.tokens.len()).any(|window| {
            let (window_last, window_leading) = (&window[leading.len()], &window[..leading.len()]);
            let last_matches = if self.prefix {
                window_last.starts_with(last.as_str())
            } else {
                window_last == last
            };
            window_leading == leading && last_matches
        })
    }
}

fn compare(case: &Case, entities: &[Seeded], expected: &Expected, found: &Found) -> Vec<String> {
    let name = |kind: Kind, id: Uuid| {
        entities
            .iter()
            .find(|entity| entity.kind == kind && entity.id == id)
            .map_or_else(|| format!("unknown {id}"), |entity| entity.name.clone())
    };
    let label = format!(
        "{:?} ({}, {:?})",
        case.terms, case.match_type, case.matching
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
        let unexpected_parts: Vec<String> = found
            .parts
            .iter()
            .filter(|part| part.0 == kind && expected.entities.contains(&(kind, part.1)))
            .filter(|part| !expected.parts.contains(*part))
            .map(|(_, id, part)| format!("part {part} of {}", name(kind, *id)))
            .collect();
        if missing.is_empty() && unexpected.is_empty() && unexpected_parts.is_empty() {
            continue;
        }
        failures.push(format!(
            "{label} {kind:?}: missing {missing:?}, unexpected {unexpected:?}, unmatched parts {unexpected_parts:?}"
        ));
    }
    failures
}

/// The tokens of `text` under the analyzer of `kind`'s `content` field.
async fn analyze(raw: &OpenSearch, kind: Kind, text: &str) -> anyhow::Result<Vec<String>> {
    let body: serde_json::Value = raw
        .indices()
        .analyze(IndicesAnalyzeParts::Index(kind.index().index_name()))
        .body(serde_json::json!({ "field": "content", "text": text }))
        .send()
        .await?
        .error_for_status_code()?
        .json()
        .await?;
    let tokens = body["tokens"]
        .as_array()
        .with_context(|| format!("no tokens in {body}"))?;
    let mut ordered = Vec::new();
    for (expected_position, token) in tokens.iter().enumerate() {
        // Phrases compare tokens at consecutive positions; an analyzer that
        // leaves gaps (a stop filter) or stacks tokens needs positions here.
        if token["position"].as_u64() != Some(u64::try_from(expected_position)?) {
            bail!("`{text}` analyzed to tokens at other than consecutive positions: {body}");
        }
        let token = token["token"]
            .as_str()
            .with_context(|| format!("a token without text in {body}"))?;
        ordered.push(token.to_string());
    }
    Ok(ordered)
}

async fn refresh(raw: &OpenSearch, index: &str) -> anyhow::Result<()> {
    raw.indices()
        .refresh(IndicesRefreshParts::Index(&[index]))
        .send()
        .await?
        .error_for_status_code()?;
    Ok(())
}

async fn count_documents(raw: &OpenSearch, index: &str) -> anyhow::Result<u64> {
    let body: serde_json::Value = raw
        .count(CountParts::Index(&[index]))
        .send()
        .await?
        .error_for_status_code()?
        .json()
        .await?;
    body["count"]
        .as_u64()
        .with_context(|| format!("no count in {body}"))
}

/// Remove everything this test writes, by the ids it writes: parents by their
/// own id, chunks by their document's, messages and segments by their own.
async fn remove_seeded(raw: &OpenSearch, entities: &[Seeded]) -> anyhow::Result<()> {
    for kind in KINDS {
        let mut ids: Vec<String> = Vec::new();
        for entity in entities.iter().filter(|entity| entity.kind == kind) {
            ids.push(entity.id.to_string());
            if kind != Kind::Document {
                ids.extend(entity.parts.iter().map(|(part_id, _)| part_id.clone()));
            }
        }
        let index = kind.index().index_name();
        raw.delete_by_query(DeleteByQueryParts::Index(&[index]))
            .refresh(true)
            .body(serde_json::json!({ "query": { "terms": { "entity_id": ids } } }))
            .send()
            .await?
            .error_for_status_code()?;
    }
    Ok(())
}
