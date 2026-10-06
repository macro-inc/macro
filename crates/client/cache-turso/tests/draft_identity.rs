#![cfg(not(target_arch = "wasm32"))]

use cache_core::engine::{BeginOptimisticWrite, DeferOptimisticWriteResult, Engine};
use cache_core::identity::IdentityBinding;
use cache_core::link_patch::QueryRevalidation;
use cache_core::queue::{MutationClaimRequest, MutationClaimToken, MutationId};
use cache_core::record_selection::RecordSelection;
use cache_core::value::EntityKey;
use cache_turso::{TursoFileDatabase, TursoStorage, TursoStorageCloseOutcome};
use pollster::block_on;
use serde_json::{Map, Value, json};

const UUID: &str = "00000000-0000-4000-8000-000000000071";
const SAVE: &str = "mutation SaveEmailDraft { saveEmailDraft { draft { __typename id threadId bodyHtmlSanitized } thread { __typename id mailAllPreview { id subject } messages(offset: 0, limit: 20) { __typename id threadId bodyHtmlSanitized } } } }";
const DELETE: &str = "mutation DeleteEmailDraft { deleteEmailDraft { deleted } }";
const PAGE: &str = "query EmailThreadPage($threadId: ID!) { user { emailThread(input: {threadId: $threadId}) { id } } }";

fn key(id: &str) -> EntityKey<'static> {
    EntityKey::entity("GraphqlSoupEmailMessage", &[id])
}

fn bindings(delete: bool) -> Vec<IdentityBinding> {
    vec![
        IdentityBinding {
            local_key: key("local-draft"),
            delete_record: delete,
            response_path: if delete {
                vec![]
            } else {
                vec!["saveEmailDraft".into(), "draft".into()]
            },
            reference_fields: vec!["GraphqlMailPreviewMessage.id".into()],
            revalidation_variables: vec![],
        },
        IdentityBinding {
            local_key: EntityKey::entity("GraphqlSoupEmailThread", &["local-thread"]),
            delete_record: false,
            response_path: if delete {
                vec![]
            } else {
                vec!["saveEmailDraft".into(), "thread".into()]
            },
            reference_fields: vec!["GraphqlSoupEmailMessage.threadId".into()],
            revalidation_variables: vec!["threadId".into()],
        },
    ]
}

fn response(draft: &str, thread: &str, body: &str) -> Value {
    let message = json!({"__typename":"GraphqlSoupEmailMessage", "id":draft, "threadId":thread, "bodyHtmlSanitized":body});
    json!({"saveEmailDraft":{"draft":message,"thread":{"__typename":"GraphqlSoupEmailThread","id":thread,"mailAllPreview":{"id":draft,"subject":body},"messages":[message]}}})
}

async fn enqueue(
    engine: &mut Engine<TursoStorage>,
    delete: bool,
    body: &str,
    now: i64,
) -> MutationId {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid: UUID,
                query: if delete { DELETE } else { SAVE },
                operation_name: Some(if delete {
                    "DeleteEmailDraft"
                } else {
                    "SaveEmailDraft"
                }),
                variables: &Map::new(),
                data: &if delete {
                    json!({"deleteEmailDraft":{"deleted":true}})
                } else {
                    response("local-draft", "local-thread", body)
                },
                link_patches: &[],
                revalidations: &[QueryRevalidation {
                    query: PAGE.into(),
                    operation_name: Some("EmailThreadPage".into()),
                    variables_json: json!({"threadId":"local-thread"}).to_string(),
                }],
                identity_bindings: &bindings(delete),
                created_at_ms: now,
            },
        )
        .await
        .unwrap()
        .0
}

async fn claim(
    engine: &mut Engine<TursoStorage>,
    expected: MutationId,
    now: i64,
) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "runner".into(),
            now_ms: now,
            lease_expires_at_ms: now + 10,
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.queued.id, expected);
    MutationClaimToken {
        owner: "runner".into(),
        generation: claimed.lease_generation,
    }
}

async fn read(
    engine: &mut Engine<TursoStorage>,
    id: &str,
) -> Vec<cache_core::record_selection::SelectedRecord> {
    let selection = RecordSelection::parse(
        "fragment Draft on GraphqlSoupEmailMessage { id threadId bodyHtmlSanitized }",
        "Draft",
    )
    .unwrap();
    engine
        .read_records_by_keys(&selection, &[key(id)])
        .await
        .unwrap()
        .value
}

async fn preview_visible(engine: &mut Engine<TursoStorage>) -> bool {
    let selection = RecordSelection::parse(
        "fragment Preview on GraphqlMailPreviewMessage { id subject }",
        "Preview",
    )
    .unwrap();
    !engine
        .read_records_by_keys(
            &selection,
            &[EntityKey::entity(
                "GraphqlMailPreviewMessage",
                &["server-draft"],
            )],
        )
        .await
        .unwrap()
        .value
        .is_empty()
}

fn reopen(engine: Engine<TursoStorage>, database: &TursoFileDatabase) -> Engine<TursoStorage> {
    assert_eq!(
        engine.into_storage().try_close().unwrap(),
        TursoStorageCloseOutcome::Healthy
    );
    Engine::new(database.open("draft-lifecycle").unwrap())
}

