//! Schema guarantees of the `add_forms` migration: one response per signed-in
//! person, and what each cascade takes with it.

use sqlx::{Pool, Postgres};
use uuid::Uuid;

const OWNER: &str = "macro|owner@forms.test";
const RESPONDENT: &str = "macro|respondent@forms.test";

/// The ids of one database, its table, a question column, the two managed
/// columns, a form over the table, and its one section and question.
struct FormFixture {
    database_id: Uuid,
    table_id: Uuid,
    question_column_id: Uuid,
    submitted_column_id: Uuid,
    form_id: Uuid,
    question_id: Uuid,
}

async fn insert_user(pool: &Pool<Postgres>, user_id: &str) {
    let email = user_id.trim_start_matches("macro|");
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)"#,
        macro_user_id,
        email,
        format!("cus_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_column(
    pool: &Pool<Postgres>,
    database_id: Uuid,
    table_id: Uuid,
    name: &str,
) -> Uuid {
    let definition_id = Uuid::now_v7();
    let column_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO property_definitions (id, database_id, display_name, data_type, is_multi_select)
        VALUES ($1, $2, $3, 'STRING', false)
        "#,
        definition_id,
        database_id,
        name,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_columns (id, table_id, property_definition_id, position) VALUES ($1, $2, $3, $4)"#,
        column_id,
        table_id,
        definition_id,
        name,
    )
    .execute(pool)
    .await
    .unwrap();
    column_id
}

async fn insert_form(pool: &Pool<Postgres>) -> FormFixture {
    let database_id = Uuid::now_v7();
    let table_id = Uuid::now_v7();
    let form_id = Uuid::now_v7();
    let section_id = Uuid::now_v7();
    let question_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO databases (id, name, owner_id) VALUES ($1, 'RSVP', $2)"#,
        database_id,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 'Responses', 'a0')"#,
        table_id,
        database_id,
    )
    .execute(pool)
    .await
    .unwrap();
    let question_column_id = insert_column(pool, database_id, table_id, "a1").await;
    let submitted_column_id = insert_column(pool, database_id, table_id, "a2").await;
    sqlx::query!(
        r#"
        INSERT INTO forms (id, name, owner_id, database_id, table_id, submitted_column_id)
        VALUES ($1, 'RSVP', $2, $3, $4, $5)
        "#,
        form_id,
        OWNER,
        database_id,
        table_id,
        submitted_column_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO form_sections (id, form_id, position, kind) VALUES ($1, $2, 'a0', 'questions')"#,
        section_id,
        form_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO form_questions (id, form_id, section_id, column_id, position)
        VALUES ($1, $2, $3, $4, 'a0')
        "#,
        question_id,
        form_id,
        section_id,
        question_column_id,
    )
    .execute(pool)
    .await
    .unwrap();
    FormFixture {
        database_id,
        table_id,
        question_column_id,
        submitted_column_id,
        form_id,
        question_id,
    }
}

async fn insert_response(
    pool: &Pool<Postgres>,
    form_id: Uuid,
    respondent_id: Option<&str>,
    row_id: Option<Uuid>,
) -> Result<Uuid, sqlx::Error> {
    let response_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO form_responses (id, form_id, respondent_id, row_id, status)
        VALUES ($1, $2, $3, $4, 'submitted')
        "#,
        response_id,
        form_id,
        respondent_id,
        row_id,
    )
    .execute(pool)
    .await?;
    Ok(response_id)
}

#[sqlx::test]
async fn a_signed_in_person_responds_once_per_form_and_anonymous_responses_are_unbounded(
    pool: Pool<Postgres>,
) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, RESPONDENT).await;
    let form = insert_form(&pool).await;
    let other_form = insert_form(&pool).await;

    insert_response(&pool, form.form_id, Some(RESPONDENT), None)
        .await
        .unwrap();
    let duplicate = insert_response(&pool, form.form_id, Some(RESPONDENT), None)
        .await
        .unwrap_err();
    assert_eq!(
        duplicate
            .as_database_error()
            .and_then(|error| error.constraint()),
        Some("form_responses_one_per_person")
    );

    insert_response(&pool, other_form.form_id, Some(RESPONDENT), None)
        .await
        .unwrap();
    insert_response(&pool, form.form_id, None, None)
        .await
        .unwrap();
    insert_response(&pool, form.form_id, None, None)
        .await
        .unwrap();

    let counts = sqlx::query!(
        r#"
        SELECT form_id, count(*) AS "responses!"
        FROM form_responses
        GROUP BY form_id
        ORDER BY form_id
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.form_id, row.responses))
    .collect::<Vec<_>>();
    assert_eq!(counts, vec![(form.form_id, 3), (other_form.form_id, 1)]);
}

