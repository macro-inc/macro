//! All typed TEAM-link query implementations must agree, including explanations.
use super::{SourceIds, chat_access, document_access, project_access};
use crate::domain::models::AccessLevel;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("typed_owner_team"))
)]
async fn discussion_attachments_use_the_parents_typed_owner_audience(
    pool: PgPool,
) -> anyhow::Result<()> {
    let child = fixture_entity_id(40);
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner)
        VALUES ($1, 'Attachment', 'macro|typed-teamless@example.com')"#,
        child.to_string()
    )
    .execute(&pool)
    .await?;
    let sources = SourceIds(vec!["90000000-0000-0000-0000-000000000011".to_string()]);
    let other = SourceIds(vec!["90000000-0000-0000-0000-000000000012".to_string()]);
    for (suffix, has_team) in [
        (31, true),
        (32, false),
        (33, true),
        (34, true),
        (35, true),
        (36, false),
        (37, false),
    ] {
        let message = Uuid::now_v7();
        let attachment = Uuid::now_v7();
        sqlx::query!(
            r#"INSERT INTO comms_messages (id, sender_id, content, parent_entity_type, parent_entity_id)
            VALUES ($1, 'macro|typed-teamless@example.com', 'attachment', 'document', $2)"#,
            message,
            fixture_entity_id(suffix).to_string()
        )
        .execute(&pool)
        .await?;
        sqlx::query!(
            r#"INSERT INTO comms_attachments (id, message_id, entity_type, entity_id)
            VALUES ($1, $2, 'document', $3)"#,
            attachment,
            message,
            child.to_string()
        )
        .execute(&pool)
        .await?;
        assert_eq!(
            document_access::get_document_access(&pool, &child, &sources, None).await?,
            has_team.then_some(AccessLevel::View)
        );
        assert_eq!(
            document_access::get_document_access(&pool, &child, &other, None).await?,
            None
        );
        sqlx::query!("DELETE FROM comms_attachments WHERE id = $1", attachment)
            .execute(&pool)
            .await?;
        assert_eq!(
            document_access::get_document_access(&pool, &child, &sources, None).await?,
            None
        );
    }
    Ok(())
}

fn fixture_entity_id(suffix: u8) -> Uuid {
    Uuid::parse_str(&format!("90000000-0000-0000-0000-{suffix:012}")).unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("typed_owner_team"))
)]
async fn typed_owner_team_links_allow_only_the_resolved_audience(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::parse_str("90000000-0000-0000-0000-000000000011")?;
    for (suffix, has_team) in [
        (31, true),
        (32, false),
        (33, true),
        (34, true),
        (35, true),
        (36, false),
        (37, false),
    ] {
        let id = fixture_entity_id(suffix);
        for (sources, matches_team) in [
            (vec![team.to_string()], true),
            (
                vec!["90000000-0000-0000-0000-000000000012".to_string()],
                false,
            ),
            (vec!["macro|typed-teamless@example.com".to_string()], false),
            (vec![], false),
        ] {
            let sources = SourceIds(sources);
            let expected = (has_team && matches_team).then_some(AccessLevel::Comment);
            assert_eq!(
                document_access::get_document_access(&pool, &id, &sources, None).await?,
                expected,
                "document {suffix}"
            );
            assert_eq!(
                document_access::get_legacy_document_access(&pool, &id.to_string(), &sources, None)
                    .await?,
                expected,
                "legacy {suffix}"
            );
            assert_eq!(
                project_access::get_project_access(&pool, &id, &sources).await?,
                expected,
                "project {suffix}"
            );
            assert_eq!(
                chat_access::get_chat_access(&pool, &id, &sources).await?,
                expected,
                "chat {suffix}"
            );

            #[cfg(feature = "explain_binary")]
            for grants in [
                document_access::explain_document_access(&pool, &id, &sources, None).await?,
                project_access::explain_project_access(&pool, &id, &sources).await?,
                chat_access::explain_chat_access(&pool, &id, &sources).await?,
            ] {
                use crate::domain::models::AccessGrant;
                let expected = expected.map(|access_level| AccessGrant::TeamLink {
                    access_level,
                    owner_team_id: team,
                });
                assert_eq!(
                    grants,
                    expected.into_iter().collect::<Vec<_>>(),
                    "explanation {suffix}"
                );
            }
        }
    }
    Ok(())
}
