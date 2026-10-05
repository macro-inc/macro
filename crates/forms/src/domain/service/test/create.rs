//! Creating a form over an existing table, which takes Owner on its
//! database (the domain port's receipt type), and what creation leaves
//! behind when it fails.

use ::databases::domain::models::DatabaseError;
use entity_access::domain::models::OwnerAccessLevel;
use models_databases::{ColumnChange, DatabaseOp, NewColumn};

use super::*;
use crate::domain::models::{
    FormAccess, FormDetail, FormError, FormQuestionDetail, FormSectionDetail, QuestionOption,
};
use crate::domain::ports::{CreateFormCommand, CreateSource, FormsService};

const GUESTS_DATABASE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xd8));
const GUESTS_TABLE: TableId = TableId::from_uuid(Uuid::from_u128(0x7b));
const GUEST_NAME: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xa1));
const GUEST_STATUS: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xa2));
const OLD_SUBMITTED: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xa3));
const OLD_RESPONDENT: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xa4));
const GOING: OptionId = OptionId::from_uuid(Uuid::from_u128(0xa5));

fn seed_guests(world: &Shared, columns: Vec<FakeColumn>) {
    world.lock().unwrap().databases.push(FakeDatabase {
        id: GUESTS_DATABASE,
        name: "Party".into(),
        owner: OWNER.into(),
        trashed: false,
        tables: vec![FakeTable {
            id: GUESTS_TABLE,
            name: "Guests".into(),
            version: 1,
            columns,
            rows: vec![],
        }],
    });
}

fn guest_columns() -> Vec<FakeColumn> {
    vec![
        FakeColumn {
            id: GUEST_NAME,
            name: "Name".into(),
            kind: ColumnKind::Text,
            options: vec![],
        },
        FakeColumn {
            id: GUEST_STATUS,
            name: "Status".into(),
            kind: ColumnKind::Select { multi: false },
            options: vec![(GOING, "Going".into())],
        },
    ]
}

#[tokio::test]
async fn a_form_over_a_table_asks_every_column_and_adds_the_managed_ones() {
    let world = world();
    seed_guests(&world, guest_columns());
    let detail = service(&world)
        .create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "  Party RSVP ".into(),
                source: CreateSource::Table {
                    receipt: database_receipt::<OwnerAccessLevel>(
                        GUESTS_DATABASE,
                        OWNER,
                        AccessLevel::Owner,
                    ),
                    table_id: GUESTS_TABLE,
                },
            },
        )
        .await
        .unwrap();
    let submitted = detail.form.submitted_column_id.unwrap();
    let respondent = detail.form.respondent_column_id.unwrap();
    let FormSectionDetail::Questions { id, questions, .. } = &detail.sections[0] else {
        panic!("one section of questions");
    };
    assert_eq!(
        detail,
        FormDetail {
            form: Form {
                id: detail.form.id,
                name: "Party RSVP".into(),
                description: "".into(),
                owner_id: OWNER.into(),
                database_id: GUESTS_DATABASE,
                table_id: GUESTS_TABLE,
                submitted_column_id: Some(submitted),
                respondent_column_id: Some(respondent),
                audience: Audience::Members,
                tally_visible: false,
                status: FormStatus::Open,
                closes_at: None,
                confirmation_message: "".into(),
                created_at: start_of_tests(),
                updated_at: start_of_tests(),
            },
            access: FormAccess::Owner,
            table_gone: false,
            sections: vec![FormSectionDetail::Questions {
                id: *id,
                title: "".into(),
                description: "".into(),
                questions: vec![
                    FormQuestionDetail {
                        id: questions[0].id,
                        column: GUEST_NAME,
                        title: "Name".into(),
                        kind: ColumnKind::Text,
                        options: vec![],
                        help_text: "".into(),
                        required: false,
                        widget: Some(Widget::Short),
                    },
                    FormQuestionDetail {
                        id: questions[1].id,
                        column: GUEST_STATUS,
                        title: "Status".into(),
                        kind: ColumnKind::Select { multi: false },
                        options: vec![QuestionOption {
                            id: GOING,
                            label: "Going".into(),
                            color: Some("#4A90E2".into()),
                        }],
                        help_text: "".into(),
                        required: false,
                        widget: Some(Widget::Choice),
                    },
                ],
            }],
        }
    );
    let world = world.lock().unwrap();
    // Applied under the caller's own receipt, so the journal names them.
    assert_eq!(world.batches.len(), 1);
    assert!(!world.batches[0].internal);
    assert_eq!(world.batches[0].viewer, OWNER);
    assert_eq!(world.batches[0].ops.len(), 2);
    assert_eq!(world.owner_grants, vec![(detail.form.id, OWNER.into())]);
    assert_eq!(world.event_types(), vec!["form.created"]);
    assert!(world.created_databases.is_empty());
}

