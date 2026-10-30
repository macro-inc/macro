use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const TEAM: &str = "10000000-0000-0000-0000-000000000001";
const BOT: &str = "bot|60000000-0000-0000-0000-000000000001";

async fn remaining_sources(
    pool: &PgPool,
) -> Result<Vec<(String, EntityAccessSourceType)>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT source_id, source_type AS "source_type: EntityAccessSourceType"
           FROM entity_access ORDER BY id"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.source_id, row.source_type))
        .collect())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share", "source_grants"))
)]
async fn deletes_every_grant_of_the_source_and_nothing_else(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    assert_eq!(
        delete_source_grants(&pool, EntityAccessSourceType::Team, TEAM).await?,
        3
    );
    assert_eq!(
        delete_source_grants(&pool, EntityAccessSourceType::Bot, BOT).await?,
        2
    );
    assert_eq!(
        remaining_sources(&pool).await?,
        vec![
            ("other-team".to_owned(), EntityAccessSourceType::Team),
            (TEAM.to_owned(), EntityAccessSourceType::Channel),
            (
                "bot|60000000-0000-0000-0000-000000000002".to_owned(),
                EntityAccessSourceType::Bot
            ),
            (
                "macro|owner@example.com".to_owned(),
                EntityAccessSourceType::User
            ),
        ]
    );
    assert_eq!(
        delete_source_grants(&pool, EntityAccessSourceType::Team, TEAM).await?,
        0
    );
    Ok(())
}
