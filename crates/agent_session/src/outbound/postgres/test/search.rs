use super::*;
use crate::domain::search::{
    AgentSessionSearchMetadataService as _, AgentSessionSearchMetadataServiceImpl,
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_snapshot_folds_persisted_acp_instead_of_indexing_protocol_frames(pool: PgPool) {
    use crate::domain::search::indexing::{SearchSnapshotService, SearchSnapshotServiceImpl};
    use crate::outbound::postgres::search::PgSearchIndexingRepo;
    use agent_fold::domain::{model::Author, service::FoldedMessageService};
    use serde_json::json;

    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    for content in [
        json!({"direction":"to_runtime", "content": {"type":"acp", "jsonrpc":"2.0", "id":"prompt-1", "method":"session/prompt", "params": {
            "sessionId":"hidden-protocol-session", "prompt":[{"type":"text", "text":"find cobalt"}]
        }}}),
        json!({"direction":"to_server", "content": {"type":"acp", "jsonrpc":"2.0", "method":"session/update", "params": {
            "sessionId":"hidden-protocol-session", "update":{"sessionUpdate":"agent_message_chunk", "content":{"type":"text", "text":"found "}}
        }}}),
        json!({"direction":"to_server", "content": {"type":"acp", "jsonrpc":"2.0", "method":"session/update", "params": {
            "sessionId":"hidden-protocol-session", "update":{"sessionUpdate":"agent_message_chunk", "content":{"type":"text", "text":"quartz"}}
        }}}),
        json!({"direction":"to_server", "content": {"type":"acp", "jsonrpc":"2.0", "id":"prompt-1", "result":{"stopReason":"end_turn"}}}),
    ] {
        AgentSessionLogRepo::create(
            &repo,
            AgentSessionLog {
                agent_session_id: session.id,
                user_id: Some(user_id(OWNER)),
                content: serde_json::from_value(content).unwrap(),
            },
        )
        .await
        .unwrap();
    }
    let locks = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy_with((*pool.connect_options()).clone());
    let service = SearchSnapshotServiceImpl::new(
        PgSearchIndexingRepo::new(pool, locks),
        FoldedMessageService::new(repo.clone()),
    );
    let snapshot = service.snapshot(session.id).await.unwrap().unwrap();
    assert_eq!(snapshot.metadata.id, session.id.as_uuid());
    assert_eq!(snapshot.messages.len(), 2);
    assert!(matches!(snapshot.messages[0].author, Author::User { .. }));
    assert_eq!(snapshot.messages[0].searchable_text(), "find cobalt");
    assert!(matches!(snapshot.messages[1].author, Author::Agent));
    assert_eq!(snapshot.messages[1].searchable_text(), "found quartz");

    AgentSessionRepo::delete(&repo, session.id).await.unwrap();
    assert!(service.snapshot(session.id).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn indexing_pages_current_sessions_and_serializes_snapshot_leases(pool: PgPool) {
    use crate::domain::search::indexing::SearchIndexingRepo;
    use crate::outbound::postgres::search::PgSearchIndexingRepo;
    use sqlx::postgres::PgPoolOptions;
    use std::time::Duration;

    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let first = create_session(&repo, new_session(bot, None, None)).await;
    let second = create_session(&repo, new_session(bot, None, None)).await;
    let lock_pool = PgPoolOptions::new()
        .max_connections(3)
        .connect_lazy_with((*pool.connect_options()).clone());
    let indexing = PgSearchIndexingRepo::new(pool, lock_pool);
    let mut ids = vec![first.id.as_uuid(), second.id.as_uuid()];
    ids.sort();
    assert_eq!(indexing.page(None).await.unwrap(), ids);
    assert_eq!(indexing.page(Some(ids[0])).await.unwrap(), vec![ids[1]]);
    assert!(indexing.page(Some(ids[1])).await.unwrap().is_empty());

    let lease = indexing.lock(first.id).await.unwrap();
    let mut waiting = Box::pin(indexing.lock(first.id));
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut waiting)
            .await
            .is_err()
    );
    // A different session is independent, even while the first lease is held.
    let other = tokio::time::timeout(Duration::from_secs(5), indexing.lock(second.id))
        .await
        .unwrap()
        .unwrap();
    drop(other);
    drop(lease);
    let _lease = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .unwrap()
        .unwrap();

    AgentSessionRepo::delete(&repo, first.id).await.unwrap();
    assert_eq!(
        indexing.page(None).await.unwrap(),
        vec![second.id.as_uuid()]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_metadata_is_scoped_current_and_omits_deleted_sessions(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let search_metadata = AgentSessionSearchMetadataServiceImpl::new(repo.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let other = create_session(&repo, new_session(bot, None, None)).await;
    repo.set_name(session.id, "Updated searchable name")
        .await
        .unwrap();
    let rows = search_metadata
        .search_metadata(vec![session.id.as_uuid()])
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, session.id.as_uuid());
    assert_eq!(rows[0].name, "Updated searchable name");
    assert_eq!(rows[0].owner_id.as_ref(), OWNER);
    assert!(
        search_metadata
            .search_metadata(vec![])
            .await
            .unwrap()
            .is_empty()
    );
    AgentSessionRepo::delete(&repo, session.id).await.unwrap();
    let rows = search_metadata
        .search_metadata(vec![session.id.as_uuid(), other.id.as_uuid()])
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, other.id.as_uuid());
}
