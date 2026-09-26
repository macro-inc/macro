//! Reproduces the frontend's first-tag flow: an entity gains a property it
//! never carried, so the client fabricates the property record under a
//! temporary id and links it into the entity's `properties` with a
//! record-rooted patch. Every cached Soup page referencing the entity must
//! show it while the mutation is queued.
//!
//! Settlement mirrors the alias-id design: the server response carries the
//! assignment under its real id plus the entity's authoritative `properties`,
//! so the re-applied patch finds no temporary record and is skipped. Stacked
//! queued tags must stay readable when an earlier one settles.

use cache_core::engine::{BeginOptimisticWrite, Engine, OptimisticTransactionId, ReadResult};
use cache_core::link_patch::{LinkOperation, OptimisticLinkPatch, RecordLinkPatch};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
use pollster::block_on;
use serde_json::{Value as Json, json};

const PAGE_QUERY: &str = r#"
query SoupProperties($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        __typename
        id
        properties { __typename id propertyDefinitionId }
      }
      nextCursor
    }
  }
}
"#;

const MUTATION: &str = r#"
mutation ApplyEntityPropertyOptionDeltas($input: UpdateEntityPropertyOptionsInput!) {
  applyEntityPropertyOptionDeltas(input: $input) {
    properties { __typename id propertyDefinitionId }
    effects {
      __typename
      ... on SoupUpdated {
        item {
          __typename
          id
          properties { __typename id propertyDefinitionId }
        }
      }
    }
  }
}
"#;

fn object(value: Json) -> serde_json::Map<String, Json> {
    let Json::Object(map) = value else {
        unreachable!()
    };
    map
}

fn page_variables(limit: u64) -> serde_json::Map<String, Json> {
    object(json!({ "input": { "limit": limit } }))
}

fn mutation_variables(definition: &str) -> serde_json::Map<String, Json> {
    object(json!({
        "input": {
            "entityType": "DOCUMENT",
            "entityId": "doc-1",
            "properties": [{
                "propertyDefinitionId": definition,
                "addOptionIds": ["spotlight"],
                "removeOptionIds": []
            }]
        }
    }))
}

fn property(id: &str, definition: &str) -> Json {
    json!({
        "__typename": "GraphqlProperty",
        "id": id,
        "propertyDefinitionId": definition
    })
}

fn page() -> Json {
    json!({
        "user": {
            "id": "user-1",
            "soup": {
                "items": [{
                    "__typename": "GraphqlSoupDocument",
                    "id": "doc-1",
                    "properties": [property("assignment-1", "status-def")]
                }],
                "nextCursor": null
            }
        }
    })
}

/// Optimistic payload for a first tag: the fabricated record, no effects.
fn optimistic_response(temporary_id: &str, definition: &str) -> Json {
    json!({
        "applyEntityPropertyOptionDeltas": {
            "properties": [property(temporary_id, definition)],
            "effects": []
        }
    })
}

/// Server payload: the real assignment plus the entity's settled list.
fn server_response(created: Json, settled: Vec<Json>) -> Json {
    json!({
        "applyEntityPropertyOptionDeltas": {
            "properties": [created],
            "effects": [{
                "__typename": "SoupUpdated",
                "item": {
                    "__typename": "GraphqlSoupDocument",
                    "id": "doc-1",
                    "properties": settled
                }
            }]
        }
    })
}

fn link_patch(temporary_id: &str) -> OptimisticLinkPatch {
    RecordLinkPatch {
        record_key: EntityKey("GraphqlSoupDocument:doc-1".into()),
        field: "properties".into(),
        operation: LinkOperation::PrependUnique {
            entity_key: EntityKey(format!("GraphqlProperty:{temporary_id}").into()),
        },
    }
    .into()
}

async fn write_pages(engine: &mut Engine<InMemoryStorage>) {
    for limit in [10, 20] {
        engine
            .write_query(
                None,
                PAGE_QUERY,
                Some("SoupProperties"),
                &page_variables(limit),
                &page(),
                None,
            )
            .await
            .unwrap();
    }
}

async fn enqueue_first_tag(
    engine: &mut Engine<InMemoryStorage>,
    uuid: &str,
    temporary_id: &str,
    definition: &str,
) -> OptimisticTransactionId {
    let patches = [link_patch(temporary_id)];
    let (transaction, _) = engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                uuid,
                query: MUTATION,
                operation_name: Some("ApplyEntityPropertyOptionDeltas"),
                variables: &mutation_variables(definition),
                data: &optimistic_response(temporary_id, definition),
                link_patches: &patches,
                revalidations: &[],
                created_at_ms: 0,
            },
        )
        .await
        .expect("first-tag write must enqueue with its record patch");
    transaction
}

