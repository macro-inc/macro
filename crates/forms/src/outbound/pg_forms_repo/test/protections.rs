use super::*;
use crate::domain::models::FormCreation;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn managed_column_cannot_be_deleted_while_its_form_exists(pool: PgPool) {
    let table = insert_table(&pool).await;
    let form = form_over(&table);
    let repository = PgFormsRepo::new(pool.clone());
    assert_eq!(
        repository
            .create_form(&form, &layout_over(&table), false)
            .await
            .unwrap(),
        FormCreation::Created
    );

    let deletion = sqlx::query!(
        "DELETE FROM database_columns WHERE id = $1",
        table.second.into_uuid()
    )
    .execute(&pool)
    .await;
    assert!(deletion.is_err(), "the managed column must remain intact");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn managed_column_type_is_protected_but_name_and_position_can_change(pool: PgPool) {
    let table = insert_table(&pool).await;
    let form = form_over(&table);
    let repository = PgFormsRepo::new(pool.clone());
    assert_eq!(
        repository
            .create_form(&form, &layout_over(&table), false)
            .await
            .unwrap(),
        FormCreation::Created
    );
    let result = sqlx::query!(
        "UPDATE property_definitions SET data_type = 'NUMBER' WHERE id = (SELECT property_definition_id FROM database_columns WHERE id = $1)",
        table.second.into_uuid()
    ).execute(&pool).await;
    assert!(result.is_err());
    sqlx::query!(
        "UPDATE database_columns SET display_name = 'When', position = '90' WHERE id = $1",
        table.second.into_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_form_reserves_its_table_until_permanently_deleted(pool: PgPool) {
    let table = insert_table(&pool).await;
    let form = form_over(&table);
    let repository = PgFormsRepo::new(pool.clone());
    assert_eq!(
        repository
            .create_form(&form, &layout_over(&table), false)
            .await
            .unwrap(),
        FormCreation::Created
    );
    let other = form_over(&table);
    assert_eq!(
        repository
            .create_form(&other, &layout_over(&table), false)
            .await
            .unwrap(),
        FormCreation::TableOccupied
    );
    sqlx::query!(
        "UPDATE forms SET trashed_at = now() WHERE id = $1",
        form.id.into_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repository
            .create_form(&other, &layout_over(&table), false)
            .await
            .unwrap(),
        FormCreation::TableOccupied
    );
    let deletion = sqlx::query!(
        "DELETE FROM database_columns WHERE id = $1",
        table.second.into_uuid()
    )
    .execute(&pool)
    .await;
    assert!(deletion.is_err());
    sqlx::query!("DELETE FROM forms WHERE id = $1", form.id.into_uuid())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        repository
            .create_form(&other, &layout_over(&table), false)
            .await
            .unwrap(),
        FormCreation::Created
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_form_preserves_response_rows_and_releases_column_protection(pool: PgPool) {
    let table = insert_table(&pool).await;
    let form = form_over(&table);
    let repository = PgFormsRepo::new(pool.clone());
    assert_eq!(
        repository
            .create_form(&form, &layout_over(&table), false)
            .await
            .unwrap(),
        FormCreation::Created
    );
    let row = insert_row(&pool, table.table, "80").await;
    sqlx::query!("DELETE FROM forms WHERE id = $1", form.id.into_uuid())
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM database_rows WHERE id = $1) AS \"exists!\"",
            row.into_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );
    assert_eq!(
        sqlx::query!(
            "DELETE FROM database_columns WHERE id = $1",
            table.second.into_uuid()
        )
        .execute(&pool)
        .await
        .unwrap()
        .rows_affected(),
        1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_database_can_cascade_protected_columns_and_form(pool: PgPool) {
    let table = insert_table(&pool).await;
    let form = form_over(&table);
    let repository = PgFormsRepo::new(pool.clone());
    assert_eq!(
        repository
            .create_form(&form, &layout_over(&table), false)
            .await
            .unwrap(),
        FormCreation::Created
    );
    sqlx::query!(
        "DELETE FROM database_entities WHERE database_id = $1",
        table.database.into_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repository.form(form.id).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn both_metadata_columns_are_protected_and_table_deletion_still_cascades(pool: PgPool) {
    let table = insert_table(&pool).await;
    let respondent = insert_column(
        &pool,
        table.database.into_uuid(),
        table.table.into_uuid(),
        "Respondent",
    )
    .await;
    sqlx::query!(
        "UPDATE property_definitions SET data_type = 'ENTITY', specific_entity_type = 'USER' WHERE id = (SELECT property_definition_id FROM database_columns WHERE id = $1)",
        respondent.into_uuid()
    ).execute(&pool).await.unwrap();
    let mut form = form_over(&table);
    form.respondent_column_id = Some(respondent);
    let repository = PgFormsRepo::new(pool.clone());
    assert_eq!(
        repository
            .create_form(&form, &layout_over(&table), false)
            .await
            .unwrap(),
        FormCreation::Created
    );
    for column in [table.second, respondent] {
        assert!(
            sqlx::query!(
                "DELETE FROM database_columns WHERE id = $1",
                column.into_uuid()
            )
            .execute(&pool)
            .await
            .is_err()
        );
        assert!(sqlx::query!(
            "UPDATE property_definitions SET is_multi_select = true WHERE id = (SELECT property_definition_id FROM database_columns WHERE id = $1)",
            column.into_uuid()
        ).execute(&pool).await.is_err());
    }
    sqlx::query!(
        "DELETE FROM database_tables WHERE id = $1",
        table.table.into_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repository.form(form.id).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn metadata_retyped_after_discovery_refuses_creation_without_leaving_a_form(pool: PgPool) {
    let table = insert_table(&pool).await;
    let form = form_over(&table);
    sqlx::query!(
        "UPDATE property_definitions SET data_type = 'STRING' WHERE id = (SELECT property_definition_id FROM database_columns WHERE id = $1)",
        table.second.into_uuid()
    ).execute(&pool).await.unwrap();
    let repository = PgFormsRepo::new(pool.clone());
    assert_eq!(
        repository
            .create_form(&form, &layout_over(&table), false)
            .await
            .unwrap(),
        FormCreation::SchemaChanged
    );
    assert!(repository.form(form.id).await.unwrap().is_none());
    assert!(!repository.table_has_form(table.table).await.unwrap());
}

#[sqlx::test(migrations = false)]
async fn protection_upgrade_refuses_legacy_retyped_metadata_without_freezing_it(pool: PgPool) {
    let before_protections = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < 20261006165503)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    before_protections.run(&pool).await.unwrap();
    let table = insert_table(&pool).await;
    let form = form_over(&table);
    sqlx::query!(
        "INSERT INTO forms (id, name, owner_id, database_id, table_id, submitted_column_id) VALUES ($1, $2, $3, $4, $5, $6)",
        form.id.into_uuid(), form.name, OWNER, table.database.into_uuid(), table.table.into_uuid(), table.second.into_uuid()
    ).execute(&pool).await.unwrap();
    sqlx::query!(
        "UPDATE property_definitions SET data_type = 'STRING' WHERE id = (SELECT property_definition_id FROM database_columns WHERE id = $1)",
        table.second.into_uuid()
    ).execute(&pool).await.unwrap();
    let error = MACRO_DB_MIGRATIONS.run(&pool).await.unwrap_err();
    assert!(error.to_string().contains("Restore Submitted"), "{error}");
    // A failed upgrade must leave the old column repairable; retry then succeeds.
    sqlx::query!(
        "UPDATE property_definitions SET data_type = 'DATE' WHERE id = (SELECT property_definition_id FROM database_columns WHERE id = $1)",
        table.second.into_uuid()
    ).execute(&pool).await.unwrap();
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM database_column_protections WHERE column_id = $1",
            table.second.into_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(2)
    );
}
