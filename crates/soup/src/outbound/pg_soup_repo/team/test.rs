use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use sqlx::Postgres;

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed", "attention_teams")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn hydrates_only_teams_the_viewer_belongs_to(
    pool: sqlx::Pool<Postgres>,
) -> anyhow::Result<()> {
    let entities: Vec<Entity<'static>> = [
        "bbbbbbbb-0000-0000-0000-000000000001",
        "bbbbbbbb-0000-0000-0000-000000000002",
        "bbbbbbbb-0000-0000-0000-0000000000ff",
    ]
    .into_iter()
    .map(|id| EntityType::Team.with_entity_string(id.to_string()))
    .collect();
    let request = |user: &'static str| -> anyhow::Result<_> {
        Ok(AdvancedSortParams {
            entities: &entities,
            user_id: MacroUserIdStr::parse_from_str(user)?,
        })
    };

    let items = by_ids(&pool, request("macro|user-1@example.com")?).await?;
    let [SoupItem::Team(team)] = items.as_slice() else {
        panic!("expected only team-1, got {items:?}");
    };
    assert_eq!(team.id.to_string(), "bbbbbbbb-0000-0000-0000-000000000001");
    assert_eq!(team.name, "Team 1");
    assert_eq!(team.owner_id, "macro|user-1@example.com");

    // Someone in no team sees none of them.
    let outsider = by_ids(&pool, request("macro|outsider@example.com")?).await?;
    assert!(outsider.is_empty(), "{outsider:?}");
    Ok(())
}
