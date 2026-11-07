use super::*;

const FOLDER: &str = "0190f5a0-0000-7000-8000-000000000001";
const SUBFOLDER: &str = "0190f5a0-0000-7000-8000-000000000002";

/// A folder shared with a channel, and a subfolder inside it.
async fn shared_folders(pool: &PgPool) {
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Clients', $3), ($2, 'Acme', $3)"#,
        FOLDER,
        SUBFOLDER,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE "Project" SET "parentId" = $1 WHERE id = $2"#,
        FOLDER,
        SUBFOLDER
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'project', 'channel-1', 'channel', 'edit')",
        Uuid::parse_str(FOLDER).unwrap(),
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn grants(pool: &PgPool, form: FormId) -> Vec<(String, Option<String>)> {
    sqlx::query!(
        "SELECT source_id, granted_from_project_id FROM entity_access WHERE entity_id = $1 AND entity_type = 'form' ORDER BY source_id",
        form.into_uuid(),
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.source_id, row.granted_from_project_id))
    .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_form_in_a_folder_holds_the_grants_of_every_folder_above_it(pool: PgPool) {
    let table = insert_table(&pool).await;
    shared_folders(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    repo.create_form(&form, &layout_over(&table), false)
        .await
        .unwrap();

    assert!(repo.move_form(form.id, Some(SUBFOLDER)).await.unwrap());
    assert_eq!(
        repo.forms_by_ids(&[form.id]).await.unwrap()[0]
            .project_id
            .as_deref(),
        Some(SUBFOLDER)
    );
    assert_eq!(
        grants(&pool, form.id).await,
        vec![
            ("channel-1".to_string(), Some(FOLDER.to_string())),
            (OWNER.to_string(), None),
        ]
    );

    assert!(repo.move_form(form.id, None).await.unwrap());
    assert_eq!(
        repo.forms_by_ids(&[form.id]).await.unwrap()[0].project_id,
        None
    );
    assert_eq!(
        grants(&pool, form.id).await,
        vec![(OWNER.to_string(), None)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_trashed_form_stays_where_it_was_and_a_purged_folder_frees_a_form(pool: PgPool) {
    let table = insert_table(&pool).await;
    shared_folders(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    repo.create_form(&form, &layout_over(&table), false)
        .await
        .unwrap();
    repo.move_form(form.id, Some(SUBFOLDER)).await.unwrap();

    repo.trash_form(form.id, at(10)).await.unwrap();
    assert!(!repo.move_form(form.id, None).await.unwrap());
    assert!(!repo.move_form(FormId::generate(), None).await.unwrap());
    let stored = repo.form(form.id).await.unwrap().unwrap();
    assert_eq!(stored.form.project_id.as_deref(), Some(SUBFOLDER));

    sqlx::query!(r#"DELETE FROM "Project" WHERE id = $1"#, SUBFOLDER)
        .execute(&pool)
        .await
        .unwrap();
    let stored = repo.form(form.id).await.unwrap().unwrap();
    assert_eq!(stored.form.project_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn trashing_its_folder_returns_a_form_to_the_root_without_its_grants(pool: PgPool) {
    let table = insert_table(&pool).await;
    shared_folders(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    repo.create_form(&form, &layout_over(&table), false)
        .await
        .unwrap();
    repo.move_form(form.id, Some(SUBFOLDER)).await.unwrap();

    repo.unfile_from_projects(&[FOLDER.to_string()])
        .await
        .unwrap();
    assert_eq!(
        repo.forms_by_ids(&[form.id]).await.unwrap()[0]
            .project_id
            .as_deref(),
        Some(SUBFOLDER)
    );

    repo.unfile_from_projects(&[SUBFOLDER.to_string()])
        .await
        .unwrap();
    assert_eq!(
        repo.forms_by_ids(&[form.id]).await.unwrap()[0].project_id,
        None
    );
    assert_eq!(
        grants(&pool, form.id).await,
        vec![(OWNER.to_string(), None)]
    );
}
