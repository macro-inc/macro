//! An anonymous form's ledger: receipts say who responded, entries say what,
//! and nothing joins the two.

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_anonymous_response_is_a_receipt_and_an_entry_that_name_nothing_of_each_other(
    pool: PgPool,
) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = Form {
        anonymous: true,
        ..form_over(&table)
    };
    repo.create_form(&form, &layout_over(&table), false)
        .await
        .unwrap();
    let voter = user(RESPONDENT);
    let row = insert_row(&pool, table.table, "a0").await;
    let day = Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap();
    assert!(!repo.holds_receipt(form.id, &voter).await.unwrap());

    let RecordedResponse::Recorded(entry) = repo
        .record_anonymous_submission(form.id, Some(&voter), row, day)
        .await
        .unwrap()
    else {
        panic!("recorded");
    };

    assert!(repo.holds_receipt(form.id, &voter).await.unwrap());
    assert_eq!(entry.id.into_uuid().get_version_num(), 4);
    let stored = sqlx::query!(
        "SELECT respondent_id, row_id, submitted_at, updated_at FROM form_responses WHERE form_id = $1",
        form.id.into_uuid(),
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].respondent_id, None);
    assert_eq!(stored[0].row_id, Some(row.into_uuid()));
    assert_eq!(stored[0].submitted_at, day);
    assert_eq!(stored[0].updated_at, day);
    let receipts = sqlx::query!("SELECT form_id, user_id FROM form_submission_receipts",)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].form_id, form.id.into_uuid());
    assert_eq!(receipts[0].user_id, RESPONDENT);
    assert_eq!(repo.respondents_by_row(form.id).await.unwrap(), vec![]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_anonymous_responses_by_one_person_record_exactly_one(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = Form {
        anonymous: true,
        ..form_over(&table)
    };
    repo.create_form(&form, &layout_over(&table), false)
        .await
        .unwrap();
    let voter = user(RESPONDENT);
    let first_row = insert_row(&pool, table.table, "a0").await;
    let second_row = insert_row(&pool, table.table, "a1").await;
    // Each runs on its own pooled connection; the receipt's key serializes
    // them, and the loser's entry rolls back with its receipt.
    let (first, second) = tokio::join!(
        repo.record_anonymous_submission(form.id, Some(&voter), first_row, at(0)),
        repo.record_anonymous_submission(form.id, Some(&voter), second_row, at(0)),
    );
    let outcomes = [first.unwrap(), second.unwrap()];
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| **outcome == RecordedResponse::AlreadySubmitted)
            .count(),
        1
    );
    let entries = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM form_responses WHERE form_id = $1"#,
        form.id.into_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(entries, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn whether_a_form_is_anonymous_cannot_change_once_a_response_is_recorded(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    repo.create_form(&form, &layout_over(&table), false)
        .await
        .unwrap();
    let anonymous = UpdateForm {
        anonymous: Some(true),
        ..UpdateForm::default()
    };
    let FormUpdate::Updated(updated) = repo
        .update_form(form.id, &anonymous, at(10), None)
        .await
        .unwrap()
    else {
        panic!("updated");
    };
    assert!(updated.anonymous);
    let row = insert_row(&pool, table.table, "a0").await;
    repo.record_anonymous_submission(form.id, Some(&user(RESPONDENT)), row, at(0))
        .await
        .unwrap();
    let named = UpdateForm {
        anonymous: Some(false),
        ..UpdateForm::default()
    };
    assert_eq!(
        repo.update_form(form.id, &named, at(11), None)
            .await
            .unwrap(),
        FormUpdate::AnonymityLocked
    );
    // Asking for what it already is changes nothing and is not refused.
    assert!(matches!(
        repo.update_form(form.id, &anonymous, at(12), None)
            .await
            .unwrap(),
        FormUpdate::Updated(_)
    ));
}
