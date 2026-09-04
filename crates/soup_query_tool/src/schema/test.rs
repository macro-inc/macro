use std::collections::HashMap;
use std::sync::Arc;

use crate::ReadQuery;
use crate::listing::{ListingError, ListingPage, ListingRequest, SoupLister};
use crate::schema::{SCHEMA, compact_sdl};

#[test]
fn mutation_is_unrepresentable() {
    let err = ReadQuery::parse(
        "mutation { deleteEntitiesPermanently(input: {ids: []}) { ok } }",
        None,
    )
    .unwrap_err();
    assert!(matches!(
        err,
        crate::QueryRejected::WriteOperation("mutation")
    ));
}

#[test]
fn subscription_is_unrepresentable() {
    let err = ReadQuery::parse("subscription { x }", None).unwrap_err();
    assert!(matches!(
        err,
        crate::QueryRejected::WriteOperation("subscription")
    ));
}

#[test]
fn schema_has_no_mutation_root() {
    let sdl = compact_sdl();
    for forbidden in [
        "type Mutation",
        "type Subscription",
        "deleteEntitiesPermanently",
        "CompleteMutationRoot",
        "CRM_COMPANY",
        "REMINDER",
        "nextCursor",
        "continuation",
    ] {
        assert!(
            !sdl.contains(forbidden),
            "query-only SDL must not contain {forbidden}"
        );
    }
}

#[tokio::test]
async fn compact_keys_name_the_graphql_field() {
    let response = SCHEMA
        .execute("{ soup(input: { dst: TASK }) { items { id } } }")
        .await;
    assert!(!response.errors.is_empty());
    let message = crate::tool::describe_errors(&response.errors);
    assert!(
        message.contains("`dst` is a deleted ListEntities key; write `subType`."),
        "{message}"
    );
}

#[tokio::test]
async fn schema_rejects_mutation_even_if_gate_is_bypassed() {
    let response = SCHEMA
        .execute("mutation { deleteEntitiesPermanently(input: {ids: []}) { ok } }")
        .await;
    assert!(!response.errors.is_empty());
}

#[test]
fn tool_schema_is_a_subset_of_the_authoritative_schema() {
    let tool = apollo_compiler::Schema::parse_and_validate(compact_sdl(), "tool.graphql")
        .expect("tool SDL should parse");
    let full = apollo_compiler::Schema::parse_and_validate(
        include_str!("../../../../static_assets/schema.graphql"),
        "schema.graphql",
    )
    .expect("authoritative SDL should parse");
    for (name, def) in tool.types.iter() {
        let name = name.as_str();
        if !name.starts_with("Graphql") {
            continue;
        }
        if matches!(
            name,
            "GraphqlEmailFilterAst" | "GraphqlEntityFilterAst" | "GraphqlProperty"
        ) {
            // Tool-owned honest subsets of these input/output wrappers.
            continue;
        }
        let Some(upstream) = full.types.get(name) else {
            panic!("tool type {name} is missing from static_assets/schema.graphql");
        };
        assert_eq!(
            std::mem::discriminant(def),
            std::mem::discriminant(upstream),
            "{name} changed kind relative to the authoritative schema"
        );
    }
}

struct EmptyLister {
    limit: std::sync::Mutex<Option<u16>>,
}

#[async_trait::async_trait]
impl SoupLister for EmptyLister {
    async fn list(&self, request: ListingRequest) -> Result<ListingPage, ListingError> {
        *self.limit.lock().unwrap() = Some(request.limit.get());
        Ok(ListingPage {
            items: Vec::new(),
            has_more: false,
            tag_labels: HashMap::new(),
        })
    }
}

#[tokio::test]
async fn execute_returns_a_graphql_page() {
    let read = ReadQuery::parse(
        "{ soup(input: { limit: 5 }) { items { id } hasMore summary } }",
        None,
    )
    .unwrap();
    let lister = Arc::new(EmptyLister {
        limit: std::sync::Mutex::new(None),
    });
    let response = SCHEMA
        .execute(
            read.into_request()
                .data(Arc::clone(&lister) as Arc<dyn SoupLister>),
        )
        .await;
    assert!(
        response.errors.is_empty(),
        "unexpected errors: {:?}",
        response.errors
    );
    assert_eq!(*lister.limit.lock().unwrap(), Some(5));
    let data = response.data.into_json().unwrap();
    assert_eq!(data["soup"]["hasMore"], false);
    assert_eq!(data["soup"]["items"], serde_json::json!([]));
    assert_eq!(data["soup"]["summary"], "No items found in workspace.");
}

#[test]
fn description_examples_are_single_queries() {
    let examples = include_str!("../../description/examples.graphql");
    for block in examples.split("\nquery ").skip(1) {
        let query = format!("query {block}");
        // The catch-me-up example aliases two soup fields; that is still one operation.
        ReadQuery::parse(&query, None)
            .unwrap_or_else(|error| panic!("example failed to parse: {error}\n{query}"));
    }
}
