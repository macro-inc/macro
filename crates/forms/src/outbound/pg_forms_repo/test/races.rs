//! The layout and facts writes enforce their preconditions under the form's
//! row lock, and a layout naming another form's ids is refused by id.

use tokio::sync::oneshot;

use super::*;
use crate::domain::models::{ForbiddenWidget, FormUpdate, LayoutReplacement, UpdateForm};

fn file_question(table: &Table) -> FormLayout {
    FormLayout {
        sections: vec![FormSection::Questions {
            id: FormSectionId::new(),
            title: "".into(),
            description: "".into(),
            questions: vec![QuestionLayout {
                id: FormQuestionId::new(),
                column: table.first,
                help_text: "".into(),
                required: false,
                widget: Some(Widget::File),
            }],
        }],
    }
}

fn file_on(columns: Vec<ColumnId>) -> Option<ForbiddenWidget> {
    Some(ForbiddenWidget {
        widget: Widget::File,
        columns,
    })
}

fn going_public() -> UpdateForm {
    UpdateForm {
        audience: Some(Audience::Public),
        ..UpdateForm::default()
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_layout_needing_members_is_refused_once_the_stored_form_is_public(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool);
    let form = form_over(&table);
    let layout = layout_over(&table);
    repo.create_form(&form, &layout).await.unwrap();
    assert!(matches!(
        repo.update_form(form.id, &going_public(), at(10), None)
            .await
            .unwrap(),
        FormUpdate::Updated(_)
    ));

    assert_eq!(
        repo.replace_layout(
            form.id,
            &file_question(&table),
            at(11),
            Some(Audience::Members)
        )
        .await
        .unwrap(),
        LayoutReplacement::AudienceChanged
    );
    assert_eq!(repo.layout(form.id).await.unwrap(), layout);
    assert_eq!(
        repo.form(form.id).await.unwrap().unwrap().form.updated_at,
        at(10)
    );
    // Without the precondition the write goes through.
    assert_eq!(
        repo.replace_layout(form.id, &file_question(&table), at(12), None)
            .await
            .unwrap(),
        LayoutReplacement::Replaced
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_facts_change_forbidding_a_widget_is_refused_while_a_question_uses_it(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool);
    let form = form_over(&table);
    repo.create_form(&form, &file_question(&table))
        .await
        .unwrap();

    assert_eq!(
        repo.update_form(form.id, &going_public(), at(10), file_on(vec![table.first]))
            .await
            .unwrap(),
        FormUpdate::WidgetInUse
    );
    let stored = repo.form(form.id).await.unwrap().unwrap().form;
    assert_eq!(stored.audience, Audience::Members);
    assert_eq!(stored.updated_at, form.updated_at);

    assert!(matches!(
        repo.update_form(form.id, &going_public(), at(10), Some(ForbiddenWidget { widget: Widget::Paragraph, columns: vec![table.first] }))
            .await
            .unwrap(),
        FormUpdate::Updated(updated) if updated.audience == Audience::Public
    ));
    repo.trash_form(form.id, at(11)).await.unwrap();
    assert_eq!(
        repo.update_form(form.id, &going_public(), at(12), None)
            .await
            .unwrap(),
        FormUpdate::FormGone
    );
    assert_eq!(
        repo.replace_layout(form.id, &layout_over(&table), at(12), None)
            .await
            .unwrap(),
        LayoutReplacement::FormGone
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_layout_write_behind_a_concurrent_switch_to_public_sees_the_switch(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    let layout = layout_over(&table);
    repo.create_form(&form, &layout).await.unwrap();

    // The switch to public holds the form's row while it commits.
    let mut switch = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM forms WHERE id = $1 FOR UPDATE",
        form.id.into_uuid()
    )
    .fetch_one(&mut *switch)
    .await
    .unwrap();
    let (started, started_signal) = oneshot::channel();
    let writer = tokio::spawn({
        let repo = repo.clone();
        let file = file_question(&table);
        async move {
            started.send(()).unwrap();
            repo.replace_layout(form.id, &file, at(11), Some(Audience::Members))
                .await
        }
    });
    started_signal.await.unwrap();
    sqlx::query!(
        "UPDATE forms SET audience = 'public' WHERE id = $1",
        form.id.into_uuid()
    )
    .execute(&mut *switch)
    .await
    .unwrap();
    switch.commit().await.unwrap();

    assert_eq!(
        writer.await.unwrap().unwrap(),
        LayoutReplacement::AudienceChanged
    );
    assert_eq!(repo.layout(form.id).await.unwrap(), layout);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_switch_to_public_behind_a_concurrent_file_question_sees_the_question(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    repo.create_form(&form, &layout_over(&table)).await.unwrap();

    // The layout put holds the form's row while it writes a file question.
    let mut put = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM forms WHERE id = $1 FOR UPDATE",
        form.id.into_uuid()
    )
    .fetch_one(&mut *put)
    .await
    .unwrap();
    let (started, started_signal) = oneshot::channel();
    let switch = tokio::spawn({
        let repo = repo.clone();
        async move {
            started.send(()).unwrap();
            repo.update_form(form.id, &going_public(), at(11), file_on(vec![table.first]))
                .await
        }
    });
    started_signal.await.unwrap();
    sqlx::query!(
        "DELETE FROM form_sections WHERE form_id = $1",
        form.id.into_uuid()
    )
    .execute(&mut *put)
    .await
    .unwrap();
    layout::insert(&mut put, form.id, &file_question(&table))
        .await
        .unwrap();
    put.commit().await.unwrap();

    assert_eq!(switch.await.unwrap().unwrap(), FormUpdate::WidgetInUse);
    assert_eq!(
        repo.form(form.id).await.unwrap().unwrap().form.audience,
        Audience::Members
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_layout_reusing_another_forms_ids_is_refused_by_id_and_both_layouts_stay(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool);
    let first = form_over(&table);
    let first_layout = layout_over(&table);
    repo.create_form(&first, &first_layout).await.unwrap();
    let second = form_over(&table);
    let second_layout = layout_over(&table);
    repo.create_form(&second, &second_layout).await.unwrap();

    let FormSection::Questions {
        id: taken_section,
        questions: taken_questions,
        ..
    } = &first_layout.sections[0]
    else {
        panic!("questions first");
    };
    let reusing_section = FormLayout {
        sections: vec![FormSection::Questions {
            id: *taken_section,
            title: "Mine".into(),
            description: "".into(),
            questions: vec![],
        }],
    };
    assert_eq!(
        repo.replace_layout(second.id, &reusing_section, at(10), None)
            .await
            .unwrap(),
        LayoutReplacement::IdTaken(*taken_section.as_uuid())
    );
    let reusing_question = FormLayout {
        sections: vec![FormSection::Questions {
            id: FormSectionId::new(),
            title: "".into(),
            description: "".into(),
            questions: vec![QuestionLayout {
                id: taken_questions[0].id,
                column: table.second,
                help_text: "".into(),
                required: false,
                widget: None,
            }],
        }],
    };
    assert_eq!(
        repo.replace_layout(second.id, &reusing_question, at(10), None)
            .await
            .unwrap(),
        LayoutReplacement::IdTaken(*taken_questions[0].id.as_uuid())
    );
    assert_eq!(repo.layout(first.id).await.unwrap(), first_layout);
    assert_eq!(repo.layout(second.id).await.unwrap(), second_layout);
    assert_eq!(
        repo.form(second.id).await.unwrap().unwrap().form.updated_at,
        second.updated_at
    );
    // A form re-putting its own ids is no reuse.
    assert_eq!(
        repo.replace_layout(first.id, &first_layout, at(11), None)
            .await
            .unwrap(),
        LayoutReplacement::Replaced
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn two_forms_putting_one_new_id_at_once_leave_it_with_exactly_one(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool);
    let first = form_over(&table);
    repo.create_form(&first, &layout_over(&table))
        .await
        .unwrap();
    let second = form_over(&table);
    repo.create_form(&second, &layout_over(&table))
        .await
        .unwrap();
    let shared = FormSectionId::new();
    let layout = FormLayout {
        sections: vec![FormSection::Questions {
            id: shared,
            title: "".into(),
            description: "".into(),
            questions: vec![],
        }],
    };

    // Each write runs on its own pooled connection; the section key's
    // unique index makes the later one wait for the earlier to commit.
    let (first_put, second_put) = tokio::join!(
        repo.replace_layout(first.id, &layout, at(10), None),
        repo.replace_layout(second.id, &layout, at(10), None),
    );
    let mut outcomes = [first_put.unwrap(), second_put.unwrap()];
    outcomes.sort_by_key(|outcome| matches!(outcome, LayoutReplacement::IdTaken(_)));
    assert_eq!(
        outcomes,
        [
            LayoutReplacement::Replaced,
            LayoutReplacement::IdTaken(*shared.as_uuid())
        ]
    );
    let owners = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM form_sections WHERE id = $1"#,
        shared.into_uuid(),
    )
    .fetch_one(&repo.pool)
    .await
    .unwrap();
    assert_eq!(owners, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_widget_left_on_a_column_it_no_longer_applies_to_does_not_block_the_change(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool);
    let form = form_over(&table);
    repo.create_form(&form, &file_question(&table))
        .await
        .unwrap();

    // The file question's column is not among those a file widget still
    // applies to, so the stored widget asks for no file.
    assert!(matches!(
        repo.update_form(form.id, &going_public(), at(10), file_on(vec![table.second]))
            .await
            .unwrap(),
        FormUpdate::Updated(updated) if updated.audience == Audience::Public
    ));
}
