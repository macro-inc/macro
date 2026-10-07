use super::*;
use crate::domain::drafts::FormDraftRepository;
use crate::{
    domain::authoring::{ports::AuthoringSettings, *},
    outbound::authoring_settings::PgAuthoringSettings,
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn authoring_settings_refuse_stale_review(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repository = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    let layout = layout_over(&table);
    repository.create_form(&form, &layout, false).await.unwrap();
    repository.enable_draft(form.id).await.unwrap();
    repository
        .project_layout(
            form.id,
            &layout,
            None,
            &[1, 2],
            at(10),
            Some(Audience::Members),
        )
        .await
        .unwrap();
    let snapshot = Snapshot {
        form: repository.form(form.id).await.unwrap().unwrap().form,
        layout,
        document: vec![],
        revision: vec![1, 2],
        columns: vec![],
        table_version: 0,
        projected: true,
        access: models_forms::FormAccess::Owner,
        grants: vec![],
    };
    let version = sqlx::query_scalar!(
        "SELECT version FROM database_tables WHERE id = $1",
        table.table.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let snapshot = Snapshot {
        table_version: version,
        ..snapshot
    };
    let settings = PgAuthoringSettings::new(pool.clone());
    settings
        .settings(
            &snapshot,
            &UpdateForm {
                audience: Some(Audience::Public),
                status: Some(FormStatus::Closed),
                ..Default::default()
            },
            &[],
            true,
            true,
        )
        .await
        .unwrap();
    assert!(matches!(
        settings
            .settings(
                &snapshot,
                &UpdateForm {
                    status: Some(FormStatus::Open),
                    ..Default::default()
                },
                &[],
                true,
                true
            )
            .await,
        Err(AuthoringError {
            code: Code::ConcurrentFieldChange,
            ..
        })
    ));
    let saved = repository.form(form.id).await.unwrap().unwrap().form;
    assert_eq!(saved.audience, Audience::Public);
    assert_eq!(saved.status, FormStatus::Closed);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn closing_an_unprojected_draft_keeps_the_last_valid_projection(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repository = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    let layout = layout_over(&table);
    repository.create_form(&form, &layout, false).await.unwrap();
    repository.enable_draft(form.id).await.unwrap();
    repository
        .project_layout(
            form.id,
            &layout,
            None,
            &[1, 2],
            at(10),
            Some(Audience::Members),
        )
        .await
        .unwrap();
    let snapshot = Snapshot {
        form: repository.form(form.id).await.unwrap().unwrap().form,
        layout: layout.clone(),
        document: vec![],
        revision: vec![3, 4],
        columns: vec![],
        table_version: sqlx::query_scalar!(
            "SELECT version FROM database_tables WHERE id = $1",
            table.table.into_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        projected: false,
        access: models_forms::FormAccess::Owner,
        grants: vec![],
    };
    PgAuthoringSettings::new(pool.clone())
        .settings(
            &snapshot,
            &UpdateForm {
                status: Some(FormStatus::Closed),
                ..Default::default()
            },
            &[],
            true,
            true,
        )
        .await
        .unwrap();
    let saved = repository.form(form.id).await.unwrap().unwrap();
    assert_eq!(saved.form.status, FormStatus::Closed);
    assert_eq!(
        repository
            .draft_state(form.id)
            .await
            .unwrap()
            .unwrap()
            .revision,
        Some(vec![1, 2])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn review_regression_closing_after_row_traffic_keeps_the_last_valid_projection(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repository = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    let layout = layout_over(&table);
    repository.create_form(&form, &layout, false).await.unwrap();
    repository.enable_draft(form.id).await.unwrap();
    repository
        .project_layout(
            form.id,
            &layout,
            None,
            &[1, 2],
            at(10),
            Some(Audience::Members),
        )
        .await
        .unwrap();
    let snapshot = Snapshot {
        form: repository.form(form.id).await.unwrap().unwrap().form,
        layout: layout.clone(),
        document: vec![],
        revision: vec![3, 4],
        columns: vec![],
        table_version: sqlx::query_scalar!(
            "SELECT version FROM database_tables WHERE id = $1",
            table.table.into_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        projected: false,
        access: models_forms::FormAccess::Owner,
        grants: vec![],
    };
    // A respondent write has advanced the table since this snapshot.
    let snapshot = Snapshot {
        table_version: snapshot.table_version - 1,
        ..snapshot
    };
    assert!(
        matches!(
            PgAuthoringSettings::new(pool.clone())
                .settings(
                    &snapshot,
                    &UpdateForm {
                        tally_visible: Some(true),
                        ..Default::default()
                    },
                    &[],
                    true,
                    true
                )
                .await,
            Err(AuthoringError {
                code: Code::ConcurrentFieldChange,
                ..
            })
        ),
        "exposing changes still require the observed table version"
    );
    PgAuthoringSettings::new(pool.clone())
        .settings(
            &snapshot,
            &UpdateForm {
                status: Some(FormStatus::Closed),
                ..Default::default()
            },
            &[],
            true,
            false,
        )
        .await
        .unwrap();
    let saved = repository.form(form.id).await.unwrap().unwrap();
    assert_eq!(saved.form.status, FormStatus::Closed);
    assert_eq!(
        repository
            .draft_state(form.id)
            .await
            .unwrap()
            .unwrap()
            .revision,
        Some(vec![1, 2])
    );
}
