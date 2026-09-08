use super::*;
use models_permissions::share_permission::team_share::{
    TeamShareLevel, TeamShareRequest, authorize_team_share,
};
use share_permission_db_utils::team_share::{apply, load_facts};
use sqlx::PgPool;

const PROJECT: &str = "20000000-0000-0000-0000-000000000001";
const DOCUMENT: &str = "20000000-0000-0000-0000-000000000010";

#[sqlx::test(fixtures(
    path = "../../../../../share_permission_db_utils/fixtures",
    scripts("team_share")
))]
async fn legacy_creation_inherits_current_level_in_caller_transaction(pool: PgPool) {
    for level in [AccessLevel::Edit, AccessLevel::View, AccessLevel::Comment] {
        let mut tx = pool.begin().await.unwrap();
        let project = EntityType::Project.with_entity_string(PROJECT.to_string());
        let facts = load_facts(&mut tx, &project).await.unwrap();
        let command = authorize_team_share(
            Some(&facts.owner),
            &facts,
            TeamShareRequest {
                access_level: Some(Some(level)),
                legacy_enabled: None,
            },
            TeamShareLevel::Edit,
        )
        .unwrap()
        .unwrap();
        apply(&mut tx, &command).await.unwrap();
        tx.commit().await.unwrap();

        let mut tx = pool.begin().await.unwrap();
        // Copied input must not establish explicit consent on ordinary creation.
        let mut permission =
            SharePermissionV2::new_document_share_permission(Some(FileType::Md), None);
        permission.team_share_access_level = Some(AccessLevel::Edit);
        create_document_txn(
            &mut tx,
            CreateDocumentArgs {
                id: Some(DOCUMENT),
                sha: "sha",
                document_name: "Legacy task",
                user_id: MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
                file_type: Some(FileType::Md),
                project_id: Some(PROJECT),
                project_name: None,
                share_permission: &permission,
                skip_history: false,
                email_attachment_id: None,
                created_at: None,
                is_task: level == AccessLevel::Comment,
            },
        )
        .await
        .unwrap();
        let document = EntityType::Document.with_entity_string(DOCUMENT.to_string());
        let facts = load_facts(&mut tx, &document).await.unwrap();
        assert_eq!(facts.current, None);
        assert_eq!(facts.revision, 0);
        let inherited = sqlx::query_scalar!(
            r#"SELECT access_level AS "level: AccessLevel" FROM entity_access
            WHERE entity_id = $1 AND entity_type = 'document' AND source_type = 'team'
            AND granted_from_project_id = $2"#,
            Uuid::parse_str(DOCUMENT).unwrap(),
            PROJECT,
        )
        .fetch_one(tx.as_mut())
        .await
        .unwrap();
        assert_eq!(inherited, level);
        tx.rollback().await.unwrap();
        assert_eq!(
            sqlx::query_scalar!(r#"SELECT count(*) FROM "Document" WHERE id = $1"#, DOCUMENT)
                .fetch_one(&pool)
                .await
                .unwrap(),
            Some(0)
        );
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT count(*) FROM entity_access WHERE entity_id = $1",
                Uuid::parse_str(DOCUMENT).unwrap()
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            Some(0)
        );
    }
}
