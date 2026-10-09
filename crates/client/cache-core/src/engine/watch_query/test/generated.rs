//! Generated edit histories. Applying each published update to the previous
//! result, under the JS applier's rules, must equal a fresh full read. Leaf
//! edits take the binding path; links, tombstones, reorders, type changes and
//! barriers take the re-read diff. Two derived favorites lists change through
//! evidence, pushed records, tombstones and optimistic layers.

use super::*;
use crate::queue::{MutationClaimRequest, MutationClaimToken};
use proptest::prelude::*;

const QUERY: &str = r#"
query Page($input: SoupInput!) {
  user { id soup(input: $input) { items {
    __typename id
    ... on GraphqlSoupEmailThread { isRead }
    ... on GraphqlSoupDocument {
      title: name
      properties { id value {
        kind: __typename
        ... on GraphqlSelectOptionPropertyValue { selected: optionIds }
        ... on GraphqlStringPropertyValue { text: value }
      } }
    }
  } nextCursor }
  documents: favorites(filter: {entityTypes: [DOCUMENT]}) { __typename id entityType sortOrder createdAt }
  all: favorites(filter: null) { __typename id sortOrder createdAt } }
}"#;
const FAVORITES: &str = r#"
query Favorites {
  user { id
    documents: favorites(filter: {entityTypes: [DOCUMENT]}) { __typename id entityType sortOrder createdAt }
    all: favorites(filter: null) { __typename id entityType sortOrder createdAt }
  }
}"#;
const SET_FAVORITE: &str = "mutation SetFavorite { setFavorite { favorite { __typename id entityType sortOrder createdAt } } }";
const ROWS: usize = 6;
const FAVORITE_IDS: usize = 5;

#[derive(Clone, Debug)]
enum PropertyValue {
    Null,
    Options(Vec<String>),
    Text(String),
}

#[derive(Clone, Debug)]
enum Edit {
    /// Rewrites membership, order, property list lengths and row fields.
    Page(Vec<(usize, usize, PropertyValue)>),
    Scalar {
        row: usize,
        value: String,
    },
    Property {
        row: usize,
        slot: usize,
        value: PropertyValue,
    },
    Delete {
        row: usize,
        slot: Option<usize>,
        deleted: bool,
    },
    /// Replaces a document's assignment links: adds, removes and reorders.
    Assign {
        row: usize,
        slots: Vec<usize>,
    },
    /// A journal barrier, as for records another engine changed.
    Invalidate {
        row: usize,
    },
    Unrelated(String),
    /// Server evidence for both favorites lists: (id, sort order, is a chat).
    Favorites(Vec<(usize, u8, bool)>),
    /// A server write of one favorite outside the lists.
    Favorite {
        id: usize,
        sort: u8,
        chat: bool,
    },
    Unfavorite {
        id: usize,
    },
    /// A pending optimistic favorite, or deletion when `sort` is `None`.
    Pending {
        id: usize,
        sort: Option<u8>,
    },
    /// Settles the oldest pending write: commit (as predicted) or rollback.
    Settle {
        commit: bool,
    },
}

fn favorite_value(id: usize, sort: u8, chat: bool) -> Json {
    json!({
        "__typename": "GraphqlFavorite", "id": format!("fav-{id}"),
        "entityType": if chat { "CHAT" } else { "DOCUMENT" },
        "sortOrder": sort, "createdAt": "2026-10-01T00:00:00Z"
    })
}

fn property_value() -> impl Strategy<Value = PropertyValue> {
    prop_oneof![
        Just(PropertyValue::Null),
        prop::collection::vec("[a-c]", 0..3).prop_map(PropertyValue::Options),
        "[a-c]{0,2}".prop_map(PropertyValue::Text),
    ]
}

