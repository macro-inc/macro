use super::*;
use crate::deps::QueryDependencies;
use crate::document::Document;
use crate::record_selection::RecordSelection;
use std::cell::RefCell;
use std::collections::BTreeMap;

#[derive(Default)]
struct CountingSource {
    records: BTreeMap<EntityKey<'static>, Record>,
    reads: RefCell<BTreeMap<EntityKey<'static>, usize>>,
}

impl RecordSource for CountingSource {
    fn get(&self, key: &EntityKey<'static>) -> Option<&Record> {
        *self.reads.borrow_mut().entry(key.clone()).or_default() += 1;
        self.records.get(key)
    }
}

fn key(id: &str) -> EntityKey<'static> {
    EntityKey(format!("GraphqlSoupEmailMessage:{id}").into())
}

fn message(id: &str) -> Record {
    Record {
        fields: [
            ("id".into(), CacheValue::String(id.into())),
            (
                "subject".into(),
                CacheValue::String(format!("Subject {id}")),
            ),
        ]
        .into(),
    }
}

fn thread() -> (EntityKey<'static>, Record) {
    (
        EntityKey("GraphqlSoupEmailThread:thread".into()),
        Record {
            fields: [
                ("id".into(), CacheValue::String("thread".into())),
                (
                    "messages".into(),
                    CacheValue::List(vec![
                        CacheValue::Ref(key("hot")),
                        CacheValue::Null,
                        CacheValue::Ref(key("cold")),
                        CacheValue::Ref(key("hot")),
                    ]),
                ),
            ]
            .into(),
        },
    )
}

#[test]
fn resumes_only_missing_branches_preserving_aliases_nulls_order_and_dependencies() {
    let selection = RecordSelection::parse(
        "fragment Thread on GraphqlSoupEmailThread { id first: messages { id subject } second: messages { id } }",
        "Thread",
    ).unwrap();
    let (thread_key, thread) = thread();
    let mut session = ReadSession::new(
        &thread_key,
        "GraphqlSoupEmailThread",
        selection.selection_set(),
    );
    let mut source = CountingSource::default();
    let mut deps = BTreeSet::new();
    let variables = serde_json::Map::new();
    let resolvers = EntityResolverLookup::default();
    let mut plans = ReadPlans::default();
    let first = session
        .resume(&variables, &source, &mut deps, &resolvers, &mut plans)
        .unwrap();
    assert!(matches!(first, ReadOutcome::NeedRecords(keys) if keys == [thread_key.clone()].into()));
    source.records.insert(thread_key.clone(), thread);
    source.records.insert(key("hot"), message("hot"));
    let second = session
        .resume(&variables, &source, &mut deps, &resolvers, &mut plans)
        .unwrap();
    assert!(matches!(second, ReadOutcome::NeedRecords(keys) if keys == [key("cold")].into()));
    let completed_reads = source.reads.borrow().clone();
    source.records.insert(key("cold"), message("cold"));
    let ReadOutcome::Complete(data) = session
        .resume(&variables, &source, &mut deps, &resolvers, &mut plans)
        .unwrap()
    else {
        panic!("all selected records are present");
    };
    assert_eq!(
        data,
        serde_json::json!({"id": "thread", "first": [
        {"id": "hot", "subject": "Subject hot"}, null,
        {"id": "cold", "subject": "Subject cold"}, {"id": "hot", "subject": "Subject hot"},
    ], "second": [{"id": "hot"}, null, {"id": "cold"}, {"id": "hot"}]})
    );
    assert_eq!(
        source.reads.borrow()[&key("hot")],
        completed_reads[&key("hot")]
    );
    assert_eq!(
        source.reads.borrow()[&thread_key],
        completed_reads[&thread_key]
    );
    assert_eq!(deps, [thread_key, key("hot"), key("cold")].into());
}

#[test]
fn overwritten_duplicate_selection_cannot_patch_later_output() {
    let selection = RecordSelection::parse(
        "fragment Thread on GraphqlSoupEmailThread { messages { id subject } ... on GraphqlSoupEmailThread { messages { id } } }",
        "Thread",
    ).unwrap();
    let (thread_key, thread) = thread();
    let mut session = ReadSession::new(
        &thread_key,
        "GraphqlSoupEmailThread",
        selection.selection_set(),
    );
    let mut source = CountingSource::default();
    source.records.insert(thread_key.clone(), thread);
    source.records.insert(key("hot"), message("hot"));
    let mut deps = BTreeSet::new();
    let variables = serde_json::Map::new();
    let resolvers = EntityResolverLookup::default();
    let mut plans = ReadPlans::default();
    assert!(matches!(
        session
            .resume(&variables, &source, &mut deps, &resolvers, &mut plans)
            .unwrap(),
        ReadOutcome::NeedRecords(_)
    ));
    source.records.insert(key("cold"), message("cold"));
    let ReadOutcome::Complete(data) = session
        .resume(&variables, &source, &mut deps, &resolvers, &mut plans)
        .unwrap()
    else {
        panic!("all selected records are present");
    };
    let ReadOutcome::Complete(expected) = denormalize_record(
        &thread_key,
        "GraphqlSoupEmailThread",
        selection.selection_set(),
        &variables,
        &source,
        &mut BTreeSet::new(),
    )
    .unwrap() else {
        panic!("fully resident read completes");
    };
    assert_eq!(data, expected);
    assert_eq!(data["messages"][2], serde_json::json!({"id": "cold"}));
    assert!(deps.contains(&key("cold")));
}

