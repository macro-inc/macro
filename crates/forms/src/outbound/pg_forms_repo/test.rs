use chrono::TimeZone;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::views::{
    Conjunction, FilterCondition, FilterGroup, FilterNode, FilterTest, PresenceOperator,
};
use models_permissions::share_permission::access_level::AccessLevel as ShareAccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};

use super::*;

mod races;
use crate::domain::models::{
    FormQuestionId, FormResponse, FormSection, FormSectionId, QuestionLayout, RecordedResponse,
    ResponseCounts, ResponseStatus, RowId, Widget,
};
use crate::domain::ports::FormsRepo;
use crate::domain::sharing::FormSharingRepo;

const OWNER: &str = "macro|owner@forms-repo.test";
const RESPONDENT: &str = "macro|respondent@forms-repo.test";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

fn at(hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 1, hour, 0, 0).unwrap()
}

/// A database with one table and two columns, owned by [`OWNER`].
struct Table {
    database: DatabaseId,
    table: TableId,
    first: ColumnId,
    second: ColumnId,
}

async fn insert_user(pool: &PgPool, user_id: &str) {
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

async fn insert_column(pool: &PgPool, database: Uuid, table: Uuid, name: &str) -> ColumnId {
    let definition = Uuid::now_v7();
    let column = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO property_definitions (id, database_id, display_name, data_type, is_multi_select)
        VALUES ($1, $2, $3, 'STRING', false)
        "#,
        definition,
        database,
        name,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_columns (id, table_id, property_definition_id, position) VALUES ($1, $2, $3, $4)"#,
        column,
        table,
        definition,
        name,
    )
    .execute(pool)
    .await
    .unwrap();
    ColumnId::from_uuid(column)
}

async fn insert_table(pool: &PgPool) -> Table {
    insert_user(pool, OWNER).await;
    insert_user(pool, RESPONDENT).await;
    let database = Uuid::now_v7();
    let table = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO databases (id, name, owner_id) VALUES ($1, 'RSVP', $2)"#,
        database,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 'Responses', 'a0')"#,
        table,
        database,
    )
    .execute(pool)
    .await
    .unwrap();
    Table {
        database: DatabaseId::from_uuid(database),
        table: TableId::from_uuid(table),
        first: insert_column(pool, database, table, "a1").await,
        second: insert_column(pool, database, table, "a2").await,
    }
}

async fn insert_row(pool: &PgPool, table: TableId, position: &str) -> RowId {
    let row = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO database_rows (id, table_id, position, created_by) VALUES ($1, $2, $3, $4)"#,
        row,
        table.into_uuid(),
        position,
        RESPONDENT,
    )
    .execute(pool)
    .await
    .unwrap();
    RowId::from_uuid(row)
}

fn form_over(table: &Table) -> Form {
    Form {
        id: FormId::new(),
        name: "Q4 offsite RSVP".into(),
        description: "Tell us".into(),
        owner_id: OWNER.into(),
        database_id: table.database,
        table_id: table.table,
        submitted_column_id: Some(table.second),
        respondent_column_id: None,
        audience: Audience::Members,
        tally_visible: false,
        status: FormStatus::Open,
        closes_at: None,
        confirmation_message: "".into(),
        created_at: at(9),
        updated_at: at(9),
    }
}

