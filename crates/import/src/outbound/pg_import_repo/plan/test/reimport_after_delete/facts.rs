//! Permission changes alone cannot turn an active copy into a new generation.

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_active_copy_without_view_grants_keeps_its_generation(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "facts-owner", team).await;
    let teammate = member(&pool, "facts-teammate", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({"plan": {"decision": "copy", "shared": true}}),
    }];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let import_id = rows[0].id;
    let document = Uuid::now_v7();
    sqlx::query!(r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ($1, 'Active copy', $2, 'md')"#,
        document.to_string(), owner.as_ref(),
    ).execute(&pool).await.unwrap();
    repo.claim_importing(&owner, &[import_id], &[import_id], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document.to_string(), "md", None)
        .await
        .unwrap();
    assert!(
        !sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM entity_access WHERE entity_id = $1) AS "granted!""#,
            document
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );

    let copies = lifecycle::team_copies(
        &repo,
        &Targets(pool.clone()),
        &teammate,
        &["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()],
    )
    .await
    .unwrap();
    assert_eq!(copies.len(), 1);
    assert_eq!(copies[0].id, import_id);
    assert!(
        lifecycle::replace_plan(
            &repo,
            &Targets(pool.clone()),
            &owner,
            ImportSource::Notion,
            &plan
        )
        .await
        .unwrap()
        .is_empty()
    );
    let unchanged = repo.get(&owner, import_id).await.unwrap().unwrap();
    assert_eq!(unchanged.status, ImportStatus::Imported);
    assert_eq!(unchanged.team_id, Some(team));
    assert_eq!(unchanged.entity_id, Some(document.to_string()));
}

struct RestoredOnRead(PgPool, std::sync::atomic::AtomicBool);

impl ImportedTargetReader for RestoredOnRead {
    async fn target_exists(&self, target: ImportedTarget) -> anyhow::Result<bool> {
        if !self.1.swap(true, std::sync::atomic::Ordering::SeqCst) {
            let ImportedTarget::Document(id) = target else {
                unreachable!()
            };
            sqlx::query!(
                r#"UPDATE "Document" SET "deletedAt" = NULL WHERE id = $1"#,
                id.to_string()
            )
            .execute(&self.0)
            .await?;
            return Ok(false);
        }
        Ok(true)
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn restoring_a_target_before_renewal_keeps_its_generation_and_claim(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "restore-owner", team).await;
    let rows = repo
        .replace_plan(
            &owner,
            ImportSource::Notion,
            &[PlanRow {
                kind: ImportKind::Page,
                foreign_id: "cccccccccccccccccccccccccccccccc".into(),
                parent_foreign_id: None,
                metadata: serde_json::json!({"plan":{"decision":"copy","shared":true}}),
            }],
        )
        .await
        .unwrap();
    let document = Uuid::now_v7();
    sqlx::query!(r#"INSERT INTO "Document" (id,name,owner,"fileType","deletedAt") VALUES ($1,'Restored',$2,'md',NOW())"#,
        document.to_string(), owner.as_ref()).execute(&pool).await.unwrap();
    repo.claim_importing(&owner, &[rows[0].id], &[rows[0].id], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, rows[0].id, &document.to_string(), "md", None)
        .await
        .unwrap();
    let reader = RestoredOnRead(pool.clone(), std::sync::atomic::AtomicBool::new(false));
    let imported = repo.get(&owner, rows[0].id).await.unwrap().unwrap();
    assert!(
        lifecycle::live(&repo, &reader, &owner, &imported)
            .await
            .unwrap()
    );
    let unchanged = repo
        .get_own_by_foreign_id(
            &owner,
            ImportSource::Notion,
            "cccccccccccccccccccccccccccccccc",
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(unchanged.status, ImportStatus::Imported);
    assert_eq!(unchanged.team_id, Some(team));
    assert_eq!(unchanged.entity_id, Some(document.to_string()));
}

struct ConcurrentFacts {
    barrier: tokio::sync::Barrier,
    current: std::sync::atomic::AtomicUsize,
    maximum: std::sync::atomic::AtomicUsize,
}

impl ImportedTargetReader for ConcurrentFacts {
    async fn target_exists(&self, _: ImportedTarget) -> anyhow::Result<bool> {
        let count = self
            .current
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            + 1;
        self.maximum
            .fetch_max(count, std::sync::atomic::Ordering::SeqCst);
        self.barrier.wait().await;
        self.current
            .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        Ok(true)
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn planning_checks_targets_with_bounded_concurrency_instead_of_serial_round_trips(
    pool: PgPool,
) {
    let repo = PgImportRepo::new(pool.clone());
    let owner = member(&pool, "concurrent-owner", Uuid::now_v7()).await;
    let plan: Vec<_> = (0..24)
        .map(|n| PlanRow {
            kind: ImportKind::Page,
            foreign_id: format!("concurrent-{n}"),
            parent_foreign_id: None,
            metadata: serde_json::json!({"plan":{"decision":"copy","shared":false}}),
        })
        .collect();
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    for row in rows {
        repo.claim_importing(&owner, &[row.id], &[], None)
            .await
            .unwrap();
        repo.mark_imported(&owner, row.id, &Uuid::now_v7().to_string(), "md", None)
            .await
            .unwrap();
    }
    let reader = ConcurrentFacts {
        barrier: tokio::sync::Barrier::new(8),
        current: 0.into(),
        maximum: 0.into(),
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        lifecycle::replace_plan(&repo, &reader, &owner, ImportSource::Notion, &plan),
    )
    .await;
    assert!(
        result.is_ok(),
        "eight reads must be able to reach the barrier concurrently"
    );
    assert!(result.unwrap().unwrap().is_empty());
    assert_eq!(reader.maximum.load(std::sync::atomic::Ordering::SeqCst), 8);
}
