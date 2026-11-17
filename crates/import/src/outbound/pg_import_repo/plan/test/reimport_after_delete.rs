//! Re-importing an object must not reuse an imported ledger entry whose copy was deleted.

use super::*;

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

    let replanned = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
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

    let replanned = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
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
        repo.team_copies(&teammate, &["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()])
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
        repo.team_copies(&teammate, &["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()])
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

    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = NOW() WHERE id = $1"#,
        document,
    )
    .execute(&pool)
    .await
    .unwrap();

    let rows = repo
        .replace_plan(&teammate, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let teammate_import = rows[0].id;
    repo.claim_importing(
        &teammate,
        &[teammate_import],
        &[teammate_import],
        Some(team),
    )
    .await
    .unwrap();
    assert_eq!(
        repo.claim_team_object(&teammate, teammate_import, team, true)
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

    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, document,)
        .execute(&pool)
        .await
        .unwrap();

    let rows = repo
        .replace_plan(&teammate, ImportSource::Notion, &plan)
        .await
        .unwrap();
    let teammate_import = rows[0].id;
    repo.claim_importing(
        &teammate,
        &[teammate_import],
        &[teammate_import],
        Some(team),
    )
    .await
    .unwrap();
    assert_eq!(
        repo.claim_team_object(&teammate, teammate_import, team, true)
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

    let replanned = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
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

    let replanned = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
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

    let replanned = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
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

    let replanned = repo
        .replace_plan(&owner, ImportSource::Notion, &plan)
        .await
        .unwrap();
    assert_eq!(
        replanned.len(),
        1,
        "a deleted copy must be available to import again"
    );
    assert_eq!(replanned[0].status, ImportStatus::Staged);
}
