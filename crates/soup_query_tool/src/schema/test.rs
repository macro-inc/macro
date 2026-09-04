use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use apollo_compiler::schema::ExtendedType;
use soup::domain::agent_listing::{AgentListingError, AgentListingPage, AgentListingRequest};

use crate::ReadQuery;
use crate::listing::SoupLister;
use crate::schema::slices::{
    Topic, all_type_names, card_sdl, card_type_names, topic_sdl, topic_type_names,
};
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

#[test]
fn soup_input_is_optional_without_a_null_default() {
    let sdl = compact_sdl();
    assert!(
        sdl.contains("soup(input: SoupQueryInput): SoupQueryPage!"),
        "{sdl}"
    );
    assert!(!sdl.contains("entityTypes: null"), "{sdl}");
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

/// Fields the tool adds to upstream output types on purpose: resolved tag
/// labels, which the web schema exposes only as raw property options.
const TOOL_ONLY_FIELDS: [&str; 1] = ["tags"];

/// Field-by-field: every `Graphql*` type the tool declares must exist upstream
/// with the same kind, and each of its fields must exist upstream with the same
/// type. The tool may omit upstream fields; it may not invent or retype them
/// beyond [`TOOL_ONLY_FIELDS`].
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
        let Some(upstream) = full.types.get(name) else {
            panic!("tool type {name} is missing from static_assets/schema.graphql");
        };
        match (def, upstream) {
            (ExtendedType::Object(ours), ExtendedType::Object(theirs)) => {
                for (field, ours) in ours.fields.iter() {
                    if TOOL_ONLY_FIELDS.contains(&field.as_str()) {
                        continue;
                    }
                    let theirs = theirs
                        .fields
                        .get(field)
                        .unwrap_or_else(|| panic!("{name}.{field} does not exist upstream"));
                    assert_eq!(
                        ours.ty.to_string(),
                        theirs.ty.to_string(),
                        "{name}.{field} type differs from upstream"
                    );
                }
            }
            (ExtendedType::InputObject(ours), ExtendedType::InputObject(theirs)) => {
                for (field, ours) in ours.fields.iter() {
                    let theirs = theirs
                        .fields
                        .get(field)
                        .unwrap_or_else(|| panic!("{name}.{field} does not exist upstream"));
                    assert_eq!(
                        ours.ty.to_string(),
                        theirs.ty.to_string(),
                        "{name}.{field} type differs from upstream"
                    );
                }
            }
            (ExtendedType::Enum(ours), ExtendedType::Enum(theirs)) => {
                for value in ours.values.keys() {
                    assert!(
                        theirs.values.contains_key(value),
                        "{name}.{value} does not exist upstream"
                    );
                }
            }
            (ExtendedType::Union(ours), ExtendedType::Union(theirs)) => {
                for member in ours.members.iter() {
                    assert!(
                        theirs.members.contains(member),
                        "{name} member {member} does not exist upstream"
                    );
                }
            }
            (ExtendedType::Scalar(_), ExtendedType::Scalar(_))
            | (ExtendedType::Interface(_), ExtendedType::Interface(_)) => {}
            (ours, theirs) => panic!(
                "{name} changed kind relative to the authoritative schema: {ours:?} vs {theirs:?}"
            ),
        }
    }
}

/// The card plus every topic slice is exactly the schema; no type is lost and
/// no slice repeats a card type.
#[test]
fn card_and_slices_cover_the_schema_once() {
    let card = card_type_names();
    let mut covered: HashSet<String> = card.clone();
    eprintln!("card: {} chars", card_sdl().len());
    for topic in Topic::all() {
        let slice = topic_type_names(topic);
        eprintln!("{topic:?}: {} chars", topic_sdl(topic).len());
        assert!(!slice.is_empty(), "{topic:?} slice is empty");
        let overlap: Vec<_> = slice.intersection(&card).collect();
        assert!(
            overlap.is_empty(),
            "{topic:?} repeats card types {overlap:?}"
        );
        covered.extend(slice);
    }
    let all = all_type_names();
    let missing: Vec<_> = all.difference(&covered).collect();
    assert!(missing.is_empty(), "types in no slice: {missing:?}");
    let extra: Vec<_> = covered.difference(&all).collect();
    assert!(extra.is_empty(), "slices name unknown types: {extra:?}");
}

