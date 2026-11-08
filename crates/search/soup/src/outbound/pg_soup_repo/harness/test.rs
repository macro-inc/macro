use super::*;
use entity_kind::Entity;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use pagination_types::Identify;
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

/// A computer's harness is visible to its team, not by its recorded owner:
/// user-1 bought it for team 3 and left, so neither user-1 nor user-2 (user-1's
/// teammate on team 1) sees it, while team 3's owner does.
#[sqlx::test(
    fixtures(
        path = "../../../../fixtures",
        scripts("work_feed", "attention_harnesses")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_computer_harness_is_visible_to_its_team_not_its_buyers_teammates(
    pool: sqlx::Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::raw_sql(
        r#"
        INSERT INTO hosted_runtime_host (id, name, awake_capacity_units, sold_capacity_units)
        VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'host-1', 8, 8);
        INSERT INTO harnesses (id, name, owner_user_id, created_by, computer_id)
        VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'computer', 'macro|user-1@example.com',
            'macro|user-1@example.com', 'cccccccc-0000-0000-0000-000000000001');
        INSERT INTO hosted_runtime (
            id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry,
            purchase_key, host_id, state, harness_id, created_by
        )
        VALUES ('cccccccc-0000-0000-0000-000000000001', '77777777-cccc-cccc-cccc-cccccccccccc',
            'computer', 'standard', 2, 8, 40, 'standard-v1', 'buy-1',
            'bbbbbbbb-0000-0000-0000-000000000001', '{}',
            'aaaaaaaa-0000-0000-0000-0000000000c1', 'macro|user-1@example.com');
        "#,
    )
    .execute(&pool)
    .await?;
    let entities =
        [EntityType::Harness
            .with_entity_string("aaaaaaaa-0000-0000-0000-0000000000c1".to_string())];
    for (viewer, sees) in [
        ("macro|user-1@example.com", false),
        ("macro|user-2@example.com", false),
        ("macro|user-3@example.com", true),
    ] {
        let items = by_ids(
            &pool,
            AdvancedSortParams {
                entities: &entities,
                user_id: MacroUserIdStr::parse_from_str(viewer)?,
            },
        )
        .await?;
        assert_eq!(items.len(), usize::from(sees), "{viewer}");
    }
    Ok(())
}
