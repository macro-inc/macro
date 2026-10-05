//! Whether a form goes by its database's name is recorded at creation and
//! read back as stored; stamping a form for a change kept elsewhere touches
//! nothing but its `updated_at`.

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn whether_a_form_goes_by_its_databases_name_is_read_back_as_created(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let standalone = form_over(&table);
    repo.create_form(&standalone, &layout_over(&table), true)
        .await
        .unwrap();
    let attached = Form {
        id: FormId::new(),
        name: "Party RSVP".into(),
        ..form_over(&table)
    };
    repo.create_form(&attached, &FormLayout { sections: vec![] }, false)
        .await
        .unwrap();

    assert_eq!(
        repo.form(standalone.id).await.unwrap(),
        Some(StoredForm {
            form: standalone.clone(),
            trashed_at: None,
            name_follows_database: true,
        })
    );
    assert_eq!(
        repo.form(attached.id).await.unwrap(),
        Some(StoredForm {
            form: attached.clone(),
            trashed_at: None,
            name_follows_database: false,
        })
    );
    assert_eq!(
        repo.forms_with_database_names(&[standalone.id, attached.id, FormId::new()])
            .await
            .unwrap(),
        vec![standalone.id]
    );

    // A trashed form still says what it goes by.
    repo.trash_form(standalone.id, at(11)).await.unwrap();
    assert_eq!(
        repo.forms_with_database_names(&[standalone.id])
            .await
            .unwrap(),
        vec![standalone.id]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn touching_a_live_form_stamps_only_its_updated_at(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    repo.create_form(&form, &layout_over(&table), true)
        .await
        .unwrap();

    assert_eq!(
        repo.touch_form(form.id, at(12)).await.unwrap(),
        Some(Form {
            updated_at: at(12),
            ..form.clone()
        })
    );
    assert_eq!(
        repo.form(form.id).await.unwrap(),
        Some(StoredForm {
            form: Form {
                updated_at: at(12),
                ..form.clone()
            },
            trashed_at: None,
            name_follows_database: true,
        })
    );

    repo.trash_form(form.id, at(13)).await.unwrap();
    assert_eq!(repo.touch_form(form.id, at(14)).await.unwrap(), None);
    assert_eq!(repo.touch_form(FormId::new(), at(14)).await.unwrap(), None);
}
