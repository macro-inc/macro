//! Generated edit histories. Applying each published update to the previous
//! result, under the JS applier's rules, must equal a fresh full read. Leaf
//! edits take the binding path; links, tombstones, reorders, type changes and
//! barriers take the re-read diff.

use super::*;
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
  } nextCursor } }
}"#;
const ROWS: usize = 6;

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
    json!({"user": {"id": "viewer", "soup": {"items": items, "nextCursor": null}}})
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

async fn run(engine: &mut Engine<InMemoryStorage>, edit: Edit) {
    match edit {
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
}

impl Subscriber {
    async fn check(&mut self, engine: &mut Engine<InMemoryStorage>) -> Result<(), TestCaseError> {
        let update = engine
            .watch_query(self.op, QUERY, None, &vars(), &[], self.cursor)
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
            // Store every assignment, then link only the first so links can be added.
            for count in [3, 1] {
                let initial = (0..ROWS)
                    .map(|row| (row, count, PropertyValue::Options(vec!["a".into()])))
                    .collect();
                run(&mut engine, Edit::Page(initial)).await;
            }
            // The second subscriber skips reads, so its updates span several revisions.
            let mut subscribers = [1, 2].map(|op| Subscriber { op, data: Json::Null, cursor: None });
            for subscriber in &mut subscribers {
                subscriber.check(&mut engine).await?;
            }
            for (edit, read_second) in edits {
                run(&mut engine, edit).await;
                subscribers[0].check(&mut engine).await?;
                if read_second {
                    subscribers[1].check(&mut engine).await?;
                }
            }
            subscribers[1].check(&mut engine).await
        })?;
    }
}
