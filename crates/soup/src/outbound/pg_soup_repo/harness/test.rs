use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_pagination::Identify;
use sqlx::Postgres;

#[sqlx::test(
    fixtures(
        path = "../../../../fixtures",
        scripts("work_feed", "attention_harnesses")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn hydrates_only_runtimes_the_viewer_can_see(
    pool: sqlx::Pool<Postgres>,
) -> anyhow::Result<()> {
    let entities: Vec<Entity<'static>> = [
        "aaaaaaaa-0000-0000-0000-000000000001",
        "aaaaaaaa-0000-0000-0000-000000000002",
        "aaaaaaaa-0000-0000-0000-000000000003",
        "aaaaaaaa-0000-0000-0000-000000000004",
    ]
    .into_iter()
    .map(|id| EntityType::Harness.with_entity_string(id.to_string()))
    .collect();
    let mut items = by_ids(
        &pool,
        AdvancedSortParams {
            entities: &entities,
            user_id: MacroUserIdStr::parse_from_str("macro|user-1@example.com")?,
        },
    )
    .await?;
    items.sort_by_key(|item| item.id());

    let [SoupItem::Harness(runtime_1), SoupItem::Harness(runtime_2)] = items.as_slice() else {
        panic!("expected runtime-1 and runtime-2, got {items:?}");
    };
    assert_eq!(runtime_1.name, "runtime-1");
    assert_eq!(
        runtime_1.owner_id,
        Owner::from_principal_str("macro|user-1@example.com")?
    );
    assert_eq!(runtime_2.name, "runtime-2");
    assert_eq!(
        runtime_2.owner_id,
        Owner::from_principal_str("macro|user-2@example.com")?
    );
    Ok(())
}
