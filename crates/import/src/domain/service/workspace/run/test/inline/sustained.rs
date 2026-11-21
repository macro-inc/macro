//! Sustained outage recovery and the real ledger's current-review CAS.

use super::*;
use crate::domain::ports::{NotionPlanRepo, WrittenObjects};

struct ToggleViewFailure(Arc<std::sync::atomic::AtomicBool>);
impl NotionConnections for ToggleViewFailure {
    type Api = Inline;
    async fn for_user(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Inline>, NotionError> {
        Ok(Some(Inline {
            views_error: self
                .0
                .load(std::sync::atomic::Ordering::SeqCst)
                .then_some(503),
            ..Default::default()
        }))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_sustained_success_between_failures_restarts_the_window(pool: PgPool) {
    let owner = user("sustained-source-recovery");
    let tracker = TaskTracker::new();
    let fail = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let clock = Arc::new(std::sync::atomic::AtomicI64::new(0));
    // Keep the source pending after its healthy Notion reservation, without
    // turning a Macro row-write outage into a Notion failure observation.
    let mut service = service(
        &pool,
        Writer {
            fail_database_rows: true,
            ..Default::default()
        },
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(ToggleViewFailure(fail.clone())));
    let time = clock.clone();
    service.reservation_clock = Arc::new(move || {
        chrono::DateTime::from_timestamp(
            1_800_000_000 + time.load(std::sync::atomic::Ordering::SeqCst),
            0,
        )
        .unwrap()
    });
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    for (index, hours) in [0, 12, 24, 36, 48].into_iter().enumerate() {
        clock.store(hours * 3600, std::sync::atomic::Ordering::SeqCst);
        fail.store(index != 1, std::sync::atomic::Ordering::SeqCst);
        let (review, ids) = approved(&pool, &owner, std::slice::from_ref(&source)).await;
        planned(&service.repo, &owner).await;
        service
            .start_notion_write(&owner, review, NotionWriteChoices::default())
            .await
            .unwrap();
        tracker.close();
        tracker.wait().await;
        let report = service.notion_import_report(&owner).await.unwrap();
        let facts = service.repo.written(&owner, &ids).await.unwrap();
        if index == 1 {
            assert!(
                !facts.iter().any(|fact| fact.kind
                    == crate::domain::models::WrittenKind::DatabaseReservationFailure)
            );
        } else if index < 4 {
            assert_eq!(report.status, Some(RunStatus::Failed));
            assert!(
                !report
                    .warnings
                    .iter()
                    .any(|line| line.contains("Notion kept failing"))
            );
        } else {
            assert_eq!(report.status, Some(RunStatus::Completed));
            assert!(
                report
                    .warnings
                    .iter()
                    .any(|line| line.contains("Notion kept failing for Work"))
            );
            assert!(
                report
                    .error
                    .as_deref()
                    .is_none_or(|line| !line.contains("Plan again to retry"))
            );
        }
    }
}

fn snapshot(import_id: Uuid, review: Uuid, prior: &[Uuid]) -> crate::domain::models::WrittenObject {
    let observations: Vec<_> = prior.iter().chain(std::iter::once(&review)).enumerate()
        .map(|(n, review)| serde_json::json!({"review_id":review, "at":chrono::DateTime::from_timestamp(1_800_000_000 + n as i64 * 12 * 3600,0).unwrap()})).collect();
    crate::domain::models::WrittenObject {
        import_id,
        kind: crate::domain::models::WrittenKind::DatabaseReservationFailure,
        object: serde_json::json!({"state":"notion_failure", "window":{"first_at":chrono::DateTime::from_timestamp(1_800_000_000,0).unwrap(),"observations":observations}}).to_string(),
        macro_id: review,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_sustained_racing_reviews_preserve_attempts_and_other_facts(pool: PgPool) {
    let owner = user("outage-cas-owner");
    let other = user("outage-cas-denied");
    let repo = PgImportRepo::new(pool.clone());
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    let (first, ids) = approved(&pool, &owner, std::slice::from_ref(&source)).await;
    let id = ids[0];
    repo.claim_importing(&owner, &ids, &[], None).await.unwrap();
    let ordinary = Uuid::now_v7();
    let view = Uuid::now_v7();
    repo.record_written(
        &owner,
        &[
            crate::domain::models::WrittenObject {
                import_id: id,
                kind: crate::domain::models::WrittenKind::DatabaseReservationFailure,
                object: ordinary.to_string(),
                macro_id: ordinary,
            },
            crate::domain::models::WrittenObject {
                import_id: id,
                kind: crate::domain::models::WrittenKind::View,
                object: "saved view".into(),
                macro_id: view,
            },
        ],
    )
    .await
    .unwrap();
    let initial = snapshot(id, first, &[]);
    repo.replace_database_outage(&owner, id, first, None, std::slice::from_ref(&initial))
        .await
        .unwrap();
    repo.mark_import_failed(&owner, id, "retry").await.unwrap();
    let (second, next_ids) = approved(&pool, &owner, std::slice::from_ref(&source)).await;
    assert_eq!(next_ids, ids);
    repo.claim_importing(&owner, &ids, &[], None).await.unwrap();
    let next = snapshot(id, second, &[first]);
    let (stale, current) = tokio::join!(
        repo.replace_database_outage(
            &owner,
            id,
            first,
            Some(&initial.object),
            std::slice::from_ref(&initial)
        ),
        repo.replace_database_outage(
            &owner,
            id,
            second,
            Some(&initial.object),
            std::slice::from_ref(&next)
        ),
    );
    assert!(stale.is_err());
    current.unwrap();
    assert!(
        repo.replace_database_outage(
            &other,
            id,
            second,
            Some(&initial.object),
            std::slice::from_ref(&next)
        )
        .await
        .is_err()
    );
    repo.mark_import_failed(&owner, id, "retry").await.unwrap();
    let (third, _) = approved(&pool, &owner, &[source]).await;
    repo.claim_importing(&owner, &ids, &[], None).await.unwrap();
    let final_snapshot = snapshot(id, third, &[first, second]);
    let facts = vec![
        final_snapshot.clone(),
        crate::domain::models::WrittenObject {
            import_id: id,
            kind: crate::domain::models::WrittenKind::DatabaseReservationFailure,
            object: r#"{"state":"degraded","reason":"notion_persistent_failure"}"#.into(),
            macro_id: id,
        },
    ];
    let (one, two) = tokio::join!(
        repo.replace_database_outage(&owner, id, third, Some(&next.object), &facts),
        repo.replace_database_outage(&owner, id, third, Some(&next.object), &facts),
    );
    one.unwrap();
    two.unwrap();
    let stale_snapshot = snapshot(id, third, &[first]);
    assert!(
        repo.replace_database_outage(
            &owner,
            id,
            third,
            Some(&initial.object),
            std::slice::from_ref(&stale_snapshot)
        )
        .await
        .is_err()
    );
    let stored = repo.written(&owner, &ids).await.unwrap();
    assert_eq!(
        stored
            .iter()
            .filter(|fact| fact
                .object
                .starts_with(crate::domain::models::NOTION_OUTAGE_PREFIX))
            .count(),
        1
    );
    assert!(stored.contains(&final_snapshot));
    assert!(stored.iter().any(|fact| fact.macro_id == ordinary));
    assert!(stored.iter().any(|fact| fact.macro_id == view));
    assert_eq!(
        stored
            .iter()
            .filter(|fact| fact.object.starts_with("{\"state\":\"degraded\","))
            .count(),
        1
    );
}
