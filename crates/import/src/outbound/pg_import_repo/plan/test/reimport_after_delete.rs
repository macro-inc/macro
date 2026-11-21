//! Re-importing an object must not reuse an imported ledger entry whose copy was deleted.

mod facts;

use super::*;
use crate::domain::ports::{ImportedTarget, ImportedTargetReader};
use crate::domain::service::lifecycle;

// Test adapter for the host's owning-domain lifecycle reads. The production
// adapter uses document/project/database service ports, never import-owned SQL.
struct Targets(PgPool);

impl ImportedTargetReader for Targets {
    async fn target_exists(&self, target: ImportedTarget) -> anyhow::Result<bool> {
        let live = match target {
            ImportedTarget::Document(id) => sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM "Document" WHERE id = $1 AND "deletedAt" IS NULL) AS "live!""#,
                id.to_string(),
            ).fetch_one(&self.0).await?,
            ImportedTarget::Folder(id) => sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM "Project" WHERE id = $1 AND "deletedAt" IS NULL) AS "live!""#,
                id.to_string(),
            ).fetch_one(&self.0).await?,
            ImportedTarget::Database(id) => sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM database_entities WHERE database_id = $1 AND trashed_at IS NULL) AS "live!""#,
                id,
            ).fetch_one(&self.0).await?,
            ImportedTarget::Initiative(id) => sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM initiative WHERE id = $1)", id).fetch_one(&self.0).await?.unwrap_or(false),
        };
        Ok(live)
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_team_owner_soft_deleted(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "reimport-owner", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({
            "title": "Imported page",
            "plan": { "decision": "copy", "path": [], "shared": true, "shareable": true }
        }),
    }];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let import_id = rows[0].id;
    let document = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType")
           VALUES ($1, 'Imported page', $2, 'md')"#,
        document,
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &[import_id], &[import_id], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document, "md", None)
        .await
        .unwrap();

    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = NOW() WHERE id = $1"#,
        document,
    )
    .execute(&pool)
    .await
    .unwrap();

    let replanned = lifecycle::replace_plan(
        &repo,
        &Targets(pool.clone()),
        &owner,
        ImportSource::Notion,
        &plan,
    )
    .await
    .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
    assert_ne!(
        replanned[0].id, import_id,
        "a re-import gets fresh write identities"
    );
    assert_eq!(replanned[0].entity_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_team_owner_hard_deleted(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "reimport-owner", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({
            "title": "Imported page",
            "plan": { "decision": "copy", "path": [], "shared": true, "shareable": true }
        }),
    }];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let import_id = rows[0].id;
    let document = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType")
           VALUES ($1, 'Imported page', $2, 'md')"#,
        document,
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &[import_id], &[import_id], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document, "md", None)
        .await
        .unwrap();

    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, document,)
        .execute(&pool)
        .await
        .unwrap();

    let replanned = lifecycle::replace_plan(
        &repo,
        &Targets(pool.clone()),
        &owner,
        ImportSource::Notion,
        &plan,
    )
    .await
    .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
    assert_ne!(
        replanned[0].id, import_id,
        "a re-import gets fresh write identities"
    );
    assert_eq!(replanned[0].entity_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_teammate_soft_deleted_plan(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "reimport-owner", team).await;
    let teammate = member(&pool, "reimport-teammate", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({
            "title": "Imported page",
            "plan": { "decision": "copy", "path": [], "shared": true, "shareable": true }
        }),
    }];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let import_id = rows[0].id;
    let document = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType")
           VALUES ($1, 'Imported page', $2, 'md')"#,
        document,
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &[import_id], &[import_id], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document, "md", None)
        .await
        .unwrap();

    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = NOW() WHERE id = $1"#,
        document,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(
        lifecycle::team_copies(
            &repo,
            &Targets(pool.clone()),
            &teammate,
            &["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()]
        )
        .await
        .unwrap()
        .is_empty(),
        "planning must not advertise a deleted team copy as already imported",
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_teammate_hard_deleted_plan(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "reimport-owner", team).await;
    let teammate = member(&pool, "reimport-teammate", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({
            "title": "Imported page",
            "plan": { "decision": "copy", "path": [], "shared": true, "shareable": true }
        }),
    }];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let import_id = rows[0].id;
    let document = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType")
           VALUES ($1, 'Imported page', $2, 'md')"#,
        document,
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &[import_id], &[import_id], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document, "md", None)
        .await
        .unwrap();

    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, document,)
        .execute(&pool)
        .await
        .unwrap();

    assert!(
        lifecycle::team_copies(
            &repo,
            &Targets(pool.clone()),
            &teammate,
            &["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()]
        )
        .await
        .unwrap()
        .is_empty(),
        "planning must not advertise a deleted team copy as already imported",
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_teammate_soft_deleted_claim(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "reimport-owner", team).await;
    let teammate = member(&pool, "reimport-teammate", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({
            "title": "Imported page",
            "plan": { "decision": "copy", "path": [], "shared": true, "shareable": true }
        }),
    }];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let import_id = rows[0].id;
    let document = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType")
           VALUES ($1, 'Imported page', $2, 'md')"#,
        document,
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &[import_id], &[import_id], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document, "md", None)
        .await
        .unwrap();

    let rows = repo
        .replace_plan(&teammate, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let teammate_import = rows[0].id;
    assert_eq!(
        lifecycle::team_copies(
            &repo,
            &Targets(pool.clone()),
            &teammate,
            &["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()]
        )
        .await
        .unwrap()
        .len(),
        1,
        "the copy was live during planning",
    );

    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = NOW() WHERE id = $1"#,
        document,
    )
    .execute(&pool)
    .await
    .unwrap();

    repo.claim_importing(
        &teammate,
        &[teammate_import],
        &[teammate_import],
        Some(team),
    )
    .await
    .unwrap();
    assert_eq!(
        lifecycle::claim_team_object(
            &repo,
            &Targets(pool.clone()),
            &teammate,
            teammate_import,
            team,
            true
        )
        .await
        .unwrap(),
        TeamClaim::Held,
        "a deleted team copy must release its claim so a teammate can write again",
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_teammate_hard_deleted_claim(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "reimport-owner", team).await;
    let teammate = member(&pool, "reimport-teammate", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({
            "title": "Imported page",
            "plan": { "decision": "copy", "path": [], "shared": true, "shareable": true }
        }),
    }];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let import_id = rows[0].id;
    let document = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType")
           VALUES ($1, 'Imported page', $2, 'md')"#,
        document,
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &[import_id], &[import_id], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document, "md", None)
        .await
        .unwrap();

    let rows = repo
        .replace_plan(&teammate, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let teammate_import = rows[0].id;
    assert_eq!(
        lifecycle::team_copies(
            &repo,
            &Targets(pool.clone()),
            &teammate,
            &["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()]
        )
        .await
        .unwrap()
        .len(),
        1,
        "the copy was live during planning",
    );

    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, document,)
        .execute(&pool)
        .await
        .unwrap();

    repo.claim_importing(
        &teammate,
        &[teammate_import],
        &[teammate_import],
        Some(team),
    )
    .await
    .unwrap();
    assert_eq!(
        lifecycle::claim_team_object(
            &repo,
            &Targets(pool.clone()),
            &teammate,
            teammate_import,
            team,
            true
        )
        .await
        .unwrap(),
        TeamClaim::Held,
        "a deleted team copy must release its claim so a teammate can write again",
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_personal_soft_deleted(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "reimport-owner", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({
            "title": "Imported page",
            "plan": { "decision": "copy", "path": [], "shared": false, "shareable": true }
        }),
    }];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let import_id = rows[0].id;
    let document = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType")
           VALUES ($1, 'Imported page', $2, 'md')"#,
        document,
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &[import_id], &[], None)
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document, "md", None)
        .await
        .unwrap();

    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = NOW() WHERE id = $1"#,
        document,
    )
    .execute(&pool)
    .await
    .unwrap();

    let replanned = lifecycle::replace_plan(
        &repo,
        &Targets(pool.clone()),
        &owner,
        ImportSource::Notion,
        &plan,
    )
    .await
    .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
    assert_ne!(
        replanned[0].id, import_id,
        "a re-import gets fresh write identities"
    );
    assert_eq!(replanned[0].entity_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_personal_hard_deleted(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "reimport-owner", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({
            "title": "Imported page",
            "plan": { "decision": "copy", "path": [], "shared": false, "shareable": true }
        }),
    }];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let import_id = rows[0].id;
    let document = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType")
           VALUES ($1, 'Imported page', $2, 'md')"#,
        document,
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &[import_id], &[], None)
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document, "md", None)
        .await
        .unwrap();

    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, document,)
        .execute(&pool)
        .await
        .unwrap();

    let replanned = lifecycle::replace_plan(
        &repo,
        &Targets(pool.clone()),
        &owner,
        ImportSource::Notion,
        &plan,
    )
    .await
    .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
    assert_ne!(
        replanned[0].id, import_id,
        "a re-import gets fresh write identities"
    );
    assert_eq!(replanned[0].entity_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_root_soft_deleted(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "reimport-owner", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({
            "title": "Imported page",
            "plan": { "decision": "copy", "path": [], "shared": false, "shareable": true }
        }),
    }];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let import_id = rows[0].id;
    let document = Uuid::now_v7().to_string();
    let root = Uuid::now_v7();
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Notion', $2)"#,
        root.to_string(),
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.set_root_folder(&owner, root).await.unwrap();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType", "projectId")
           VALUES ($1, 'Imported page', $2, 'md', $3)"#,
        document,
        owner.as_ref(),
        root.to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &[import_id], &[], None)
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document, "md", None)
        .await
        .unwrap();

    // Folder deletion applies the same lifecycle operation to its contents.
    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = NOW() WHERE id = $1"#,
        document,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE "Project" SET "deletedAt" = NOW() WHERE id = $1"#,
        root.to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let replanned = lifecycle::replace_plan(
        &repo,
        &Targets(pool.clone()),
        &owner,
        ImportSource::Notion,
        &plan,
    )
    .await
    .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
    assert_ne!(
        replanned[0].id, import_id,
        "a re-import gets fresh write identities"
    );
    assert_eq!(replanned[0].entity_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_root_hard_deleted(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "reimport-owner", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({
            "title": "Imported page",
            "plan": { "decision": "copy", "path": [], "shared": false, "shareable": true }
        }),
    }];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let import_id = rows[0].id;
    let document = Uuid::now_v7().to_string();
    let root = Uuid::now_v7();
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Notion', $2)"#,
        root.to_string(),
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.set_root_folder(&owner, root).await.unwrap();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType", "projectId")
           VALUES ($1, 'Imported page', $2, 'md', $3)"#,
        document,
        owner.as_ref(),
        root.to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &[import_id], &[], None)
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document, "md", None)
        .await
        .unwrap();

    // Folder deletion applies the same lifecycle operation to its contents.
    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, document,)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(r#"DELETE FROM "Project" WHERE id = $1"#, root.to_string(),)
        .execute(&pool)
        .await
        .unwrap();

    let replanned = lifecycle::replace_plan(
        &repo,
        &Targets(pool.clone()),
        &owner,
        ImportSource::Notion,
        &plan,
    )
    .await
    .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
    assert_ne!(
        replanned[0].id, import_id,
        "a re-import gets fresh write identities"
    );
    assert_eq!(replanned[0].entity_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_deletion_preserves_a_live_writers_lease_and_claim(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "lease-owner", team).await;
    let teammate = member(&pool, "lease-teammate", team).await;
    let plan = [PlanRow {
        kind: ImportKind::Page,
        foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        parent_foreign_id: None,
        metadata: serde_json::json!({"plan": {"decision": "copy", "shared": true}}),
    }];
    let owners = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let teammates = repo
        .replace_plan(&teammate, ImportSource::Notion, &plan)
        .await
        .unwrap();
    writing(&repo, &owner, Duration::from_secs(90)).await;
    repo.claim_importing(&owner, &[owners[0].id], &[owners[0].id], Some(team))
        .await
        .unwrap();
    repo.claim_importing(
        &teammate,
        &[teammates[0].id],
        &[teammates[0].id],
        Some(team),
    )
    .await
    .unwrap();

    assert_eq!(
        lifecycle::claim_team_object(
            &repo,
            &Targets(pool.clone()),
            &teammate,
            teammates[0].id,
            team,
            true
        )
        .await
        .unwrap(),
        TeamClaim::Waiting {
            holder: owners[0].id
        },
        "a missing target is normal while its live holder is still writing",
    );
    assert!(
        !repo
            .renew_deleted_copy(&teammate, owners[0].id, "unwritten", None, || async {
                panic!("active claims must not read targets")
            })
            .await
            .unwrap()
    );
    assert_eq!(
        repo.get(&owner, owners[0].id)
            .await
            .unwrap()
            .unwrap()
            .team_id,
        Some(team)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_deletion_renews_once_and_preserves_children_without_old_markers(
    pool: PgPool,
) {
    use crate::domain::models::{WrittenKind, WrittenObject};
    use crate::domain::ports::WrittenObjects;

    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "generation-owner", team).await;
    let plan = [
        PlanRow {
            kind: ImportKind::Page,
            foreign_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
            parent_foreign_id: None,
            metadata: serde_json::json!({"plan": {"decision": "copy", "shared": true}}),
        },
        PlanRow {
            kind: ImportKind::Page,
            foreign_id: "cccccccccccccccccccccccccccccccc".to_string(),
            parent_foreign_id: Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()),
            metadata: serde_json::json!({"plan": {"decision": "copy", "shared": false}}),
        },
    ];
    let rows = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let parent = rows[0].id;
    let child = rows[1].id;
    repo.claim_importing(&owner, &[parent, child], &[parent], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, parent, "deleted-parent", "project", None)
        .await
        .unwrap();
    repo.mark_imported(&owner, child, "live-child", "md", None)
        .await
        .unwrap();
    repo.record_written(
        &owner,
        &[WrittenObject::own(
            parent,
            WrittenKind::Folder,
            Uuid::now_v7(),
        )],
    )
    .await
    .unwrap();

    let (first, second) = tokio::join!(
        repo.renew_deleted_copy(&owner, parent, "deleted-parent", None, || async {
            Ok(true)
        }),
        repo.renew_deleted_copy(&owner, parent, "deleted-parent", None, || async {
            Ok(true)
        }),
    );
    assert_ne!(
        first.unwrap(),
        second.unwrap(),
        "only one stale observation renews the generation"
    );
    let renewed = repo
        .get_own_by_foreign_id(
            &owner,
            ImportSource::Notion,
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        )
        .await
        .unwrap()
        .unwrap();
    assert_ne!(renewed.id, parent);
    assert_eq!(renewed.status, ImportStatus::Staged);
    assert_eq!(renewed.team_id, None);
    assert!(
        repo.written(&owner, &[parent, renewed.id])
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        repo.get(&owner, child).await.unwrap().unwrap().parent_id,
        Some(renewed.id)
    );

    let staged = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    assert_eq!(
        staged[0].id, renewed.id,
        "replanning retains an imported child's new ancestor"
    );
    assert_eq!(
        repo.get(&owner, child).await.unwrap().unwrap().parent_id,
        Some(renewed.id)
    );
}

struct UnavailableTargets;

impl ImportedTargetReader for UnavailableTargets {
    async fn target_exists(&self, _: ImportedTarget) -> anyhow::Result<bool> {
        anyhow::bail!("temporary lifecycle read failure")
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reimport_after_a_transient_read_failure_preserves_the_finished_claim(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let owner = member(&pool, "unavailable-owner", team).await;
    let teammate = member(&pool, "unavailable-teammate", team).await;
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
    let document = Uuid::now_v7().to_string();
    repo.claim_importing(&owner, &[import_id], &[import_id], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, import_id, &document, "md", None)
        .await
        .unwrap();

    assert!(
        lifecycle::team_copies(
            &repo,
            &UnavailableTargets,
            &teammate,
            &["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()]
        )
        .await
        .is_err()
    );
    let unchanged = repo.get(&owner, import_id).await.unwrap().unwrap();
    assert_eq!(unchanged.status, ImportStatus::Imported);
    assert_eq!(unchanged.team_id, Some(team));
    assert_eq!(unchanged.entity_id.as_deref(), Some(document.as_str()));
}