#[test]
fn card_carries_the_root_shape_and_no_kind_literals() {
    let card = card_sdl();
    for expected in [
        "type Query",
        "input SoupQueryInput",
        "enum GraphqlSoupEntityType",
        "input TaskFilter",
        "interface SoupEntity",
        "type SoupQueryPage",
        "input GraphqlEntityFilterAst",
        "input GraphqlDateLiteral",
    ] {
        assert!(card.contains(expected), "card lacks {expected}\n{card}");
    }
    for slice_only in [
        "input GraphqlDocumentLiteral",
        "input GraphqlEmailLiteral",
        "type GraphqlSoupDocument ",
        "union GraphqlPropertyValue",
    ] {
        assert!(!card.contains(slice_only), "card leaks {slice_only}");
    }
    assert!(
        card.len() < 7_000,
        "card grew to {} chars; keep it a deliberate act",
        card.len()
    );
}

#[test]
fn document_slice_has_its_literal_and_output() {
    let sdl = topic_sdl(Topic::Kind(crate::schema::input::SoupKind::Document));
    assert!(sdl.contains("input GraphqlDocumentLiteral"), "{sdl}");
    assert!(
        sdl.contains("type GraphqlSoupDocument implements SoupEntity"),
        "{sdl}"
    );
    assert!(sdl.contains("union GraphqlSoupDocumentSubType"), "{sdl}");
    assert!(!sdl.contains("type GraphqlProperty "), "{sdl}");
    assert!(!sdl.contains("input GraphqlDateLiteral"), "{sdl}");
}

struct EmptyLister {
    limit: std::sync::Mutex<Option<u16>>,
}

#[async_trait::async_trait]
impl SoupLister for EmptyLister {
    async fn list(
        &self,
        request: AgentListingRequest,
    ) -> Result<AgentListingPage, AgentListingError> {
        *self.limit.lock().unwrap() = Some(request.limit.get());
        Ok(AgentListingPage {
            items: Vec::new(),
            has_more: false,
            tag_labels: HashMap::new(),
        })
    }
}

fn empty_lister() -> Arc<EmptyLister> {
    Arc::new(EmptyLister {
        limit: std::sync::Mutex::new(None),
    })
}

#[tokio::test]
async fn execute_returns_a_graphql_page() {
    let read = ReadQuery::parse(
        "{ soup(input: { limit: 5 }) { items { id } hasMore summary } }",
        None,
    )
    .unwrap();
    let lister = empty_lister();
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

#[tokio::test]
async fn omitted_input_lists_with_defaults() {
    let read = ReadQuery::parse("{ soup { items { id } } }", None).unwrap();
    let lister = empty_lister();
    let response = SCHEMA
        .execute(
            read.into_request()
                .data(Arc::clone(&lister) as Arc<dyn SoupLister>),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(*lister.limit.lock().unwrap(), Some(50));
}

#[tokio::test]
async fn out_of_range_limit_is_a_friendly_error() {
    for limit in ["0", "501", "70000"] {
        let query = format!("{{ soup(input: {{ limit: {limit} }}) {{ items {{ id }} }} }}");
        let response = SCHEMA
            .execute(
                ReadQuery::parse(&query, None)
                    .unwrap()
                    .into_request()
                    .data(empty_lister() as Arc<dyn SoupLister>),
            )
            .await;
        let message = crate::tool::describe_errors(&response.errors);
        assert!(
            message.contains("limit must be between 1 and 500"),
            "limit {limit}: {message}"
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
