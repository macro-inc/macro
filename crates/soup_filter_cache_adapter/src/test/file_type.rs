use super::*;
use cache_core::{
    engine::{BeginOptimisticWrite, Engine, NetworkWrite},
    predicate::{PredicateIndexStorage, PredicateQueryResult},
    queue::{MutationClaimRequest, MutationClaimToken},
    store::InMemoryStorage,
};
use serde_json::{Value, json};

const FILE_TYPES: [Option<&str>; 8] = [
    Some("pdf"),
    Some("doc"),
    Some("custom.ext"),
    Some("PDF"),
    Some(".pdf"),
    Some(""),
    None,
    Some("md"),
];
const RENAME: &str = r#"mutation Rename($inputs: [RenameEntityInput!]!) {
    renameEntities(inputs: $inputs) { results { __typename
        ... on GraphqlMutationSuccess { effects { __typename
            ... on SoupUpdated { item { __typename id
                ... on GraphqlSoupDocument { fileType updatedAt }
            } }
        } }
    } }
}"#;

fn id(index: usize) -> String {
    uuid::Uuid::from_u128(index as u128 + 1).to_string()
}
fn key(index: usize) -> RecordKey {
    RecordKey::new(format!("GraphqlSoupDocument:{}", id(index))).unwrap()
}
fn item(index: usize) -> Value {
    let mut item = selected_document(
        &id(index),
        json!(document_supplement(&id(index), false)),
        Value::Null,
    );
    item["fileType"] = json!(FILE_TYPES[index]);
    item["properties"] = json!([]);
    item
}
fn filters(document: Value) -> Value {
    let nil = uuid::Uuid::nil().to_string();
    json!({
        "documentFilter": document,
        "calendarEventFilter": {"literal":{"id":nil}},
        "projectFilter": {"literal":{"projectIdSelf":nil}},
        "chatFilter": {"literal":{"chatId":nil}},
        "emailFilter": {"tree":{"literal":{"threadId":nil}}},
        "channelFilter": {"literal":{"channelId":nil}},
        "channelThreadFilter": {"literal":{"threadId":nil}},
        "callFilter": {"literal":{"callId":nil}},
        "crmCompanyFilter": {"literal":{"id":nil}},
        "foreignEntityFilter": {"literal":{"id":nil}}
    })
}
fn query(document: Value) -> ValidatedIndexQuery {
    let SoupFilterCompileOutcome::Supported(query) =
        compile_current_filter_request(filters(document), "UPDATED_AT", "DESC", 20).unwrap()
    else {
        panic!("file-type filters must be locally supported");
    };
    query
}
fn not(expr: Value) -> Value {
    json!({"not":expr})
}

// Independent SQL three-valued reference: WHERE selects only True, not Unknown.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SqlTruth {
    True,
    False,
    Unknown,
}
impl SqlTruth {
    fn from_bool(value: bool) -> Self {
        if value { Self::True } else { Self::False }
    }
    fn negate(self) -> Self {
        match self {
            Self::True => Self::False,
            Self::False => Self::True,
            Self::Unknown => Self::Unknown,
        }
    }
    fn and(self, other: Self) -> Self {
        match (self, other) {
            (Self::False, _) | (_, Self::False) => Self::False,
            (Self::True, Self::True) => Self::True,
            _ => Self::Unknown,
        }
    }
    fn or(self, other: Self) -> Self {
        match (self, other) {
            (Self::True, _) | (_, Self::True) => Self::True,
            (Self::False, Self::False) => Self::False,
            _ => Self::Unknown,
        }
    }
}
fn sql_reference(expr: &Value, index: usize) -> SqlTruth {
    if let Some(literal) = expr.get("literal") {
        if let Some(file_type) = literal.get("fileType") {
            return FILE_TYPES[index].map_or(SqlTruth::Unknown, |stored| {
                SqlTruth::from_bool(stored == file_type.as_str().unwrap())
            });
        }
        return SqlTruth::from_bool(literal["id"].as_str().unwrap() == id(index));
    }
    if let Some(expr) = expr.get("not") {
        return sql_reference(expr, index).negate();
    }
    if let Some(and) = expr.get("and") {
        return sql_reference(&and["left"], index).and(sql_reference(&and["right"], index));
    }
    let or = &expr["or"];
    sql_reference(&or["left"], index).or(sql_reference(&or["right"], index))
}
fn expressions() -> Vec<Value> {
    let atoms = [
        json!({"literal":{"fileType":"pdf"}}),
        json!({"literal":{"fileType":"md"}}),
        json!({"literal":{"id":id(6)}}),
    ];
    let mut expressions = Vec::new();
    for atom in &atoms {
        expressions.extend([atom.clone(), not(atom.clone()), not(not(atom.clone()))]);
    }
    for left in &atoms {
        for right in &atoms {
            for op in ["and", "or"] {
                let expr = json!({op:{"left":left,"right":right}});
                expressions.extend([expr.clone(), not(expr.clone()), not(not(expr))]);
            }
        }
    }
    expressions.push(not(json!({"or": {
        "left": not(atoms[0].clone()),
        "right": {"and":{"left":atoms[1],"right":not(atoms[2].clone())}}
    }})));
    expressions
}

