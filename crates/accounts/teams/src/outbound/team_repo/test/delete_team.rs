use bot_id::BotId;
use uuid::Uuid;

use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("teams", "team_grants"))
)]
async fn delete_team_sweeps_the_grants_of_the_team_and_its_bots_only(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool.clone());
    let team_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let bot_ids = vec![
        BotId::parse_uuid_str("60000000-0000-0000-0000-000000000001")?,
        BotId::parse_uuid_str("60000000-0000-0000-0000-000000000002")?,
    ];

    team_repo
        .delete_team(&ClearedTeam::assume_cleared(team_id, bot_ids))
        .await?;

    let remaining = sqlx::query!(
        r#"SELECT source_id, source_type AS "source_type: EntityAccessSourceType"
           FROM entity_access ORDER BY id"#
    )
    .fetch_all(&pool)
    .await?
    .into_iter()
    .map(|row| (row.source_id, row.source_type))
    .collect::<Vec<_>>();

    assert_eq!(
        remaining,
        vec![
            (
                "bot|60000000-0000-0000-0000-000000000003".to_owned(),
                EntityAccessSourceType::Bot
            ),
            (
                "22222222-2222-2222-2222-222222222222".to_owned(),
                EntityAccessSourceType::Team
            ),
            (
                "macro|user@user.com".to_owned(),
                EntityAccessSourceType::User
            ),
        ]
    );

    Ok(())
}
