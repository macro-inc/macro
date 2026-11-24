use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;

use super::*;
use crate::domain::models::{RecordedOutcome, SkipReason};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|designer@example.com")
        .unwrap()
        .into_owned()
}

fn other_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|someone-else@example.com")
        .unwrap()
        .into_owned()
}

fn item(n: u8) -> ItemId {
    ItemId::parse(&format!("urn:adsk.wipprod:dm.lineage:item-{n}")).unwrap()
}

fn project() -> ApsProjectId {
    ApsProjectId::parse("a.ZXhhbXBsZTp3aXAxZnFhYXV0b2Rlc2sxNjE").unwrap()
}

fn version(n: u32, outcome: RecordedOutcome) -> VersionRecord {
    VersionRecord {
        version_id: VersionId::parse(&format!("urn:adsk.wipprod:fs.file:vf.item-1?version={n}"))
            .unwrap(),
        number: n,
        outcome,
        size: Some(2048),
        extension: Some("stl".into()),
        created_at: Some("2026-11-01T10:00:00Z".parse().unwrap()),
    }
}

const LEASE: Duration = Duration::from_secs(600);

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn tracking_an_item_again_keeps_its_first_document(pool: PgPool) {
    let repo = PgFusionRepo::new(pool);
    let first = Uuid::now_v7();

    let tracked = repo
        .track(&user(), &item(1), &project(), first)
        .await
        .unwrap();
    let again = repo
        .track(&user(), &item(1), &project(), Uuid::now_v7())
        .await
        .unwrap();

    assert_eq!(
        tracked,
        TrackedItem {
            item_id: item(1),
            project_id: project(),
            document_id: first,
            state: LinkState::Creating,
        }
    );
    assert_eq!(again, tracked);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_claimer_holds_an_item_until_it_releases(pool: PgPool) {
    let repo = PgFusionRepo::new(pool);
    repo.track(&user(), &item(1), &project(), Uuid::now_v7())
        .await
        .unwrap();

    let claim = repo.claim(&user(), &item(1), LEASE).await.unwrap().unwrap();
    let second = repo.claim(&user(), &item(1), LEASE).await.unwrap();
    assert_eq!(second, None);
    assert_eq!(claim.item.item_id, item(1));

    repo.release(&user(), &claim).await.unwrap();
    assert!(
        repo.claim(&user(), &item(1), LEASE)
            .await
            .unwrap()
            .is_some()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lapsed_lease_is_claimable_and_its_late_release_frees_nothing(pool: PgPool) {
    let repo = PgFusionRepo::new(pool);
    repo.track(&user(), &item(1), &project(), Uuid::now_v7())
        .await
        .unwrap();
    // A lease of no time has lapsed by the next statement's `now()`.
    let stale = repo
        .claim(&user(), &item(1), Duration::ZERO)
        .await
        .unwrap()
        .unwrap();

    let fresh = repo.claim(&user(), &item(1), LEASE).await.unwrap().unwrap();
    repo.release(&user(), &stale).await.unwrap();

    // The stale holder's release did not free the fresh hold.
    assert_eq!(repo.claim(&user(), &item(1), LEASE).await.unwrap(), None);
    repo.release(&user(), &fresh).await.unwrap();
    assert!(
        repo.claim(&user(), &item(1), LEASE)
            .await
            .unwrap()
            .is_some()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_version_is_recorded_once(pool: PgPool) {
    let repo = PgFusionRepo::new(pool);
    repo.track(&user(), &item(1), &project(), Uuid::now_v7())
        .await
        .unwrap();
    let imported = version(
        1,
        RecordedOutcome::Imported {
            document_version_id: 41,
        },
    );

    repo.record_version(&user(), &item(1), &imported)
        .await
        .unwrap();
    // A retry that recorded it differently changes nothing.
    repo.record_version(
        &user(),
        &item(1),
        &version(1, RecordedOutcome::Skipped(SkipReason::Unavailable)),
    )
    .await
    .unwrap();
    repo.record_version(
        &user(),
        &item(1),
        &version(2, RecordedOutcome::Skipped(SkipReason::TooLarge)),
    )
    .await
    .unwrap();

    let mut recorded = repo.recorded_versions(&user(), &item(1)).await.unwrap();
    recorded.sort_by_key(|version| version.number);
    assert_eq!(
        recorded,
        vec![
            RecordedVersion {
                version_id: imported.version_id.clone(),
                number: 1,
                outcome: VersionOutcome::Imported,
                extension: Some("stl".into()),
            },
            RecordedVersion {
                version_id: version(2, RecordedOutcome::Skipped(SkipReason::TooLarge)).version_id,
                number: 2,
                outcome: VersionOutcome::TooLarge,
                extension: Some("stl".into()),
            },
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn tracked_items_are_the_users_own_in_id_order_from_a_cursor(pool: PgPool) {
    let repo = PgFusionRepo::new(pool);
    for n in [3, 1, 2] {
        repo.track(&user(), &item(n), &project(), Uuid::now_v7())
            .await
            .unwrap();
    }
    repo.track(&other_user(), &item(9), &project(), Uuid::now_v7())
        .await
        .unwrap();
    repo.mark_linked(&user(), &item(2)).await.unwrap();
    repo.record_version(
        &user(),
        &item(2),
        &version(
            1,
            RecordedOutcome::Imported {
                document_version_id: 7,
            },
        ),
    )
    .await
    .unwrap();
    repo.record_version(
        &user(),
        &item(2),
        &version(2, RecordedOutcome::Skipped(SkipReason::UnsupportedFormat)),
    )
    .await
    .unwrap();

    let ids = |items: Vec<TrackedItem>| -> Vec<ItemId> {
        items.into_iter().map(|tracked| tracked.item_id).collect()
    };
    let all = ids(repo.tracked_items(&user(), None, 50).await.unwrap());
    let first_two = ids(repo.tracked_items(&user(), None, 2).await.unwrap());
    let from_two = ids(repo
        .tracked_items(&user(), Some(&item(2)), 50)
        .await
        .unwrap());
    let summaries = repo
        .tracked(&user(), &[item(2), item(3), item(9)])
        .await
        .unwrap();

    assert_eq!(all, vec![item(1), item(2), item(3)]);
    assert_eq!(first_two, vec![item(1), item(2)]);
    assert_eq!(from_two, vec![item(2), item(3)]);
    let mut counts: Vec<(ItemId, LinkState, u32)> = summaries
        .into_iter()
        .map(|summary| {
            (
                summary.item.item_id,
                summary.item.state,
                summary.imported_versions,
            )
        })
        .collect();
    counts.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        counts,
        vec![
            (item(2), LinkState::Linked, 1),
            (item(3), LinkState::Creating, 0),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn relinking_points_at_a_new_document_and_forgets_the_versions(pool: PgPool) {
    let repo = PgFusionRepo::new(pool);
    repo.track(&user(), &item(1), &project(), Uuid::now_v7())
        .await
        .unwrap();
    repo.mark_linked(&user(), &item(1)).await.unwrap();
    repo.record_version(
        &user(),
        &item(1),
        &version(
            1,
            RecordedOutcome::Imported {
                document_version_id: 3,
            },
        ),
    )
    .await
    .unwrap();
    let replacement = Uuid::now_v7();

    repo.relink(&user(), &item(1), replacement).await.unwrap();

    let tracked = repo
        .track(&user(), &item(1), &project(), Uuid::now_v7())
        .await
        .unwrap();
    assert_eq!(tracked.document_id, replacement);
    assert_eq!(tracked.state, LinkState::Creating);
    assert_eq!(
        repo.recorded_versions(&user(), &item(1)).await.unwrap(),
        vec![]
    );
}