async fn seed<S: PredicateIndexStorage>(engine: &mut Engine<S>) {
    let query = SUPPLEMENT_BACKFILL
        .replace("user {", "user { id")
        .replace("fileType", "fileType properties { id }");
    let data = json!({"user":{"id":"viewer","soup":{"items":(0..FILE_TYPES.len()).map(item).collect::<Vec<_>>()}}});
    let vars = serde_json::Map::new();
    let projections =
        authoritative_projection_mutations(&query, Some("SoupBackfill"), &data).unwrap();
    let projections = crate::properties::augment_authoritative(
        engine.storage(),
        &query,
        Some("SoupBackfill"),
        &vars,
        &data,
        true,
        projections,
    )
    .await
    .unwrap();
    engine
        .hydrate_query_with_projections(
            &query,
            Some("SoupBackfill"),
            &vars,
            &data,
            Some("viewer"),
            projections,
        )
        .await
        .unwrap();
}
async fn assert_sql_parity<S: PredicateIndexStorage>(engine: &mut Engine<S>) {
    for expression in expressions() {
        let expected = (0..FILE_TYPES.len())
            .rev()
            .filter(|&i| sql_reference(&expression, i) == SqlTruth::True)
            .map(key)
            .collect();
        let actual = engine
            .query_predicate_index(&query(expression.clone()))
            .await
            .unwrap()
            .value;
        assert_eq!(
            actual,
            PredicateQueryResult::Complete(expected),
            "{expression}"
        );
    }
}
async fn assert_updated_type<S: PredicateIndexStorage>(engine: &mut Engine<S>, value: &Value) {
    let file_type = json!({"literal":{"fileType":"pdf"}});
    for (filter, matches) in [
        (file_type.clone(), value == "pdf"),
        (not(file_type), !value.is_null() && value != "pdf"),
    ] {
        let query = query(json!({"and":{"left":{"literal":{"id":id(0)}},"right":filter}}));
        let result = engine.query_predicate_index(&query).await.unwrap().value;
        let keys = match result {
            PredicateQueryResult::Complete(keys) | PredicateQueryResult::Optimistic(keys) => keys,
            PredicateQueryResult::Incomplete => {
                panic!("file-type changes must preserve projection completeness")
            }
        };
        assert_eq!(keys, if matches { vec![key(0)] } else { vec![] });
    }
}

