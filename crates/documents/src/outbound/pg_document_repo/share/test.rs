use super::*;
use entity_access_db_utils::team_share::{acquire_guard, upsert_direct};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_permissions::share_permission::access_level::AccessLevel;
use uuid::Uuid;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../entity_access/fixtures",
        scripts("typed_owner_team")
    )
)]
async fn typed_owner_toggle_reads_audience_and_adopts_only_its_legacy_grant(pool: PgPool) {
    let team = Uuid::parse_str("90000000-0000-0000-0000-000000000011").unwrap();
    let other_team = Uuid::parse_str("90000000-0000-0000-0000-000000000012").unwrap();
    for (suffix, has_team) in [
        (31, true),
        (32, false),
        (33, true),
        (34, true),
        (35, true),
        (36, false),
        (37, false),
    ] {
        let id = format!("90000000-0000-0000-0000-{suffix:012}");
        let uuid = Uuid::parse_str(&id).unwrap();
        let initial = get_team_share(&pool, &id).await.unwrap();
        assert_eq!(initial.team_id, has_team.then_some(team));
        assert!(!initial.shared_with_team);

        // Foreign direct grants must not make the owner's toggle look enabled.
        let mut tx = pool.begin().await.unwrap();
        acquire_guard(&mut tx).await.unwrap();
        upsert_direct(
            tx.as_mut(),
            &uuid,
            EntityType::Document,
            other_team,
            AccessLevel::Comment,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        assert!(!get_team_share(&pool, &id).await.unwrap().shared_with_team);

        if has_team {
            let mut tx = pool.begin().await.unwrap();
            acquire_guard(&mut tx).await.unwrap();
            upsert_direct(
                tx.as_mut(),
                &uuid,
                EntityType::Document,
                team,
                AccessLevel::Comment,
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
            let shared = get_team_share(&pool, &id).await.unwrap();
            assert_eq!(shared.team_id, Some(team));
            assert!(shared.shared_with_team);
            let facts = get_team_share_facts(&pool, &id).await.unwrap();
            assert_eq!(facts.current.unwrap().team_id, team);
        }
    }
}
