use super::*;
use crate::service::team_share_reconciliation::{Options, reconcile_batch};
use models_permissions::share_permission::team_share::{TeamShareGrant, TeamShareLevel};

const DOCUMENT: &str = "20000000-0000-0000-0000-000000000002";
const CALL: &str = "20000000-0000-0000-0000-000000000005";
const TEAM: uuid::Uuid = uuid::uuid!("10000000-0000-0000-0000-000000000001");

async fn setup(db: &PgPool) {
    sqlx::raw_sql(include_str!(
        "../../../../../crates/share_permission_db_utils/fixtures/team_share.sql"
    ))
    .execute(db)
    .await
    .unwrap();
    sqlx::raw_sql(r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('20000000-0000-0000-0000-000000000002', 'document', '10000000-0000-0000-0000-000000000001', 'team', 'comment');
        UPDATE calls SET share_with_team = true;
        UPDATE call_records SET share_with_team = false;
    "#).execute(db).await.unwrap();
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn team_share_reconciliation_dry_run_apply_twice(db: PgPool) {
    setup(&db).await;
    let repo = PgReconciliationRepository::new(db);
    let options = Options {
        reviewed_documents: vec![DOCUMENT.parse().unwrap()],
        ..Options::default()
    };
    let document = EntityType::Document.with_entity_string(DOCUMENT.into());
    let call = EntityType::Call.with_entity_string(CALL.into());
    let before = repo.inspect(&document).await.unwrap();
    let call_before = repo.inspect(&call).await.unwrap();
    reconcile_batch(&repo, &options).await.unwrap();
    assert_eq!(repo.inspect(&document).await.unwrap(), before);
    assert_eq!(repo.inspect(&call).await.unwrap(), call_before);
    let options = Options {
        apply: true,
        ..options
    };
    let first = reconcile_batch(&repo, &options).await.unwrap();
    assert_eq!(first.iter().filter(|r| r.applied).count(), 2);
    let adopted = repo.inspect(&document).await.unwrap();
    assert_eq!(
        adopted.facts.unwrap().current.unwrap().level,
        TeamShareLevel::Comment
    );
    assert!(
        reconcile_batch(&repo, &options)
            .await
            .unwrap()
            .iter()
            .all(|r| !r.applied && r.classification.action.is_none())
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn team_share_reconciliation_excludes_inheritance_and_link_team(db: PgPool) {
    setup(&db).await;
    sqlx::raw_sql(
        r#"
        UPDATE entity_access SET granted_from_project_id = '20000000-0000-0000-0000-000000000001';
        UPDATE "SharePermission" SET "linkShare" = 'TEAM' WHERE id = 'document';
    "#,
    )
    .execute(&db)
    .await
    .unwrap();
    let repo = PgReconciliationRepository::new(db);
    let snapshot = repo
        .inspect(&EntityType::Document.with_entity_string(DOCUMENT.into()))
        .await
        .unwrap();
    assert!(snapshot.direct_grants.is_empty());
    assert!(
        crate::service::team_share_reconciliation::classify(&snapshot, true)
            .action
            .is_none()
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn team_share_reconciliation_rechecks_revision_and_repairs_exact_level(db: PgPool) {
    setup(&db).await;
    let repo = PgReconciliationRepository::new(db.clone());
    let entity = EntityType::Document.with_entity_string(DOCUMENT.into());
    let snapshot = repo.inspect(&entity).await.unwrap();
    let grant = TeamShareGrant {
        team_id: TEAM,
        level: TeamShareLevel::Comment,
    };
    let mut tx = db.begin().await.unwrap();
    team_share::maintain(
        &mut tx,
        &models_permissions::share_permission::team_share::TeamShareMaintenance::Clear {
            expected: snapshot.facts.clone().unwrap(),
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert!(!repo.apply(&snapshot, Action::Adopt(grant)).await.unwrap());
    assert!(
        crate::service::team_share_reconciliation::classify(
            &repo.inspect(&entity).await.unwrap(),
            true
        )
        .action
        .is_none()
    );

    // Establish canonical state as fixture data, then corrupt only its direct grant.
    sqlx::raw_sql(r#"
        UPDATE "SharePermission" SET team_share_access_level = 'view',
            team_share_team_id = '10000000-0000-0000-0000-000000000001', team_share_revision = 2 WHERE id = 'document';
    "#).execute(&db).await.unwrap();
    let snapshot = repo.inspect(&entity).await.unwrap();
    let action = crate::service::team_share_reconciliation::classify(&snapshot, false)
        .action
        .unwrap();
    assert!(repo.apply(&snapshot, action).await.unwrap());
    let repaired = repo.inspect(&entity).await.unwrap();
    assert_eq!(repaired.direct_grants[0].level, AccessLevel::View);
    assert_eq!(repaired.facts.unwrap().revision, 2);
    assert!(!repo.apply(&snapshot, action).await.unwrap());
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn team_share_reconciliation_reports_stale_owner_and_call_conflicts(db: PgPool) {
    setup(&db).await;
    sqlx::raw_sql(r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES
          ('20000000-0000-0000-0000-000000000002', 'document', '10000000-0000-0000-0000-000000000099', 'team', 'edit'),
          ('20000000-0000-0000-0000-000000000005', 'call', '10000000-0000-0000-0000-000000000001', 'team', 'owner');
    "#).execute(&db).await.unwrap();
    let repo = PgReconciliationRepository::new(db.clone());
    let options = Options {
        apply: true,
        reviewed_documents: vec![DOCUMENT.parse().unwrap()],
        ..Options::default()
    };
    let results = reconcile_batch(&repo, &options).await.unwrap();
    assert!(results.iter().all(|r| !r.applied));
    let document = results
        .iter()
        .find(|r| r.cursor == format!("document/{DOCUMENT}"))
        .unwrap();
    assert!(document.classification.findings.iter().any(|f| matches!(
        f,
        crate::service::team_share_reconciliation::Finding::StaleTeamGrant(_)
    )));
    let call = results
        .iter()
        .find(|r| r.cursor == format!("call/{CALL}"))
        .unwrap();
    assert!(call.classification.findings.iter().any(|f| matches!(
        f,
        crate::service::team_share_reconciliation::Finding::OwnerGrant(_)
    )));

    sqlx::raw_sql(
        r#"
        UPDATE entity_access SET access_level = 'edit' WHERE entity_type = 'call';
        UPDATE calls SET share_with_team = false;
    "#,
    )
    .execute(&db)
    .await
    .unwrap();
    let snapshot = repo
        .inspect(&EntityType::Call.with_entity_string(CALL.into()))
        .await
        .unwrap();
    let classification = crate::service::team_share_reconciliation::classify(&snapshot, false);
    assert!(classification.action.is_none());
    assert!(
        classification
            .findings
            .contains(&crate::service::team_share_reconciliation::Finding::CallFlagDisagreement)
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn team_share_reconciliation_rechecks_membership_flags_and_newer_update(db: PgPool) {
    setup(&db).await;
    let repo = PgReconciliationRepository::new(db.clone());
    let entity = EntityType::Call.with_entity_string(CALL.into());
    let snapshot = repo.inspect(&entity).await.unwrap();
    let action = crate::service::team_share_reconciliation::classify(&snapshot, false)
        .action
        .unwrap();
    let mut tx = db.begin().await.unwrap();
    team_share::acquire_guard(&mut tx).await.unwrap();
    sqlx::raw_sql("UPDATE calls SET share_with_team = false")
        .execute(tx.as_mut())
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(!repo.apply(&snapshot, action).await.unwrap());
    sqlx::raw_sql("UPDATE calls SET share_with_team = true; DELETE FROM team_user")
        .execute(&db)
        .await
        .unwrap();
    assert!(!repo.apply(&snapshot, action).await.unwrap());
    assert!(
        crate::service::team_share_reconciliation::classify(
            &repo.inspect(&entity).await.unwrap(),
            false
        )
        .action
        .is_none()
    );

    sqlx::raw_sql(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ('macro|owner@example.com', '10000000-0000-0000-0000-000000000001', 'owner');
    "#,
    )
    .execute(&db)
    .await
    .unwrap();
    let mut tx = db.begin().await.unwrap();
    let facts = team_share::load_facts(&mut tx, &entity).await.unwrap();
    let command = models_permissions::share_permission::team_share::authorize_team_share(
        Some(&facts.owner),
        &facts,
        models_permissions::share_permission::team_share::TeamShareRequest {
            access_level: Some(Some(AccessLevel::Edit)),
            legacy_enabled: None,
        },
        TeamShareLevel::View,
    )
    .unwrap()
    .unwrap();
    team_share::apply(&mut tx, &command).await.unwrap();
    // The competing repair must wait for the guard, then reject its old snapshot.
    let repair = tokio::spawn(async move { repo.apply(&snapshot, action).await.unwrap() });
    tokio::task::yield_now().await;
    tx.commit().await.unwrap();
    assert!(!repair.await.unwrap());
    let current = PgReconciliationRepository::new(db)
        .inspect(&entity)
        .await
        .unwrap();
    assert_eq!(
        current.facts.unwrap().current.unwrap().level,
        TeamShareLevel::Edit
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn team_share_reconciliation_bounded_resume_and_actual_call_level(db: PgPool) {
    setup(&db).await;
    sqlx::raw_sql(r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('20000000-0000-0000-0000-000000000005', 'call', '10000000-0000-0000-0000-000000000001', 'team', 'edit');
    "#).execute(&db).await.unwrap();
    let repo = PgReconciliationRepository::new(db);
    let mut options = Options {
        apply: true,
        batch_size: 1,
        ..Options::default()
    };
    let mut cursors = Vec::new();
    loop {
        let batch = reconcile_batch(&repo, &options).await.unwrap();
        assert!(batch.len() <= 1);
        let Some(record) = batch.first() else {
            break;
        };
        assert!(record.cursor > options.after);
        options.after = record.cursor.clone();
        cursors.push(record.cursor.clone());
    }
    assert_eq!(cursors.len(), 6);
    let call = repo
        .inspect(&EntityType::Call.with_entity_string(CALL.into()))
        .await
        .unwrap();
    assert_eq!(
        call.facts.unwrap().current.unwrap().level,
        TeamShareLevel::Edit
    );
}
