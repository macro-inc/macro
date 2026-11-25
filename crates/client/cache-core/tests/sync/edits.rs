//! A page the server read before an edit, applied after the edit's
//! confirmation, keeps the edited records as the edit left them.

use super::*;
use cache_core::engine::BeginOptimisticWrite;
use cache_core::queue::{MutationClaimRequest, MutationClaimToken, MutationId};
use cache_core::value::CacheValue;

const MAIL: &str = "query SoupMailBackfill($input: SoupInput!) { user { id soup(input: $input) { items { __typename id ... on GraphqlSoupEmailThread { inboxVisible isRead } } nextCursor } } }";
const ARCHIVE: &str = include_str!(
    "../../../../../apps/web/src/lib/service-clients/service-storage/graphql/email-archive-state.graphql"
);

fn mail_plan() -> Plan {
    args(vec![lane(
        "email-older",
        MAIL,
        "soup",
        json!({"kind": "hydrate"}),
    )])
}

fn thread_key(n: u128) -> EntityKey<'static> {
    EntityKey::entity("GraphqlSoupEmailThread", &[&id(n)])
}

/// A page of threads, each in the inbox and unread, as the server read them.
fn mail_page(page: u64, ids: &[u128]) -> Json {
    let items = ids
        .iter()
        .map(|n| {
            json!({
                "__typename": "GraphqlSoupEmailThread",
                "id": id(*n),
                "inboxVisible": true,
                "isRead": false,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "type": "page",
        "lane": "email-older",
        "page": page,
        "variables": {"input": {"initial": {"limit": 500}}},
        "response": {"data": {"user": {"id": "viewer", "soup": {"items": items, "nextCursor": null}}}},
        "items": ids.len(),
        "resume": null,
    })
}

fn archive_variables(n: u128) -> serde_json::Map<String, Json> {
    json!({"input": {"threadId": id(n), "archived": true}})
        .as_object()
        .unwrap()
        .clone()
}

fn archived(n: u128) -> Json {
    json!({"setEmailThreadArchived": {"__typename": "GraphqlSoupEmailThread", "id": id(n), "inboxVisible": false}})
}

/// Marks thread `n` done: an optimistic archive, still pending.
async fn mark_done(engine: &mut Engine<InMemoryStorage>, n: u128, uuid: &str) -> MutationId {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                identity_bindings: &[],
                uuid,
                query: ARCHIVE,
                operation_name: Some("SetEmailThreadArchived"),
                variables: &archive_variables(n),
                data: &archived(n),
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 0,
            },
        )
        .await
        .unwrap()
        .0
}

/// The server confirms the pending archive of thread `n`.
async fn confirm(engine: &mut Engine<InMemoryStorage>, mutation: MutationId, n: u128) {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: 10,
            lease_expires_at_ms: 1010,
        })
        .await
        .unwrap()
        .unwrap();
    engine
        .commit_optimistic_write(
            mutation,
            MutationClaimToken {
                owner: "test".into(),
                generation: claimed.lease_generation,
            },
            ARCHIVE,
            Some("SetEmailThreadArchived"),
            &archive_variables(n),
            &archived(n),
        )
        .await
        .unwrap();
}

/// What the cache holds as thread `n`'s `inboxVisible`.
async fn in_inbox(engine: &Engine<InMemoryStorage>, n: u128) -> Option<bool> {
    let record = engine
        .storage()
        .get_batch(&[thread_key(n)])
        .await
        .unwrap()
        .remove(0)?;
    match record.fields.get("inboxVisible") {
        Some(CacheValue::Bool(visible)) => Some(*visible),
        _ => None,
    }
}

/// Seeds threads 1 and 2 in the inbox through a run of their own.
async fn seeded() -> Engine<InMemoryStorage> {
    let mut engine = Engine::new(InMemoryStorage::new());
    let mut run = start(&mut engine, &mail_plan()).await;
    run_stream(&mut engine, &mut run, &ndjson(&[mail_page(0, &[1, 2])]))
        .await
        .unwrap();
    engine
}

#[test]
fn a_page_read_before_a_confirmed_edit_leaves_the_edited_thread_as_the_edit_left_it() {
    block_on(async {
        let mut engine = seeded().await;
        let mut run = start(&mut engine, &mail_plan()).await;
        // The user marks thread 1 done while the server reads the page.
        let done = mark_done(&mut engine, 1, "11111111-1111-4111-8111-111111111111").await;
        confirm(&mut engine, done, 1).await;
        assert_eq!(in_inbox(&engine, 1).await, Some(false));

        let applied = run_stream(
            &mut engine,
            &mut run,
            &ndjson(&[mail_page(0, &[1, 2]), lane_done("email-older", 1, 2)]),
        )
        .await
        .unwrap();

        assert!(matches!(
            applied.first(),
            Some(SyncApplied::Hydrated { .. })
        ));
        assert_eq!(in_inbox(&engine, 1).await, Some(false));
        assert_eq!(in_inbox(&engine, 2).await, Some(true));
        // The page still counts, and the thread is still the lane's member.
        let state = engine.sync_lane_states().await.unwrap();
        assert!(state[0].completed_at.is_some());
    });
}