#[sqlx::test]
async fn deleting_a_column_removes_its_question_and_nulls_a_managed_column(pool: Pool<Postgres>) {
    insert_user(&pool, OWNER).await;
    let form = insert_form(&pool).await;

    sqlx::query!(
        r#"DELETE FROM database_columns WHERE id = ANY($1)"#,
        &[form.question_column_id, form.submitted_column_id],
    )
    .execute(&pool)
    .await
    .unwrap();

    let questions = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM form_questions WHERE id = $1"#,
        form.question_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(questions, 0);
    let submitted_column_id = sqlx::query_scalar!(
        r#"SELECT submitted_column_id FROM forms WHERE id = $1"#,
        form.form_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(submitted_column_id, None);
}

#[sqlx::test]
async fn deleting_a_row_keeps_the_ledger_entry_without_its_row(pool: Pool<Postgres>) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, RESPONDENT).await;
    let form = insert_form(&pool).await;
    let row_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO database_rows (id, table_id, position, created_by) VALUES ($1, $2, 'a0', $3)"#,
        row_id,
        form.table_id,
        RESPONDENT,
    )
    .execute(&pool)
    .await
    .unwrap();
    let response_id = insert_response(&pool, form.form_id, Some(RESPONDENT), Some(row_id))
        .await
        .unwrap();

    sqlx::query!(r#"DELETE FROM database_rows WHERE id = $1"#, row_id)
        .execute(&pool)
        .await
        .unwrap();

    let ledger = sqlx::query!(
        r#"SELECT respondent_id, row_id FROM form_responses WHERE id = $1"#,
        response_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ledger.respondent_id.as_deref(), Some(RESPONDENT));
    assert_eq!(ledger.row_id, None);
}

#[sqlx::test]
async fn deleting_the_table_or_database_takes_the_form_and_everything_it_owns(
    pool: Pool<Postgres>,
) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, RESPONDENT).await;
    let by_table = insert_form(&pool).await;
    let by_database = insert_form(&pool).await;
    let kept = insert_form(&pool).await;
    for form in [&by_table, &by_database, &kept] {
        insert_response(&pool, form.form_id, Some(RESPONDENT), None)
            .await
            .unwrap();
    }

    sqlx::query!(
        r#"DELETE FROM database_tables WHERE id = $1"#,
        by_table.table_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"DELETE FROM databases WHERE id = $1"#,
        by_database.database_id
    )
    .execute(&pool)
    .await
    .unwrap();

    let remaining = sqlx::query!(
        r#"
        SELECT
            (SELECT count(*) FROM forms WHERE id = $1) AS "forms!",
            (SELECT count(*) FROM form_sections WHERE form_id = $1) AS "sections!",
            (SELECT count(*) FROM form_questions WHERE form_id = $1) AS "questions!",
            (SELECT count(*) FROM form_responses WHERE form_id = $1) AS "responses!"
        "#,
        by_table.form_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (
            remaining.forms,
            remaining.sections,
            remaining.questions,
            remaining.responses
        ),
        (0, 0, 0, 0)
    );
    let surviving_forms = sqlx::query_scalar!(r#"SELECT id FROM forms ORDER BY id"#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(surviving_forms, vec![kept.form_id]);
}

#[sqlx::test]
async fn deleting_the_owner_deletes_their_forms_and_a_respondent_leaves_an_anonymous_entry(
    pool: Pool<Postgres>,
) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, RESPONDENT).await;
    let form = insert_form(&pool).await;
    let response_id = insert_response(&pool, form.form_id, Some(RESPONDENT), None)
        .await
        .unwrap();

    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, RESPONDENT)
        .execute(&pool)
        .await
        .unwrap();
    let respondent_id = sqlx::query_scalar!(
        r#"SELECT respondent_id FROM form_responses WHERE id = $1"#,
        response_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(respondent_id, None);

    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, OWNER)
        .execute(&pool)
        .await
        .unwrap();
    let forms = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM forms"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(forms, 0);
}

#[sqlx::test]
async fn audience_status_and_section_kind_reject_unknown_values(pool: Pool<Postgres>) {
    insert_user(&pool, OWNER).await;
    let form = insert_form(&pool).await;

    for statement in [
        sqlx::query!(
            r#"UPDATE forms SET audience = 'everyone' WHERE id = $1"#,
            form.form_id
        )
        .execute(&pool)
        .await,
        sqlx::query!(
            r#"UPDATE forms SET status = 'paused' WHERE id = $1"#,
            form.form_id
        )
        .execute(&pool)
        .await,
        sqlx::query!(
            r#"UPDATE form_sections SET kind = 'branch' WHERE form_id = $1"#,
            form.form_id
        )
        .execute(&pool)
        .await,
        sqlx::query!(
            r#"UPDATE form_sections SET gate_rules = '[]'::jsonb WHERE form_id = $1"#,
            form.form_id
        )
        .execute(&pool)
        .await,
    ] {
        let error = statement.unwrap_err();
        assert_eq!(
            error.as_database_error().and_then(|error| error.code()),
            Some("23514".into()),
            "{error}"
        );
    }
}