#[test]
fn a_field_miss_survives_later_record_hydration() {
    let selection = RecordSelection::parse(
        "fragment Thread on GraphqlSoupEmailThread { id messages { id subject } }",
        "Thread",
    )
    .unwrap();
    let (thread_key, mut thread) = thread();
    thread.fields.remove("id");
    let mut source = CountingSource::default();
    source.records.insert(thread_key.clone(), thread);
    let mut session = ReadSession::new(
        &thread_key,
        "GraphqlSoupEmailThread",
        selection.selection_set(),
    );
    let mut deps = BTreeSet::new();
    let variables = serde_json::Map::new();
    let resolvers = EntityResolverLookup::default();
    let mut plans = ReadPlans::default();
    assert!(matches!(
        session
            .resume(&variables, &source, &mut deps, &resolvers, &mut plans)
            .unwrap(),
        ReadOutcome::NeedRecords(_)
    ));
    source.records.insert(key("hot"), message("hot"));
    source.records.insert(key("cold"), message("cold"));
    assert!(
        matches!(session.resume(&variables, &source, &mut deps, &resolvers, &mut plans).unwrap(), ReadOutcome::Miss { entity, field } if entity == thread_key && field == "id")
    );
    assert_eq!(deps, [thread_key, key("hot"), key("cold")].into());
}

#[test]
fn resumed_reads_retain_argument_qualified_viewer_fields() {
    let document = Document::parse(
        "query Page { user { id page: soup(input: {initial: {limit: 1}}) { items { __typename id } } } }",
    ).unwrap();
    let operation = document.operation(Some("Page")).unwrap();
    let root = EntityKey::root();
    let viewer = EntityKey("GraphqlUser:viewer".into());
    let item = EntityKey("GraphqlSoupDocument:item".into());
    let page_key = field_key("soup", Some(r#"{"input":{"initial":{"limit":1}}}"#));
    let mut source = CountingSource::default();
    source.records.insert(
        root.clone(),
        Record {
            fields: [("user".into(), CacheValue::Ref(viewer.clone()))].into(),
        },
    );
    let mut session = ReadSession::new(&root, meta::QUERY_ROOT_TYPE, &operation.selection_set);
    let mut deps = QueryDependencies::default();
    let mut plans = ReadPlans::default();
    let variables = serde_json::Map::new();
    let resolvers = EntityResolverLookup::default();
    assert!(matches!(
        session.resume(&variables, &source, &mut deps, &resolvers, &mut plans).unwrap(),
        ReadOutcome::NeedRecords(keys) if keys == [viewer.clone()].into()
    ));
    source.records.insert(
        viewer.clone(),
        Record {
            fields: [
                ("id".into(), CacheValue::String("viewer".into())),
                (
                    page_key.clone(),
                    CacheValue::Object(
                        [(
                            "items".into(),
                            CacheValue::List(vec![CacheValue::Ref(item.clone())]),
                        )]
                        .into(),
                    ),
                ),
            ]
            .into(),
        },
    );
    assert!(matches!(
        session.resume(&variables, &source, &mut deps, &resolvers, &mut plans).unwrap(),
        ReadOutcome::NeedRecords(keys) if keys == [item.clone()].into()
    ));
    let viewer_reads = source.reads.borrow()[&viewer];
    source.records.insert(
        item.clone(),
        Record {
            fields: [
                (
                    "__typename".into(),
                    CacheValue::String("GraphqlSoupDocument".into()),
                ),
                ("id".into(), CacheValue::String("item".into())),
            ]
            .into(),
        },
    );
    let ReadOutcome::Complete(data) = session
        .resume(&variables, &source, &mut deps, &resolvers, &mut plans)
        .unwrap()
    else {
        panic!("hydrated query completes")
    };
    assert_eq!(
        data,
        serde_json::json!({"user": {"id": "viewer", "page": {"items": [
            {"__typename": "GraphqlSoupDocument", "id": "item"}
        ]}}})
    );
    assert_eq!(source.reads.borrow()[&viewer], viewer_reads);
    assert_eq!(
        deps.viewer_fields[&viewer],
        ["__typename".into(), "id".into(), page_key].into()
    );
    assert_eq!(deps.records, [root, viewer, item].into());
}