#[test]
fn a_page_applied_while_an_edit_is_pending_does_not_undo_an_earlier_confirmed_one() {
    block_on(async {
        let mut engine = seeded().await;
        let mut run = start(&mut engine, &mail_plan()).await;
        let first = mark_done(&mut engine, 1, "11111111-1111-4111-8111-111111111111").await;
        confirm(&mut engine, first, 1).await;
        // Thread 2's edit is still on its way: the page takes the general write.
        mark_done(&mut engine, 2, "22222222-2222-4222-8222-222222222222").await;

        run_stream(&mut engine, &mut run, &ndjson(&[mail_page(0, &[1, 2])]))
            .await
            .unwrap();

        assert_eq!(in_inbox(&engine, 1).await, Some(false));
    });
}

#[test]
fn a_run_begun_after_a_confirmed_edit_writes_what_the_server_read() {
    block_on(async {
        let mut engine = seeded().await;
        let done = mark_done(&mut engine, 1, "11111111-1111-4111-8111-111111111111").await;
        confirm(&mut engine, done, 1).await;
        // The thread came back to the inbox afterwards (new mail, or done on
        // another device), and this run read it so.
        let mut run = start(&mut engine, &mail_plan()).await;
        run_stream(&mut engine, &mut run, &ndjson(&[mail_page(0, &[1])]))
            .await
            .unwrap();

        assert_eq!(in_inbox(&engine, 1).await, Some(true));
    });
}

#[test]
fn records_the_host_invalidates_keep_their_state_against_the_run_begun_before() {
    block_on(async {
        let mut engine = seeded().await;
        let mut run = start(&mut engine, &mail_plan()).await;
        // The host moved thread 1 to Trash through REST, read it back, and
        // invalidated it.
        engine
            .write_query(
                None,
                MAIL,
                Some("SoupMailBackfill"),
                &json!({"input": {"initial": {"limit": 1}}})
                    .as_object()
                    .unwrap()
                    .clone(),
                &json!({"user": {"id": "viewer", "soup": {"items": [{
                    "__typename": "GraphqlSoupEmailThread", "id": id(1),
                    "inboxVisible": false, "isRead": false,
                }], "nextCursor": null}}}),
                None,
            )
            .await
            .unwrap();
        engine.invalidate_keys([&thread_key(1)]).unwrap();

        run_stream(
            &mut engine,
            &mut run,
            &ndjson(&[mail_page(0, &[1, 2]), lane_done("email-older", 1, 2)]),
        )
        .await
        .unwrap();
        assert_eq!(in_inbox(&engine, 1).await, Some(false));

        // The next run reads after the edit.
        let mut next = start(&mut engine, &mail_plan()).await;
        run_stream(&mut engine, &mut next, &ndjson(&[mail_page(0, &[1])]))
            .await
            .unwrap();
        assert_eq!(in_inbox(&engine, 1).await, Some(true));
    });
}

#[test]
fn records_a_rest_edit_fences_keep_their_state_against_the_run_begun_before() {
    block_on(async {
        let mut engine = seeded().await;
        let mut run = start(&mut engine, &mail_plan()).await;
        engine
            .write_query(
                None,
                MAIL,
                Some("SoupMailBackfill"),
                &json!({"input": {"initial": {"limit": 1}}})
                    .as_object()
                    .unwrap()
                    .clone(),
                &json!({"user": {"id": "viewer", "soup": {"items": [{
                    "__typename": "GraphqlSoupEmailThread", "id": id(1),
                    "inboxVisible": false, "isRead": false,
                }], "nextCursor": null}}}),
                None,
            )
            .await
            .unwrap();
        engine.fence_sync_records([&thread_key(1)]);

        run_stream(&mut engine, &mut run, &ndjson(&[mail_page(0, &[1, 2])]))
            .await
            .unwrap();
        assert_eq!(in_inbox(&engine, 1).await, Some(false));
    });
}

#[test]
fn an_edit_with_no_run_in_progress_fences_nothing() {
    block_on(async {
        let mut engine = seeded().await;
        // No run exists: the fence keeps nothing for a later run to skip.
        engine.fence_sync_records([&thread_key(1)]);
        let mut run = start(&mut engine, &mail_plan()).await;
        run_stream(&mut engine, &mut run, &ndjson(&[mail_page(0, &[1])]))
            .await
            .unwrap();

        assert_eq!(in_inbox(&engine, 1).await, Some(true));
    });
}