async fn commit_head(
    engine: &mut Engine<InMemoryStorage>,
    transaction: OptimisticTransactionId,
    definition: &str,
    response: &Json,
) {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "runner".into(),
            now_ms: 10,
            lease_expires_at_ms: 1_010,
        })
        .await
        .unwrap()
        .expect("queue head");
    engine
        .commit_optimistic_write(
            transaction,
            MutationClaimToken {
                owner: "runner".into(),
                generation: claimed.lease_generation,
            },
            MUTATION,
            Some("ApplyEntityPropertyOptionDeltas"),
            &mutation_variables(definition),
            response,
        )
        .await
        .unwrap();
}

/// Property ids on `doc-1` as read through each cached page.
async fn page_property_ids(engine: &mut Engine<InMemoryStorage>) -> Vec<Vec<String>> {
    let mut pages = Vec::new();
    for limit in [10, 20] {
        let ReadResult::Hit { data } = engine
            .read_query(
                None,
                PAGE_QUERY,
                Some("SoupProperties"),
                &page_variables(limit),
            )
            .await
            .unwrap()
        else {
            panic!("page {limit} must stay a cache hit");
        };
        pages.push(
            data["user"]["soup"]["items"][0]["properties"]
                .as_array()
                .unwrap()
                .iter()
                .map(|property| property["id"].as_str().unwrap().to_string())
                .collect(),
        );
    }
    pages
}

fn ids(values: &[&str]) -> Vec<Vec<String>> {
    let page: Vec<String> = values.iter().map(|value| value.to_string()).collect();
    vec![page.clone(), page]
}

#[test]
fn queued_first_tag_links_into_every_page_and_settles_to_the_server_list() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write_pages(&mut engine).await;

        let transaction = enqueue_first_tag(
            &mut engine,
            "22222222-2222-4222-8222-222222222201",
            "temp-a",
            "tag-def",
        )
        .await;
        assert_eq!(
            page_property_ids(&mut engine).await,
            ids(&["temp-a", "assignment-1"])
        );

        commit_head(
            &mut engine,
            transaction,
            "tag-def",
            &server_response(
                property("assignment-2", "tag-def"),
                vec![
                    property("assignment-1", "status-def"),
                    property("assignment-2", "tag-def"),
                ],
            ),
        )
        .await;
        assert_eq!(
            page_property_ids(&mut engine).await,
            ids(&["assignment-1", "assignment-2"]),
            "the temporary record's patch must be skipped at settlement"
        );
    });
}

#[test]
fn stacked_first_tags_stay_readable_when_the_earlier_one_settles() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write_pages(&mut engine).await;

        let first = enqueue_first_tag(
            &mut engine,
            "22222222-2222-4222-8222-222222222202",
            "temp-a",
            "tag-def",
        )
        .await;
        let second = enqueue_first_tag(
            &mut engine,
            "22222222-2222-4222-8222-222222222203",
            "temp-b",
            "label-def",
        )
        .await;
        assert_eq!(
            page_property_ids(&mut engine).await,
            ids(&["temp-b", "temp-a", "assignment-1"])
        );

        // The second layer's recipe is rebuilt against the settled base, so
        // the first tag's discarded temporary record is never referenced.
        commit_head(
            &mut engine,
            first,
            "tag-def",
            &server_response(
                property("assignment-2", "tag-def"),
                vec![
                    property("assignment-1", "status-def"),
                    property("assignment-2", "tag-def"),
                ],
            ),
        )
        .await;
        assert_eq!(
            page_property_ids(&mut engine).await,
            ids(&["temp-b", "assignment-1", "assignment-2"])
        );

        commit_head(
            &mut engine,
            second,
            "label-def",
            &server_response(
                property("assignment-3", "label-def"),
                vec![
                    property("assignment-1", "status-def"),
                    property("assignment-2", "tag-def"),
                    property("assignment-3", "label-def"),
                ],
            ),
        )
        .await;
        assert_eq!(
            page_property_ids(&mut engine).await,
            ids(&["assignment-1", "assignment-2", "assignment-3"])
        );
    });
}

#[test]
fn first_tag_on_an_uncached_entity_enqueues_without_a_link() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        // No page holds `doc-1`: the strict new tail must still accept the
        // record patch, which has nothing cached to update.
        enqueue_first_tag(
            &mut engine,
            "22222222-2222-4222-8222-222222222204",
            "temp-a",
            "tag-def",
        )
        .await;
    });
}