// Leaf edits and tombstones dominate so that compacted bindings get exercised.
fn edit() -> impl Strategy<Value = Edit> {
    prop_oneof![
        1 => prop::collection::vec((0..ROWS, 0usize..3, property_value()), 0..=ROWS)
            .prop_map(Edit::Page),
        4 => (0..ROWS, "[a-c]{1,2}").prop_map(|(row, value)| Edit::Scalar { row, value }),
        3 => (0..ROWS, 0usize..3, property_value()).prop_map(|(row, slot, value)| Edit::Property {
            row,
            slot,
            value
        }),
        3 => (0..ROWS, prop::option::weighted(0.3, 0usize..3), any::<bool>())
            .prop_map(|(row, slot, deleted)| Edit::Delete { row, slot, deleted }),
        2 => (0..ROWS, prop::collection::vec(0usize..3, 0..4))
            .prop_map(|(row, slots)| Edit::Assign { row, slots }),
        1 => (0..ROWS).prop_map(|row| Edit::Invalidate { row }),
        1 => "[a-b]{0,2}".prop_map(Edit::Unrelated),
        1 => prop::collection::btree_map(0..FAVORITE_IDS, (0u8..6, prop::bool::weighted(0.2)), 0..=FAVORITE_IDS)
            .prop_map(|favorites| {
                let mut favorites: Vec<_> = favorites
                    .into_iter()
                    .map(|(id, (sort, chat))| (id, sort, chat))
                    .collect();
                favorites.sort_by_key(|(id, sort, _)| (*sort, *id));
                Edit::Favorites(favorites)
            }),
        2 => (0..FAVORITE_IDS, 0u8..6, prop::bool::weighted(0.2))
            .prop_map(|(id, sort, chat)| Edit::Favorite { id, sort, chat }),
        1 => (0..FAVORITE_IDS).prop_map(|id| Edit::Unfavorite { id }),
        2 => (0..FAVORITE_IDS, prop::option::weighted(0.7, 0u8..6))
            .prop_map(|(id, sort)| Edit::Pending { id, sort }),
        1 => any::<bool>().prop_map(|commit| Edit::Settle { commit }),
    ]
}

/// Even rows are documents with properties; odd rows are email threads.
fn is_document(row: usize) -> bool {
    row.is_multiple_of(2)
}

fn row_key(row: usize) -> EntityKey<'static> {
    if is_document(row) {
        EntityKey::entity("GraphqlSoupDocument", &[&format!("doc-{row}")])
    } else {
        EntityKey::entity("GraphqlSoupEmailThread", &[&format!("thread-{row}")])
    }
}

fn property_key(row: usize, slot: usize) -> EntityKey<'static> {
    EntityKey::entity("GraphqlProperty", &[&format!("property-{row}-{slot}")])
}

fn response_value(value: &PropertyValue) -> Json {
    match value {
        PropertyValue::Null => Json::Null,
        PropertyValue::Options(ids) => {
            json!({"kind": "GraphqlSelectOptionPropertyValue", "selected": ids})
        }
        PropertyValue::Text(text) => json!({"kind": "GraphqlStringPropertyValue", "text": text}),
    }
}

fn stored_value(value: &PropertyValue) -> CacheValue {
    let (typename, field, value) = match value {
        PropertyValue::Null => return CacheValue::Null,
        PropertyValue::Options(ids) => (
            "GraphqlSelectOptionPropertyValue",
            "optionIds",
            CacheValue::List(ids.iter().cloned().map(CacheValue::String).collect()),
        ),
        PropertyValue::Text(text) => (
            "GraphqlStringPropertyValue",
            "value",
            CacheValue::String(text.clone()),
        ),
    };
    CacheValue::Object(BTreeMap::from([
        ("__typename".into(), CacheValue::String(typename.into())),
        (field.into(), value),
    ]))
}

fn page(rows: &[(usize, usize, PropertyValue)]) -> Json {
    let items: Vec<_> = rows
        .iter()
        .map(|(row, count, value)| {
            if is_document(*row) {
                json!({
                    "__typename": "GraphqlSoupDocument", "id": format!("doc-{row}"),
                    "title": format!("doc {row}"),
                    "properties": (0..*count).map(|slot| json!({
                        "id": format!("property-{row}-{slot}"), "value": response_value(value)
                    })).collect::<Vec<_>>()
                })
            } else {
                json!({"__typename": "GraphqlSoupEmailThread", "id": format!("thread-{row}"), "isRead": false})
            }
        })
        .collect();
    json!({"user": {
        "id": "viewer", "soup": {"items": items, "nextCursor": null},
        "documents": [favorite_value(0, 0, false)],
        "all": [favorite_value(0, 0, false), favorite_value(1, 1, true)],
    }})
}

