//! The shipped archive document updates the same normalized email across views,
//! composes with offline Undo, and settles without overwriting newer intent.

use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken, MutationId};
use cache_core::store::InMemoryStorage;
use pollster::block_on;
use serde_json::{Map, Value, json};

const MUTATION: &str = include_str!(
    "../../../../apps/web/src/lib/service-clients/service-storage/graphql/email-archive-state.graphql"
);
const QUERY: &str = r#"query Mail($input: SoupInput!) {
  user { id soup(input: $input) { items {
    __typename id ... on GraphqlSoupEmailThread { inboxVisible isRead }
  } nextCursor } }
}"#;

fn variables(archived: bool) -> Map<String, Value> {
    json!({"input": {"threadId": "thread", "archived": archived}})
        .as_object()
        .unwrap()
        .clone()
}
fn response(archived: bool) -> Value {
    json!({"setEmailThreadArchived": {"__typename": "GraphqlSoupEmailThread", "id": "thread", "inboxVisible": !archived}})
}
fn list_variables(view: &str) -> Map<String, Value> {
    json!({"input": {"initial": {"emailView": view, "limit": 100}}})
        .as_object()
        .unwrap()
        .clone()
}
async fn seed() -> Engine<InMemoryStorage> {
    let mut engine = Engine::new(InMemoryStorage::new());
    for view in ["INBOX", "ALL"] {
        engine.write_query(None, QUERY, Some("Mail"), &list_variables(view), &json!({
            "user": {"id": "viewer", "soup": {"items": [{
                "__typename": "GraphqlSoupEmailThread", "id": "thread", "inboxVisible": true, "isRead": false,
            }], "nextCursor": null}},
        }), None).await.unwrap();
    }
    engine
}
async fn enqueue(
    engine: &mut Engine<InMemoryStorage>,
    uuid: &str,
    archived: bool,
    now: i64,
) -> MutationId {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                uuid,
                query: MUTATION,
                operation_name: Some("SetEmailThreadArchived"),
                variables: &variables(archived),
                data: &response(archived),
                link_patches: &[],
                revalidations: &[],
                created_at_ms: now,
            },
        )
        .await
        .unwrap()
        .0
}
async fn assert_state(engine: &mut Engine<InMemoryStorage>, visible: bool) {
    for view in ["INBOX", "ALL"] {
        let ReadResult::Hit { data } = engine
            .read_query(None, QUERY, Some("Mail"), &list_variables(view))
            .await
            .unwrap()
        else {
            panic!("archive must preserve a readable cached page");
        };
        assert_eq!(data["user"]["soup"]["items"][0]["inboxVisible"], visible);
        assert_eq!(
            data["user"]["soup"]["items"][0]["isRead"], false,
            "archive must not change read state"
        );
    }
}
async fn claim(engine: &mut Engine<InMemoryStorage>) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: 10,
            lease_expires_at_ms: 1010,
        })
        .await
        .unwrap()
        .unwrap();
    MutationClaimToken {
        owner: "test".into(),
        generation: claimed.lease_generation,
    }
}

#[test]
fn queued_archive_and_undo_survive_reload_and_keep_the_latest_intent_during_commit() {
    block_on(async {
        let mut engine = seed().await;
        let archive = enqueue(&mut engine, "11111111-1111-4111-8111-111111111111", true, 0).await;
        assert_state(&mut engine, false).await;
        let undo = enqueue(
            &mut engine,
            "22222222-2222-4222-8222-222222222222",
            false,
            1,
        )
        .await;
        assert_state(&mut engine, true).await;
        let mut engine = Engine::new(engine.into_storage());
        assert_state(&mut engine, true).await;
        let token = claim(&mut engine).await;
        engine
            .commit_optimistic_write(
                archive,
                token,
                MUTATION,
                Some("SetEmailThreadArchived"),
                &variables(true),
                &response(true),
            )
            .await
            .unwrap();
        assert_state(&mut engine, true).await;
        let token = claim(&mut engine).await;
        engine
            .commit_optimistic_write(
                undo,
                token,
                MUTATION,
                Some("SetEmailThreadArchived"),
                &variables(false),
                &response(false),
            )
            .await
            .unwrap();
        assert_state(&mut engine, true).await;
    });
}

#[test]
fn rejected_archive_rolls_back_without_changing_other_email_fields() {
    block_on(async {
        let mut engine = seed().await;
        let archive = enqueue(&mut engine, "11111111-1111-4111-8111-111111111111", true, 0).await;
        assert_state(&mut engine, false).await;
        let token = claim(&mut engine).await;
        engine
            .rollback_optimistic_write(archive, token)
            .await
            .unwrap();
        assert_state(&mut engine, true).await;
    });
}