fn layout_over(table: &Table) -> FormLayout {
    FormLayout {
        sections: vec![
            FormSection::Questions {
                id: FormSectionId::new(),
                title: "About you".into(),
                description: "".into(),
                questions: vec![QuestionLayout {
                    id: FormQuestionId::new(),
                    column: table.first,
                    help_text: "Your team".into(),
                    required: true,
                    widget: Some(Widget::Paragraph),
                }],
            },
            FormSection::Gate {
                id: FormSectionId::new(),
                title: "Check".into(),
                description: "".into(),
                rules: FilterGroup {
                    conjunction: Conjunction::And,
                    conditions: vec![FilterNode::Condition(FilterCondition {
                        column: table.first,
                        test: FilterTest::Presence {
                            operator: PresenceOperator::IsNotEmpty,
                        },
                    })],
                },
                message: "Answer first".into(),
            },
            FormSection::Questions {
                id: FormSectionId::new(),
                title: "Empty".into(),
                description: "".into(),
                questions: vec![],
            },
        ],
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_created_form_reads_back_with_its_layout_and_owner_grant(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    let layout = layout_over(&table);
    repo.create_form(&form, &layout).await.unwrap();

    assert_eq!(
        repo.form(form.id).await.unwrap(),
        Some(StoredForm {
            form: form.clone(),
            trashed_at: None,
        })
    );
    assert_eq!(repo.layout(form.id).await.unwrap(), layout);
    let grant = sqlx::query!(
        r#"SELECT source_id, access_level::text AS "access_level!" FROM entity_access WHERE entity_id = $1 AND entity_type = 'form'"#,
        form.id.into_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(grant.source_id, OWNER);
    assert_eq!(grant.access_level, "owner");
    assert_eq!(
        repo.forms_for_database(table.database).await.unwrap(),
        vec![form.clone()]
    );
    assert_eq!(
        repo.forms_by_ids(&[form.id, FormId::new()]).await.unwrap(),
        vec![form]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_layout_is_replaced_whole_and_a_trashed_forms_is_not(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool);
    let form = form_over(&table);
    repo.create_form(&form, &layout_over(&table)).await.unwrap();
    let reordered = FormLayout {
        sections: vec![FormSection::Questions {
            id: FormSectionId::new(),
            title: "".into(),
            description: "".into(),
            questions: vec![
                QuestionLayout {
                    id: FormQuestionId::new(),
                    column: table.second,
                    help_text: "".into(),
                    required: false,
                    widget: None,
                },
                QuestionLayout {
                    id: FormQuestionId::new(),
                    column: table.first,
                    help_text: "".into(),
                    required: false,
                    widget: Some(Widget::Short),
                },
            ],
        }],
    };
    assert_eq!(
        repo.replace_layout(form.id, &reordered, at(10), None)
            .await
            .unwrap(),
        crate::domain::models::LayoutReplacement::Replaced
    );
    assert_eq!(repo.layout(form.id).await.unwrap(), reordered);
    assert_eq!(
        repo.form(form.id).await.unwrap().unwrap().form.updated_at,
        at(10)
    );

    assert!(repo.trash_form(form.id, at(11)).await.unwrap());
    assert_eq!(
        repo.replace_layout(form.id, &layout_over(&table), at(12), None)
            .await
            .unwrap(),
        crate::domain::models::LayoutReplacement::FormGone
    );
    assert_eq!(repo.layout(form.id).await.unwrap(), reordered);
    assert!(
        repo.forms_for_database(table.database)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(repo.forms_by_ids(&[form.id]).await.unwrap().is_empty());
    assert!(repo.restore_form(form.id).await.unwrap());
    assert_eq!(repo.form(form.id).await.unwrap().unwrap().trashed_at, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn facts_change_only_where_given_and_a_closing_time_can_be_cleared(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool);
    let form = form_over(&table);
    repo.create_form(&form, &layout_over(&table)).await.unwrap();
    let changed = repo
        .update_form(
            form.id,
            &crate::domain::models::UpdateForm {
                description: None,
                confirmation_message: Some("Thanks!".into()),
                audience: Some(Audience::Public),
                status: Some(FormStatus::Closed),
                closes_at: Some(Some(at(17))),
                tally_visible: Some(true),
            },
            at(10),
            None,
        )
        .await
        .unwrap();
    let crate::domain::models::FormUpdate::Updated(changed) = changed else {
        panic!("updated, not {changed:?}");
    };
    assert_eq!(
        *changed,
        Form {
            confirmation_message: "Thanks!".into(),
            audience: Audience::Public,
            status: FormStatus::Closed,
            closes_at: Some(at(17)),
            tally_visible: true,
            updated_at: at(10),
            ..form.clone()
        }
    );
    let cleared = repo
        .update_form(
            form.id,
            &crate::domain::models::UpdateForm {
                closes_at: Some(None),
                ..crate::domain::models::UpdateForm::default()
            },
            at(11),
            None,
        )
        .await
        .unwrap();
    let crate::domain::models::FormUpdate::Updated(cleared) = cleared else {
        panic!("updated, not {cleared:?}");
    };
    assert_eq!(cleared.closes_at, None);
    assert_eq!(cleared.audience, Audience::Public);
    let renamed = repo
        .rename_form(form.id, "Offsite", at(12))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(renamed.name, "Offsite");
    assert_eq!(renamed.updated_at, at(12));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_signed_in_stop_gives_way_to_a_response_which_then_holds_the_key(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    let layout = layout_over(&table);
    repo.create_form(&form, &layout).await.unwrap();
    let gate = layout.sections[1].id();
    let respondent = user(RESPONDENT);

    repo.record_stop(form.id, &respondent, gate, at(10))
        .await
        .unwrap();
    repo.record_stop(form.id, &respondent, gate, at(11))
        .await
        .unwrap();
    let stop = repo
        .response_of(form.id, &respondent)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stop.status, ResponseStatus::Stopped);
    assert_eq!(stop.stopped_at_section, Some(gate));
    assert_eq!(stop.updated_at, at(11));

    let row = insert_row(&pool, table.table, "a0").await;
    let RecordedResponse::Recorded(response) = repo
        .record_submission(form.id, Some(&respondent), row, at(12))
        .await
        .unwrap()
    else {
        panic!("a stop gives way");
    };
    assert_eq!(
        response,
        FormResponse {
            id: stop.id,
            form_id: form.id,
            status: ResponseStatus::Submitted,
            stopped_at_section: None,
            row: Some(row),
            submitted_at: at(12),
            updated_at: at(12),
        }
    );

    // The accepted response holds the key against a second response and a
    // later stop alike.
    let second = insert_row(&pool, table.table, "a1").await;
    assert_eq!(
        repo.record_submission(form.id, Some(&respondent), second, at(13))
            .await
            .unwrap(),
        RecordedResponse::AlreadySubmitted
    );
    repo.record_stop(form.id, &respondent, gate, at(14))
        .await
        .unwrap();
    assert_eq!(
        repo.response_of(form.id, &respondent).await.unwrap(),
        Some(response.clone())
    );

    let replacement = insert_row(&pool, table.table, "a2").await;
    repo.repoint_response(response.id, replacement, at(15))
        .await
        .unwrap();
    repo.touch_response(response.id, at(16)).await.unwrap();
    let repointed = repo
        .response_of(form.id, &respondent)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(repointed.row, Some(replacement));
    assert_eq!(repointed.updated_at, at(16));
    assert_eq!(repointed.submitted_at, at(12));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn anonymous_responses_are_unbounded_and_counted(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    let layout = layout_over(&table);
    repo.create_form(&form, &layout).await.unwrap();
    for position in ["a0", "a1"] {
        let row = insert_row(&pool, table.table, position).await;
        assert!(matches!(
            repo.record_submission(form.id, None, row, at(10))
                .await
                .unwrap(),
            RecordedResponse::Recorded(_)
        ));
    }
    let gate = layout.sections[1].id();
    repo.record_stop(form.id, &user(RESPONDENT), gate, at(11))
        .await
        .unwrap();
    assert_eq!(
        repo.response_counts(form.id).await.unwrap(),
        ResponseCounts {
            submitted: 2,
            stopped_by_section: vec![(gate, 1)],
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_responses_by_one_person_record_exactly_one(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    repo.create_form(&form, &layout_over(&table)).await.unwrap();
    let respondent = user(RESPONDENT);
    let first_row = insert_row(&pool, table.table, "a0").await;
    let second_row = insert_row(&pool, table.table, "a1").await;
    // Each insert runs on its own pooled connection; the unique index
    // serializes them.
    let (first, second) = tokio::join!(
        repo.record_submission(form.id, Some(&respondent), first_row, at(10)),
        repo.record_submission(form.id, Some(&respondent), second_row, at(10)),
    );
    let outcomes = [first.unwrap(), second.unwrap()];
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| matches!(outcome, RecordedResponse::Recorded(_)))
            .count(),
        1
    );
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
async fn a_deleted_row_leaves_its_entry_without_a_row(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    repo.create_form(&form, &layout_over(&table)).await.unwrap();
    let row = insert_row(&pool, table.table, "a0").await;
    repo.record_submission(form.id, Some(&user(RESPONDENT)), row, at(10))
        .await
        .unwrap();
    sqlx::query!("DELETE FROM database_rows WHERE id = $1", row.into_uuid())
        .execute(&pool)
        .await
        .unwrap();
    let entry = repo
        .response_of(form.id, &user(RESPONDENT))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(entry.row, None);
    assert_eq!(entry.status, ResponseStatus::Submitted);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_grants_change_only_on_a_live_form_and_go_with_it(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    repo.create_form(&form, &layout_over(&table)).await.unwrap();
    let channel = Uuid::now_v7().to_string();
    let grant = UpdateChannelSharePermission {
        operation: UpdateOperation::Add,
        channel_id: channel.clone(),
        access_level: Some(ShareAccessLevel::View),
    };
    assert!(
        repo.update_channel_grants(form.id, std::slice::from_ref(&grant))
            .await
            .unwrap()
    );
    assert_eq!(
        repo.channel_grants(form.id).await.unwrap(),
        vec![ChannelSharePermission {
            channel_id: channel,
            access_level: ShareAccessLevel::View,
        }]
    );
    repo.trash_form(form.id, at(10)).await.unwrap();
    assert!(!repo.update_channel_grants(form.id, &[grant]).await.unwrap());

    repo.delete_form(form.id).await.unwrap();
    assert_eq!(repo.form(form.id).await.unwrap(), None);
    let grants = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM entity_access WHERE entity_id = $1"#,
        form.id.into_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(grants, 0);
}