/// Pending optimistic favorites, in queue order, with their predictions.
#[derive(Default)]
struct Pending {
    predictions: std::collections::VecDeque<Json>,
    created: u64,
}

impl Pending {
    async fn enqueue(&mut self, engine: &mut Engine<InMemoryStorage>, id: usize, sort: Option<u8>) {
        self.created += 1;
        let favorite = sort.map(|sort| favorite_value(id, sort, false));
        let data = json!({"setFavorite": {"favorite": favorite}});
        let bindings = match sort {
            Some(_) => vec![],
            None => vec![identity::IdentityBinding {
                local_key: EntityKey::entity("GraphqlFavorite", &[&format!("fav-{id}")]),
                delete_record: true,
                response_path: vec![],
                reference_fields: vec![],
                revalidation_variables: vec![],
            }],
        };
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    client_metadata: None,
                    identity_bindings: &bindings,
                    uuid: &format!("00000000-0000-4000-8000-{:012}", self.created),
                    query: SET_FAVORITE,
                    operation_name: None,
                    variables: &serde_json::Map::new(),
                    data: &data,
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .unwrap();
        self.predictions.push_back(data);
    }

    async fn settle(&mut self, engine: &mut Engine<InMemoryStorage>, commit: bool) {
        let Some(claimed) = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 0,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
        else {
            return;
        };
        let data = self
            .predictions
            .pop_front()
            .expect("claimed a pending write");
        let token = MutationClaimToken {
            owner: "runner".into(),
            generation: claimed.lease_generation,
        };
        let transaction = claimed.queued.id;
        if commit {
            engine
                .commit_optimistic_write(
                    transaction,
                    token,
                    SET_FAVORITE,
                    None,
                    &serde_json::Map::new(),
                    &data,
                )
                .await
                .unwrap();
        } else {
            engine
                .rollback_optimistic_write(transaction, token)
                .await
                .unwrap();
        }
    }
}

async fn put(
    engine: &mut Engine<InMemoryStorage>,
    key: EntityKey<'static>,
    field: &str,
    value: CacheValue,
) {
    engine
        .put_records_with_projections(
            None,
            vec![(
                key,
                Record {
                    fields: BTreeMap::from([(field.into(), value)]),
                },
            )],
            vec![],
        )
        .await
        .unwrap();
}

