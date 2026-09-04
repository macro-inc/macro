use crate::ReadQuery;
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
    assert!(!sdl.contains("type Mutation"));
    assert!(!sdl.contains("deleteEntitiesPermanently"));
    assert!(!sdl.contains("CRM_COMPANY"));
    assert!(!sdl.contains("REMINDER"));
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
