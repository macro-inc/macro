use super::*;
use crate::domain::search::{
    AgentSessionSearchMetadataService as _, AgentSessionSearchMetadataServiceImpl,
};

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
