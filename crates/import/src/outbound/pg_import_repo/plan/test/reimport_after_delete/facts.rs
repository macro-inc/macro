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