async fn lifecycle<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    seed(&mut engine).await;
    assert_sql_parity(&mut engine).await;
    let mut engine = Engine::new(engine.into_storage());
    assert_sql_parity(&mut engine).await;

    // A partial authoritative update can replace a known type with an unknown
    // string or NULL without losing the complete supplement/property proof.
    let vars =
        json!({"inputs":[{"entity":{"type":"DOCUMENT","id":id(0)},"displayName":"renamed"}]})
            .as_object()
            .unwrap()
            .clone();
    for value in [json!("legacy-format"), Value::Null, json!("pdf")] {
        seed(&mut engine).await;
        let data = json!({"renameEntities":{"results":[{"__typename":"GraphqlMutationSuccess","effects":[{"__typename":"SoupUpdated","item":{
            "__typename":"GraphqlSoupDocument","id":id(0),"fileType":value,"updatedAt":"2025-01-02T00:00:00.000001Z"
        }}]}]}});
        // Start from pdf, then change its membership only in the pending layer.
        let projections = crate::properties::augment_optimistic(
            engine.storage(),
            RENAME,
            Some("Rename"),
            &vars,
            &data,
            optimistic_projection_mutations(&data, 1),
        )
        .await
        .unwrap();
        let (transaction, _) = engine
            .begin_optimistic_write_with_projections(
                None,
                BeginOptimisticWrite {
                    uuid: "00000000-0000-0000-0000-000000000100",
                    query: RENAME,
                    operation_name: Some("Rename"),
                    variables: &vars,
                    data: &data,
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
                projections,
            )
            .await
            .unwrap();
        assert_updated_type(&mut engine, &value).await;
        let mut reopened = Engine::new(engine.into_storage());
        assert_updated_type(&mut reopened, &value).await;
        let claimed = reopened
            .claim_next_mutation(MutationClaimRequest {
                owner: "test".into(),
                now_ms: 1,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.queued.id, transaction);
        reopened
            .rollback_optimistic_write(
                transaction,
                MutationClaimToken {
                    owner: "test".into(),
                    generation: claimed.lease_generation,
                },
            )
            .await
            .unwrap();
        engine = reopened;
        assert_updated_type(&mut engine, &json!("pdf")).await;

        let projections =
            authoritative_projection_mutations(RENAME, Some("Rename"), &data).unwrap();
        let projections = crate::properties::augment_authoritative(
            engine.storage(),
            RENAME,
            Some("Rename"),
            &vars,
            &data,
            true,
            projections,
        )
        .await
        .unwrap();
        engine
            .write_query_with_registration_and_projections(
                None,
                None,
                NetworkWrite {
                    query: RENAME,
                    operation_name: Some("Rename"),
                    variables: &vars,
                    data: &data,
                    identity: Some("viewer"),
                },
                projections,
            )
            .await
            .unwrap();
        assert_updated_type(&mut engine, &value).await;
    }
    assert_sql_parity(&mut engine).await;
}

#[test]
fn every_soup_profile_compiles_file_type_negation_with_sql_null_semantics() {
    let data =
        json!({"user":{"soup":{"items":(0..FILE_TYPES.len()).map(item).collect::<Vec<_>>()}}});
    let documents =
        authoritative_projection_mutations(SUPPLEMENT_BACKFILL, Some("SoupBackfill"), &data)
            .unwrap();
    for compile in [
        item_filter_index::compile_soup_flat_v1,
        item_filter_index::compile_soup_flat_v2,
        item_filter_index::compile_soup_flat_v3,
        item_filter_index::compile_soup_flat_v4,
    ] {
        for expression in expressions() {
            let ast = materialize_graphql_filter(filters(expression.clone())).unwrap();
            let item_filter_index::LocalCompileOutcome::Supported(query) = compile(
                &ast,
                SoupFlatRequest {
                    sort: SoupIndexSort::UpdatedAt,
                    direction: SortDirection::Desc,
                    limit: 20,
                    has_cursor: false,
                },
            )
            .unwrap() else {
                panic!("file-type filters must be supported");
            };
            let predicate = &query.as_query().partitions[0].predicate;
            for (index, mutation) in documents.iter().enumerate() {
                let ProjectionMutation::Replace(document) = mutation else {
                    panic!("complete document");
                };
                assert_eq!(
                    document.matches(predicate),
                    sql_reference(&expression, index) == SqlTruth::True,
                    "{expression}: {:?}",
                    FILE_TYPES[index]
                );
            }
        }
    }
}

#[test]
fn raw_file_type_and_sql_null_filtering_in_memory() {
    pollster::block_on(lifecycle(InMemoryStorage::new()));
}
#[test]
fn raw_file_type_and_sql_null_filtering_in_turso() {
    pollster::block_on(async {
        lifecycle(cache_turso::TursoStorage::open_in_memory("raw-file-types").unwrap()).await
    });
}
#[test]
fn malformed_file_type_data_is_still_rejected_but_unknown_filter_inputs_are_not_added() {
    for file_type in [
        json!(false),
        json!(12),
        json!([]),
        json!({}),
        json!("x".repeat(predicate_index::MAX_EXACT_VALUE_BYTES + 1)),
    ] {
        let mut item = item(0);
        item["fileType"] = file_type;
        assert!(
            authoritative_projection_mutations(
                SUPPLEMENT_BACKFILL,
                Some("SoupBackfill"),
                &json!({"user":{"soup":{"items":[item]}}})
            )
            .is_err()
        );
    }
    let mut missing = item(0);
    missing.as_object_mut().unwrap().remove("fileType");
    assert!(
        authoritative_projection_mutations(
            SUPPLEMENT_BACKFILL,
            Some("SoupBackfill"),
            &json!({"user":{"soup":{"items":[missing]}}})
        )
        .is_err()
    );
    assert!(
        compile_current_filter_request(
            filters(json!({"literal":{"fileType":"doc"}})),
            "UPDATED_AT",
            "DESC",
            20
        )
        .is_err()
    );
    // Query inputs still normalize known spellings; stored values do not.
    assert_eq!(
        query(json!({"literal":{"fileType":".PDF"}})),
        query(json!({"literal":{"fileType":"pdf"}}))
    );
}
