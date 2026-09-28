//! Independent durable-cache population fixtures. Background records share the
//! viewer with the measured operation but have disjoint document identities.
use cache_core::{document::Document, normalize::normalize, value::EntityKey};
use serde_json::{Map, Value, json};

pub const QUERY: &str = include_str!("population.graphql");
pub const BATCH_SIZE: usize = cache_core::record_selection::MAX_RECORD_SELECTION_KEYS;

pub fn batches(count: usize) -> Vec<Value> {
    apollo_compiler::ExecutableDocument::parse_and_validate(
        super::corpus::schema(),
        QUERY,
        "population.graphql",
    )
    .unwrap();
    (0..count).step_by(BATCH_SIZE).map(|start| {
        let items: Vec<_> = (start..count.min(start + BATCH_SIZE)).map(|index| json!({
            "__typename": "GraphqlSoupDocument",
            "id": format!("ffffffff-ffff-7000-8000-{index:012x}"),
            "name": format!("Background document {index}: planning notes and collaboration history"),
            "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-02T00:00:00Z",
        })).collect();
        json!({"__typename": "SoupQueryRoot", "user": {
            "__typename": "GraphqlUser", "id": "macro|cache-perf@example.com",
            "soup": {"__typename": "SoupPage", "items": items},
        }})
    }).collect()
}

pub fn records(data: &Value) -> cache_core::normalize::RecordUpdates {
    let document = Document::parse(QUERY).unwrap();
    normalize(
        document.operation(Some("BenchmarkPopulation")).unwrap(),
        &Map::new(),
        data,
    )
    .unwrap()
}

pub fn document_keys(count: usize) -> Vec<EntityKey<'static>> {
    (0..count)
        .map(|index| {
            EntityKey(format!("GraphqlSoupDocument:ffffffff-ffff-7000-8000-{index:012x}").into())
        })
        .collect()
}