#[tokio::test]
async fn managed_columns_are_reused_by_name_and_type_and_renamed_around_a_misfit() {
    let world = world();
    let mut columns = guest_columns();
    // A "Submitted" column of another type is not the form's; a matching
    // "Respondent" is.
    columns.push(FakeColumn {
        id: OLD_SUBMITTED,
        name: "submitted".into(),
        kind: ColumnKind::Text,
        options: vec![],
    });
    columns.push(FakeColumn {
        id: OLD_RESPONDENT,
        name: "Respondent".into(),
        kind: ColumnKind::Entity {
            target: EntityKind::User,
            multi: false,
        },
        options: vec![],
    });
    seed_guests(&world, columns);
    let detail = service(&world)
        .create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "Party RSVP".into(),
                source: CreateSource::Table {
                    receipt: database_receipt::<OwnerAccessLevel>(
                        GUESTS_DATABASE,
                        OWNER,
                        AccessLevel::Owner,
                    ),
                    table_id: GUESTS_TABLE,
                },
            },
        )
        .await
        .unwrap();
    assert_eq!(detail.form.respondent_column_id, Some(OLD_RESPONDENT));
    let submitted = detail.form.submitted_column_id.unwrap();
    assert_ne!(submitted, OLD_SUBMITTED);
    let world = world.lock().unwrap();
    assert_eq!(
        world.batches[0].ops,
        vec![DatabaseOp::Column {
            table: GUESTS_TABLE,
            column: submitted,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Submitted 2".into(),
                    kind: ColumnKind::Date,
                    options: vec![],
                    infer_type: false,
                },
                after: None,
            },
        }]
    );
    // The text column named "submitted" is a question like any other; the
    // reused Respondent is not.
    let FormSectionDetail::Questions { questions, .. } = &detail.sections[0] else {
        panic!("questions");
    };
    let asked: Vec<ColumnId> = questions.iter().map(|question| question.column).collect();
    assert_eq!(asked, vec![GUEST_NAME, GUEST_STATUS, OLD_SUBMITTED]);
}

#[tokio::test]
async fn a_second_form_over_a_table_shares_the_first_ones_managed_columns() {
    let world = world();
    seed_guests(&world, guest_columns());
    let forms = service(&world);
    let create = || {
        forms.create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "Party RSVP".into(),
                source: CreateSource::Table {
                    receipt: database_receipt::<OwnerAccessLevel>(
                        GUESTS_DATABASE,
                        OWNER,
                        AccessLevel::Owner,
                    ),
                    table_id: GUESTS_TABLE,
                },
            },
        )
    };
    let first = create().await.unwrap();
    let second = create().await.unwrap();
    assert_eq!(
        first.form.submitted_column_id,
        second.form.submitted_column_id
    );
    assert_eq!(
        first.form.respondent_column_id,
        second.form.respondent_column_id
    );
    assert_eq!(world.lock().unwrap().batches.len(), 1);
}

#[tokio::test]
async fn a_form_over_an_unknown_table_or_database_is_not_found() {
    let world = world();
    seed_guests(&world, guest_columns());
    let forms = service(&world);
    let missing_table = forms
        .create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "Party RSVP".into(),
                source: CreateSource::Table {
                    receipt: database_receipt::<OwnerAccessLevel>(
                        GUESTS_DATABASE,
                        OWNER,
                        AccessLevel::Owner,
                    ),
                    table_id: TableId::new(),
                },
            },
        )
        .await;
    assert!(matches!(missing_table, Err(FormError::NotFound)));
    let missing_database = forms
        .create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "Party RSVP".into(),
                source: CreateSource::Table {
                    receipt: database_receipt::<OwnerAccessLevel>(
                        DatabaseId::new(),
                        OWNER,
                        AccessLevel::Owner,
                    ),
                    table_id: GUESTS_TABLE,
                },
            },
        )
        .await;
    assert!(matches!(missing_database, Err(FormError::NotFound)));
    assert!(world.lock().unwrap().forms.is_empty());
}

#[tokio::test]
async fn a_form_needs_a_name() {
    let world = world();
    let refused = service(&world)
        .create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "   ".into(),
                source: CreateSource::NewDatabase,
            },
        )
        .await;
    assert!(matches!(refused, Err(FormError::InvalidName(_))));
    let too_long = service(&world)
        .create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "x".repeat(201),
                source: CreateSource::NewDatabase,
            },
        )
        .await;
    assert!(matches!(too_long, Err(FormError::InvalidName(_))));
    assert!(world.lock().unwrap().created_databases.is_empty());
}

#[tokio::test]
async fn a_new_database_whose_setup_fails_is_removed_and_no_form_is_left() {
    let world = world();
    world.lock().unwrap().refuse_next_batch = Some(DatabaseError::VersionConflict);
    let refused = service(&world)
        .create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "Q4 offsite RSVP".into(),
                source: CreateSource::NewDatabase,
            },
        )
        .await;
    assert!(matches!(refused, Err(FormError::Conflict)));
    let world = world.lock().unwrap();
    assert_eq!(world.created_databases.len(), 1);
    assert_eq!(world.purged_databases.len(), 1);
    assert!(world.databases.is_empty());
    assert!(world.forms.is_empty());
    assert!(world.events.is_empty());
}
