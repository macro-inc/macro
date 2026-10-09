use super::*;
use crate::domain::drafts::{FormDraftRepository, LayoutDraftState, LayoutProjection};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_projection_commits_its_layout_and_revision_together(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repository = PgFormsRepo::new(pool);
    let form = Form {
        id: FormId::new(),
        name: "Interview screening".into(),
        description: "".into(),
        owner_id: OWNER.into(),
        database_id: table.database,
        table_id: table.table,
        submitted_column_id: None,
        respondent_column_id: None,
        audience: Audience::Members,
        tally_visible: false,
        status: FormStatus::Open,
        closes_at: None,
        confirmation_message: "Thanks".into(),
        created_at: at(9),
        updated_at: at(9),
    };
    let layout = FormLayout {
        sections: vec![FormSection::Questions {
            id: FormSectionId::new(),
            title: "About you".into(),
            description: "".into(),
            questions: vec![QuestionLayout {
                id: FormQuestionId::new(),
                column: table.first,
                help_text: "Your name".into(),
                required: true,
                widget: None,
            }],
        }],
    };
    repository
        .create_form(&form, &FormLayout { sections: vec![] }, false)
        .await
        .unwrap();
    assert!(repository.enable_draft(form.id).await.unwrap());
    assert!(repository.enable_draft(form.id).await.unwrap());
    assert_eq!(
        repository
            .project_layout(
                form.id,
                &layout,
                None,
                &[1, 2],
                at(10),
                Some(Audience::Members)
            )
            .await
            .unwrap(),
        LayoutProjection::Written(LayoutReplacement::Replaced)
    );
    assert_eq!(repository.layout(form.id).await.unwrap(), layout);
    assert_eq!(
        repository.draft_state(form.id).await.unwrap(),
        Some(LayoutDraftState {
            enabled: true,
            revision: Some(vec![1, 2])
        })
    );

    let stale = FormLayout { sections: vec![] };
    assert_eq!(
        repository
            .project_layout(form.id, &stale, None, &[3], at(11), None)
            .await
            .unwrap(),
        LayoutProjection::RevisionChanged
    );
    assert_eq!(repository.layout(form.id).await.unwrap(), layout);
    assert_eq!(
        repository
            .form(form.id)
            .await
            .unwrap()
            .unwrap()
            .form
            .updated_at,
        at(10)
    );

    assert_eq!(
        repository
            .project_layout(
                form.id,
                &stale,
                Some(&[1, 2]),
                &[3],
                at(11),
                Some(Audience::Public)
            )
            .await
            .unwrap(),
        LayoutProjection::Written(LayoutReplacement::AudienceChanged)
    );
    assert_eq!(
        repository
            .draft_state(form.id)
            .await
            .unwrap()
            .unwrap()
            .revision,
        Some(vec![1, 2])
    );
    repository.trash_form(form.id, at(12)).await.unwrap();
    assert_eq!(repository.draft_state(form.id).await.unwrap(), None);
    assert!(!repository.enable_draft(form.id).await.unwrap());
    assert_eq!(
        repository
            .project_layout(form.id, &stale, Some(&[1, 2]), &[3], at(13), None)
            .await
            .unwrap(),
        LayoutProjection::Written(LayoutReplacement::FormGone)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_projections_commit_exactly_one_revision_and_its_layout(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repository = PgFormsRepo::new(pool);
    let form = form_over(&table);
    repository
        .create_form(&form, &FormLayout { sections: vec![] }, false)
        .await
        .unwrap();
    repository.enable_draft(form.id).await.unwrap();
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(3));
    let mut workers = vec![];
    for (revision, title) in [(vec![1], "First editor"), (vec![2], "Second editor")] {
        let repository = repository.clone();
        let barrier = barrier.clone();
        workers.push(tokio::spawn(async move {
            let layout = FormLayout {
                sections: vec![FormSection::Questions {
                    id: FormSectionId::new(),
                    title: title.into(),
                    description: "".into(),
                    questions: vec![],
                }],
            };
            barrier.wait().await;
            let result = repository
                .project_layout(form.id, &layout, None, &revision, at(10), None)
                .await
                .unwrap();
            (result, layout, revision)
        }));
    }
    barrier.wait().await;
    let mut committed = 0;
    let mut conflicts = 0;
    for worker in workers {
        let (result, layout, revision) = worker.await.unwrap();
        match result {
            LayoutProjection::Written(LayoutReplacement::Replaced) => {
                committed += 1;
                assert_eq!(repository.layout(form.id).await.unwrap(), layout);
                assert_eq!(
                    repository
                        .draft_state(form.id)
                        .await
                        .unwrap()
                        .unwrap()
                        .revision,
                    Some(revision)
                );
            }
            LayoutProjection::RevisionChanged => conflicts += 1,
            other => panic!("unexpected projection result: {other:?}"),
        }
    }
    assert_eq!(committed, 1);
    assert_eq!(conflicts, 1);
    assert_eq!(
        repository
            .replace_layout(form.id, &FormLayout { sections: vec![] }, at(11), None)
            .await
            .unwrap(),
        LayoutReplacement::DraftRequired
    );
}