#[test]
fn disk_restart_rebases_newer_edits_and_preserves_uncertain_save_before_discard() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("draft.db")).unwrap();
        let mut engine = Engine::new(database.open("draft-lifecycle").unwrap());
        let first = enqueue(&mut engine, false, "first", 0).await;
        engine = reopen(engine, &database);
        let local = read(&mut engine, "local-draft").await;
        assert_eq!(local[0].record["bodyHtmlSanitized"], "first");
        assert!(local[0].identity.pending);
        let first_claim = claim(&mut engine, first, 1).await;
        assert!(matches!(
            engine
                .defer_optimistic_write(first, first_claim, 20, "uncertain response".into(), false)
                .await
                .unwrap(),
            DeferOptimisticWriteResult::Deferred
        ));

        // Even after the lease expires, this newer edit must not replace an
        // attempted creation whose response (and server identity) is unknown.
        let newer = enqueue(&mut engine, false, "latest; literal local-draft", 15).await;
        engine = reopen(engine, &database);
        assert_eq!(
            read(&mut engine, "local-draft").await[0].record["bodyHtmlSanitized"],
            "latest; literal local-draft"
        );
        let token = claim(&mut engine, first, 20).await;
        let result = engine
            .commit_optimistic_write(
                first,
                token,
                SAVE,
                Some("SaveEmailDraft"),
                &Map::new(),
                &response("server-draft", "server-thread", "first"),
            )
            .await
            .unwrap();
        assert_eq!(result.mutation_uuid.as_deref(), Some(UUID));
        assert_eq!(
            serde_json::from_str::<Value>(&result.revalidations[0].variables_json).unwrap()["threadId"],
            "server-thread"
        );
        engine = reopen(engine, &database);
        for id in ["local-draft", "server-draft"] {
            let draft = read(&mut engine, id).await;
            assert_eq!(draft.len(), 1);
            assert_eq!(draft[0].record["id"], "server-draft");
            assert_eq!(draft[0].record["threadId"], "server-thread");
            assert_eq!(
                draft[0].record["bodyHtmlSanitized"],
                "latest; literal local-draft"
            );
            assert!(draft[0].identity.pending);
            assert_eq!(draft[0].identity.mutation_uuid.as_deref(), Some(UUID));
        }
        let newer_claim = claim(&mut engine, newer, 21).await;
        assert!(preview_visible(&mut engine).await);
        let delete = enqueue(&mut engine, true, "", 22).await;
        assert!(!preview_visible(&mut engine).await);
        assert!(read(&mut engine, "local-draft").await.is_empty());
        assert!(matches!(
            engine
                .defer_optimistic_write(newer, newer_claim, 40, "uncertain edit".into(), false)
                .await
                .unwrap(),
            DeferOptimisticWriteResult::Deferred
        ));
        engine = reopen(engine, &database);
        assert!(read(&mut engine, "server-draft").await.is_empty());
        let token = claim(&mut engine, newer, 40).await;
        engine
            .commit_optimistic_write(
                newer,
                token,
                SAVE,
                Some("SaveEmailDraft"),
                &Map::new(),
                &response("server-draft", "server-thread", "latest"),
            )
            .await
            .unwrap();
        assert!(read(&mut engine, "local-draft").await.is_empty());
        let token = claim(&mut engine, delete, 41).await;
        engine
            .commit_optimistic_write(
                delete,
                token,
                DELETE,
                Some("DeleteEmailDraft"),
                &Map::new(),
                &json!({"deleteEmailDraft":{"deleted":true}}),
            )
            .await
            .unwrap();
        engine = reopen(engine, &database);
        assert!(read(&mut engine, "local-draft").await.is_empty());

        // Explicit undo/save restores the entity without losing its binding.
        let restored = enqueue(&mut engine, false, "restored", 50).await;
        assert_eq!(
            read(&mut engine, "local-draft").await[0].record["bodyHtmlSanitized"],
            "restored"
        );
        let token = claim(&mut engine, restored, 51).await;
        engine
            .commit_optimistic_write(
                restored,
                token,
                SAVE,
                Some("SaveEmailDraft"),
                &Map::new(),
                &response("server-draft", "server-thread", "restored"),
            )
            .await
            .unwrap();
        engine = reopen(engine, &database);
        let draft = read(&mut engine, "local-draft").await;
        assert_eq!(draft[0].record["bodyHtmlSanitized"], "restored");
        assert!(!draft[0].identity.pending);
        assert!(preview_visible(&mut engine).await);
        assert_eq!(draft[0].identity.mutation_uuid.as_deref(), Some(UUID));

        let rejected_delete = enqueue(&mut engine, true, "", 60).await;
        let token = claim(&mut engine, rejected_delete, 61).await;
        engine
            .rollback_optimistic_write(rejected_delete, token)
            .await
            .unwrap();
        assert_eq!(
            read(&mut engine, "local-draft").await[0].record["bodyHtmlSanitized"],
            "restored"
        );
    });
}
