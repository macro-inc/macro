use super::*;
use crate::outbound::pg_access_repo::queries::{
    source_list_oracle,
    test_viewers::{assert_matrix_agrees, matrix_viewers},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use uuid::Uuid;

/// A user with no rows at all.
const STRANGER: &str = "macro|external-chat-stranger@example.com";

async fn external_chats(pool: &PgPool) -> anyhow::Result<Vec<Uuid>> {
    Ok(
        sqlx::query_scalar!(r#"SELECT id FROM external_chat ORDER BY id"#)
            .fetch_all(pool)
            .await?,
    )
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "typed_owner_team", "viewer_matrix_external_chat")
    )
)]
async fn external_chat_access_matches_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let viewers = matrix_viewers(&pool).await?;
    let chats = external_chats(&pool).await?;

    assert_matrix_agrees(&viewers, &chats, async |viewer, chat_id| {
        Ok((
            source_list_oracle::get_external_chat_access(&pool, chat_id, &viewer.sources).await?,
            get_external_chat_access(&pool, chat_id, viewer.viewer()).await?,
        ))
    })
    .await
}

/// `external_chat_can_view` is replaced under the code deployed before this
/// change, so it must answer as its old body did for every principal callers
/// pass it: each user, a user with no rows, each bot, and no one.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "typed_owner_team", "viewer_matrix_external_chat")
    )
)]
async fn external_chat_can_view_answers_as_its_old_body(pool: PgPool) -> anyhow::Result<()> {
    let chats = external_chats(&pool).await?;
    let mut principals: Vec<Option<String>> = sqlx::query_scalar!(
        r#"SELECT id AS "id!" FROM "User" UNION ALL SELECT 'bot|' || id FROM bots ORDER BY 1"#
    )
    .fetch_all(&pool)
    .await?
    .into_iter()
    .map(Some)
    .collect();
    principals.push(Some(STRANGER.to_string()));
    principals.push(None);

    let mut answers = std::collections::HashSet::new();
    for principal in &principals {
        let mut row = Vec::with_capacity(chats.len());
        for chat_id in &chats {
            let answer = sqlx::query!(
                r#"SELECT external_chat_access_level($1, external_chat_sources($2)) IS NOT NULL AS "old!",
                          external_chat_can_view($1, $2) AS "new!""#,
                chat_id,
                principal.as_deref(),
            )
            .fetch_one(&pool)
            .await?;
            assert_eq!(answer.new, answer.old, "{principal:?} on {chat_id}");
            row.push(answer.new);
        }
        answers.insert(row);
    }
    anyhow::ensure!(
        answers.len() >= 4,
        "only {} distinct answer rows across {} principals",
        answers.len(),
        principals.len()
    );
    Ok(())
}