async fn run(engine: &mut Engine<InMemoryStorage>, pending: &mut Pending, edit: Edit) {
    match edit {
        Edit::Favorites(favorites) => {
            let value = |&(id, sort, chat): &(usize, u8, bool)| favorite_value(id, sort, chat);
            let documents: Vec<_> = favorites
                .iter()
                .filter(|(_, _, chat)| !chat)
                .map(value)
                .collect();
            let all: Vec<_> = favorites.iter().map(value).collect();
            engine
                .write_query(
                    None,
                    FAVORITES,
                    None,
                    &serde_json::Map::new(),
                    &json!({"user": {"id": "viewer", "documents": documents, "all": all}}),
                    None,
                )
                .await
                .unwrap();
        }
        Edit::Favorite { id, sort, chat } => {
            engine
                .write_query(
                    None,
                    SET_FAVORITE,
                    None,
                    &serde_json::Map::new(),
                    &json!({"setFavorite": {"favorite": favorite_value(id, sort, chat)}}),
                    None,
                )
                .await
                .unwrap();
        }
        Edit::Unfavorite { id } => {
            let key = EntityKey::entity("GraphqlFavorite", &[&format!("fav-{id}")]);
            put(engine, key, identity::DELETED_FIELD, CacheValue::Bool(true)).await;
        }
        Edit::Pending { id, sort } => pending.enqueue(engine, id, sort).await,
        Edit::Settle { commit } => pending.settle(engine, commit).await,
        Edit::Page(rows) => {
            engine
                .write_query(None, QUERY, None, &vars(), &page(&rows), None)
                .await
                .unwrap();
        }
        Edit::Scalar { row, value } => {
            let (field, value) = if is_document(row) {
                ("name", CacheValue::String(value))
            } else {
                ("isRead", CacheValue::Bool(value.len() == 1))
            };
            put(engine, row_key(row), field, value).await;
        }
        Edit::Property { row, slot, value } => {
            put(
                engine,
                property_key(row, slot),
                "value",
                stored_value(&value),
            )
            .await;
        }
        Edit::Delete { row, slot, deleted } => {
            let key = slot.map_or_else(|| row_key(row), |slot| property_key(row, slot));
            put(
                engine,
                key,
                identity::DELETED_FIELD,
                CacheValue::Bool(deleted),
            )
            .await;
        }
        Edit::Assign { row, slots } => {
            let links = slots
                .into_iter()
                .map(|slot| CacheValue::Ref(property_key(row, slot)))
                .collect();
            put(engine, row_key(row), "properties", CacheValue::List(links)).await;
        }
        Edit::Invalidate { row } => {
            engine.invalidate_keys([&row_key(row)]).unwrap();
        }
        Edit::Unrelated(value) => {
            let key = EntityKey::entity("GraphqlSoupDocument", &["unrelated"]);
            put(engine, key, "name", CacheValue::String(value)).await;
        }
    }
}

struct Subscriber {
    op: OpId,
    data: Json,
    cursor: Option<CacheRevision>,
    options: WatchOptions,
}

impl Subscriber {
    async fn check(&mut self, engine: &mut Engine<InMemoryStorage>) -> Result<(), TestCaseError> {
        let update = engine
            .watch_query_with_options(
                self.op,
                QUERY,
                None,
                &vars(),
                &[],
                self.cursor,
                self.options,
            )
            .await
            .unwrap();
        let full = engine.read_query(None, QUERY, None, &vars()).await.unwrap();
        match (update, full) {
            (QueryUpdate::Miss { .. }, ReadResult::Miss) => self.cursor = None,
            (update, ReadResult::Hit { data }) => {
                self.cursor = Some(apply(&mut self.data, update));
                prop_assert_eq!(&self.data, &data);
            }
            (update, ReadResult::Miss) => prop_assert!(false, "{update:?} for a missing query"),
        }
        Ok(())
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]
    #[test]
    fn applied_updates_match_full_reads(
        capacity in prop::sample::select(vec![1usize, DEFAULT_HOT_CAPACITY]),
        edits in prop::collection::vec((edit(), any::<bool>()), 1..24),
    ) {
        block_on(async {
            let mut engine = Engine::with_capacity(InMemoryStorage::new(), capacity);
            let mut pending = Pending::default();
            // Store every assignment, then link only the first so links can be added.
            for count in [3, 1] {
                let initial = (0..ROWS)
                    .map(|row| (row, count, PropertyValue::Options(vec!["a".into()])))
                    .collect();
                run(&mut engine, &mut pending, Edit::Page(initial)).await;
            }
            // The second subscriber skips reads, so its updates span several
            // revisions. The third receives list replacements instead of splices.
            let mut subscribers = [(1, true), (2, true), (3, false)].map(|(op, splices)| Subscriber {
                op,
                data: Json::Null,
                cursor: None,
                options: WatchOptions { splices },
            });
            for subscriber in &mut subscribers {
                subscriber.check(&mut engine).await?;
            }
            for (edit, read_second) in edits {
                run(&mut engine, &mut pending, edit).await;
                subscribers[0].check(&mut engine).await?;
                subscribers[2].check(&mut engine).await?;
                if read_second {
                    subscribers[1].check(&mut engine).await?;
                }
            }
            subscribers[1].check(&mut engine).await
        })?;
    }
}
