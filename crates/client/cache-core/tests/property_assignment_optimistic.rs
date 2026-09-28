//! First assignments remain linked across enqueue, replay, settlement and rollback.

use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult};
use cache_core::link_patch::{
    LinkOperation, LinkPathSegment, ListItemByScalar, OptimisticLinkPatch,
};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
use pollster::block_on;
use serde_json::{Value as Json, json};

const QUERY: &str = r#"
query Properties($input: SoupInput!) {
  user { id soup(input: $input) { items { __typename id properties {
    id definition: propertyDefinitionId value {
      __typename ... on GraphqlSelectOptionPropertyValue { optionIds }
    }
  } } } }
}"#;
const MUTATION: &str = r#"
mutation Set($input: SetEntityPropertyInput!) {
  setEntityProperty(input: $input) { id propertyDefinitionId value {
    __typename ... on GraphqlSelectOptionPropertyValue { optionIds }
  } }
}"#;
const UUID: &str = "1697e6bc-0d9a-4dd2-bc3f-bd33bcb6f607";

fn variables() -> serde_json::Map<String, Json> {
    json!({"input":{}}).as_object().unwrap().clone()
}
fn response(id: &str, value: &str) -> Json {
    json!({"setEntityProperty": {"id":id, "propertyDefinitionId":"priority",
        "value":{"__typename":"GraphqlSelectOptionPropertyValue","optionIds":[value]}}})
}
fn patch() -> OptimisticLinkPatch {
    OptimisticLinkPatch {
        query: QUERY.into(),
        operation_name: Some("Properties".into()),
        variables_json: serde_json::to_string(&variables()).unwrap(),
        path: vec![
            LinkPathSegment::Field {
                field: "user".into(),
            },
            LinkPathSegment::Field {
                field: "soup".into(),
            },
            LinkPathSegment::Field {
                field: "items".into(),
            },
            LinkPathSegment::ListItem {
                list_item: ListItemByScalar {
                    where_field: "id".into(),
                    equals: json!("task-1"),
                },
            },
            LinkPathSegment::Field {
                field: "properties".into(),
            },
        ],
        operation: LinkOperation::UpsertByField {
            entity_key: EntityKey("GraphqlProperty:temporary-1".into()),
            where_field: "definition".into(),
            equals: json!("priority"),
        },
    }
}
async fn seeded() -> Engine<InMemoryStorage> {
    let mut engine = Engine::new(InMemoryStorage::new());
    engine
        .write_query(
            None,
            QUERY,
            Some("Properties"),
            &variables(),
            &json!({"user":{
                "id":"user-1", "soup":{"items":[
                    {"__typename":"GraphqlSoupDocument","id":"task-1","properties":[]},
                    {"__typename":"GraphqlSoupDocument","id":"task-2","properties":[]}
                ]}
            }}),
            None,
        )
        .await
        .unwrap();
    engine
}
async fn read(engine: &mut Engine<InMemoryStorage>) -> Json {
    let ReadResult::Hit { data, .. } = engine
        .read_query(Some(1), QUERY, Some("Properties"), &variables())
        .await
        .unwrap()
    else {
        panic!("properties must remain readable");
    };
    data
}
async fn enqueue(engine: &mut Engine<InMemoryStorage>, value: &str, now: i64) -> u64 {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                identity_bindings: &[],
                uuid: UUID,
                query: MUTATION,
                operation_name: Some("Set"),
                variables: &variables(),
                data: &response("temporary-1", value),
                link_patches: &[patch()],
                revalidations: &[],
                created_at_ms: now,
            },
        )
        .await
        .unwrap()
        .0
}
async fn claim(engine: &mut Engine<InMemoryStorage>, now: i64) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: now,
            lease_expires_at_ms: now + 100,
        })
        .await
        .unwrap()
        .unwrap();
    MutationClaimToken {
        owner: "test".into(),
        generation: claimed.lease_generation,
    }
}
fn properties(data: &Json) -> &Json {
    &data["user"]["soup"]["items"][0]["properties"]
}

#[test]
fn new_assignment_is_visible_before_response_and_reconciles_server_identity() {
    block_on(async {
        let mut engine = seeded().await;
        read(&mut engine).await;
        let txn = enqueue(&mut engine, "urgent", 1).await;
        let data = read(&mut engine).await;
        assert_eq!(
            properties(&data)[0]["value"]["optionIds"],
            json!(["urgent"])
        );
        assert_eq!(data["user"]["soup"]["items"][1]["properties"], json!([]));
        let mut engine = Engine::new(engine.storage().clone());
        assert_eq!(properties(&read(&mut engine).await)[0]["id"], "temporary-1");
        let claim = claim(&mut engine, 2).await;
        engine
            .commit_optimistic_write(
                txn,
                claim,
                MUTATION,
                Some("Set"),
                &variables(),
                &response("server-1", "urgent"),
            )
            .await
            .unwrap();
        let data = read(&mut engine).await;
        assert_eq!(properties(&data).as_array().unwrap().len(), 1);
        assert_eq!(properties(&data)[0]["id"], "server-1");
        assert_eq!(
            properties(&data)[0]["value"]["optionIds"],
            json!(["urgent"])
        );
        let mut reopened = Engine::new(engine.storage().clone());
        assert_eq!(read(&mut reopened).await, data);
    });
}

#[test]
fn failure_removes_the_temporary_link() {
    block_on(async {
        let mut engine = seeded().await;
        let txn = enqueue(&mut engine, "urgent", 1).await;
        let claim = claim(&mut engine, 2).await;
        engine.rollback_optimistic_write(txn, claim).await.unwrap();
        assert_eq!(properties(&read(&mut engine).await), &json!([]));
    });
}

#[test]
fn later_edit_rebases_over_new_server_id_without_duplicate_properties() {
    block_on(async {
        let mut engine = seeded().await;
        let first = enqueue(&mut engine, "urgent", 1).await;
        let first_claim = claim(&mut engine, 2).await;
        let second = enqueue(&mut engine, "low", 3).await;
        engine
            .commit_optimistic_write(
                first,
                first_claim,
                MUTATION,
                Some("Set"),
                &variables(),
                &response("server-1", "urgent"),
            )
            .await
            .unwrap();
        let data = read(&mut engine).await;
        assert_eq!(properties(&data).as_array().unwrap().len(), 1);
        assert_eq!(properties(&data)[0]["value"]["optionIds"], json!(["low"]));
        let second_claim = claim(&mut engine, 4).await;
        engine
            .commit_optimistic_write(
                second,
                second_claim,
                MUTATION,
                Some("Set"),
                &variables(),
                &response("server-1", "low"),
            )
            .await
            .unwrap();
        let data = read(&mut engine).await;
        assert_eq!(properties(&data).as_array().unwrap().len(), 1);
        assert_eq!(properties(&data)[0]["id"], "server-1");
        assert_eq!(properties(&data)[0]["value"]["optionIds"], json!(["low"]));
    });
}
