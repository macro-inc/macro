//! RFC 01 §11: one form, start to finish, over a new database. Written
//! before the service existed and run red first.

use std::collections::BTreeMap;

use ::databases::domain::models::OpBatch;
use ::databases::domain::ports::DatabasesService;
use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use models_databases::views::{
    Conjunction, DateOperator, FilterCondition, FilterGroup, FilterNode, FilterTest, SetOperator,
};
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnId, ColumnKind, DatabaseOp, EntityKind, EntityRef,
    NewColumn, NewOption, OptionId, OptionRef, RowsChange, TableChange,
};
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    Answer, Audience, Form, FormAccess, FormDetail, FormLayout, FormQuestionDetail, FormQuestionId,
    FormResponse, FormSection, FormSectionDetail, FormSectionId, FormStatus, QuestionLayout,
    QuestionOption, ResponseStatus, Submission, SubmissionOutcome, Widget,
};
use crate::domain::ports::{CreateFormCommand, CreateSource, FormsService};

const CONTRACTOR_RESPONDENT: &str = "macro|contractor@macro.com";

const TEAM: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0x7ea));
const START_DATE: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0x57a));
const DIET: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xd1e));
const EMPLOYEE: OptionId = OptionId::from_uuid(Uuid::from_u128(0xe0));
const CONTRACTOR: OptionId = OptionId::from_uuid(Uuid::from_u128(0xc0));

const ABOUT_YOU: FormSectionId = FormSectionId::from_uuid(Uuid::from_u128(0x5ec1));
const ELIGIBILITY: FormSectionId = FormSectionId::from_uuid(Uuid::from_u128(0x5ec2));
const LOGISTICS: FormSectionId = FormSectionId::from_uuid(Uuid::from_u128(0x5ec3));
const TEAM_QUESTION: FormQuestionId = FormQuestionId::from_uuid(Uuid::from_u128(0x9001));
const START_QUESTION: FormQuestionId = FormQuestionId::from_uuid(Uuid::from_u128(0x9002));
const DIET_QUESTION: FormQuestionId = FormQuestionId::from_uuid(Uuid::from_u128(0x9003));

#[tokio::test]
async fn a_form_over_a_new_database_writes_a_passing_response_as_a_row_and_stops_a_failing_one() {
    let world = world();
    let forms = service(&world);

    // The owner creates the form from the menu: a new database comes with it.
    let created = forms
        .create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "Q4 offsite RSVP".into(),
                source: CreateSource::NewDatabase,
            },
        )
        .await
        .unwrap();
    let form_id = created.form.id;
    let database_id = created.form.database_id;
    let table_id = created.form.table_id;
    let submitted_column = created.form.submitted_column_id.unwrap();
    let respondent_column = created.form.respondent_column_id.unwrap();
    let first_section = created.sections[0].id();
    assert_eq!(
        created,
        FormDetail {
            form: Form {
                id: form_id,
                name: "Q4 offsite RSVP".into(),
                description: "".into(),
                owner_id: OWNER.into(),
                database_id,
                table_id,
                submitted_column_id: Some(submitted_column),
                respondent_column_id: Some(respondent_column),
                audience: Audience::Members,
                tally_visible: false,
                status: FormStatus::Open,
                closes_at: None,
                confirmation_message: "".into(),
                created_at: Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap(),
                updated_at: Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap(),
            },
            access: FormAccess::Owner,
            table_gone: false,
            sections: vec![FormSectionDetail::Questions {
                id: first_section,
                title: "".into(),
                description: "".into(),
                questions: vec![],
            }],
        }
    );
    {
        let world = world.lock().unwrap();
        assert_eq!(
            world.created_databases,
            vec![("Q4 offsite RSVP".to_string(), OWNER.to_string())]
        );
        assert_eq!(world.owner_grants, vec![(form_id, OWNER.to_string())]);
        let DatabaseOp::Column {
            column: starter_name_column,
            ..
        } = world.batches[0].ops[3]
        else {
            panic!("the fourth op removes the starter column");
        };
        assert_eq!(
            world.batches,
            vec![RecordedBatch {
                database: database_id,
                internal: true,
                viewer: OWNER.into(),
                ops: vec![
                    DatabaseOp::Table {
                        table: table_id,
                        change: TableChange::Rename {
                            name: "Responses".into(),
                            previous_name: Some("Table 1".into()),
                        },
                    },
                    DatabaseOp::Column {
                        table: table_id,
                        column: submitted_column,
                        change: ColumnChange::Create {
                            definition: NewColumn::New {
                                name: "Submitted".into(),
                                kind: ColumnKind::Date,
                                options: vec![],
                                infer_type: false,
                            },
                            after: None,
                        },
                    },
                    DatabaseOp::Column {
                        table: table_id,
                        column: respondent_column,
                        change: ColumnChange::Create {
                            definition: NewColumn::New {
                                name: "Respondent".into(),
                                kind: ColumnKind::Entity {
                                    target: EntityKind::User,
                                    multi: false,
                                },
                                options: vec![],
                                infer_type: false,
                            },
                            after: None,
                        },
                    },
                    DatabaseOp::Column {
                        table: table_id,
                        column: starter_name_column,
                        change: ColumnChange::Delete,
                    },
                ],
            }]
        );
        let table = world.database(database_id).table(table_id).unwrap().clone();
        assert_eq!(table.name, "Responses");
        assert_eq!(
            table.columns,
            vec![
                FakeColumn {
                    id: submitted_column,
                    name: "Submitted".into(),
                    kind: ColumnKind::Date,
                    options: vec![],
                },
                FakeColumn {
                    id: respondent_column,
                    name: "Respondent".into(),
                    kind: ColumnKind::Entity {
                        target: EntityKind::User,
                        multi: false,
                    },
                    options: vec![],
                },
            ]
        );
    }

    // The builder adds three questions' columns through the databases ops,
    // exactly as the grid would.
    FakeDatabases(world.clone())
        .apply_ops(
            database_receipt::<EditAccessLevel>(database_id, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Column {
                    table: table_id,
                    column: TEAM,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Team".into(),
                            kind: ColumnKind::Select { multi: false },
                            options: vec![
                                NewOption {
                                    id: EMPLOYEE,
                                    label: "Employee".into(),
                                },
                                NewOption {
                                    id: CONTRACTOR,
                                    label: "Contractor".into(),
                                },
                            ],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Column {
                    table: table_id,
                    column: START_DATE,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Start date".into(),
                            kind: ColumnKind::Date,
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Column {
                    table: table_id,
                    column: DIET,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Dietary needs".into(),
                            kind: ColumnKind::Text,
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
            ]),
        )
        .await
        .unwrap();

    // The owner puts a layout with a gate between two sections.
    let layout = forms
        .put_layout(
            form_receipt::<EditAccessLevel>(form_id, OWNER, AccessLevel::Owner),
            FormLayout {
                sections: vec![
                    FormSection::Questions {
                        id: ABOUT_YOU,
                        title: "About you".into(),
                        description: "".into(),
                        questions: vec![
                            QuestionLayout {
                                id: TEAM_QUESTION,
                                column: TEAM,
                                help_text: "".into(),
                                required: true,
                                widget: None,
                            },
                            QuestionLayout {
                                id: START_QUESTION,
                                column: START_DATE,
                                help_text: "Your first day".into(),
                                required: true,
                                widget: Some(Widget::Date),
                            },
                        ],
                    },
                    FormSection::Gate {
                        id: ELIGIBILITY,
                        title: "Eligibility".into(),
                        description: "".into(),
                        rules: FilterGroup {
                            conjunction: Conjunction::And,
                            conditions: vec![
                                FilterNode::Condition(FilterCondition {
                                    column: TEAM,
                                    test: FilterTest::Options {
                                        operator: SetOperator::IsNoneOf,
                                        options: vec![CONTRACTOR],
                                    },
                                }),
                                FilterNode::Condition(FilterCondition {
                                    column: START_DATE,
                                    test: FilterTest::Date {
                                        operator: DateOperator::Before,
                                        value: Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap(),
                                    },
                                }),
                            ],
                        },
                        message: "The offsite is for employees who started before September."
                            .into(),
                    },
                    FormSection::Questions {
                        id: LOGISTICS,
                        title: "Logistics".into(),
                        description: "".into(),
                        questions: vec![QuestionLayout {
                            id: DIET_QUESTION,
                            column: DIET,
                            help_text: "".into(),
                            required: false,
                            widget: Some(Widget::Paragraph),
                        }],
                    },
                ],
            },
        )
        .await
        .unwrap();
    assert_eq!(
        layout.detail.sections,
        vec![
            FormSectionDetail::Questions {
                id: ABOUT_YOU,
                title: "About you".into(),
                description: "".into(),
                questions: vec![
                    FormQuestionDetail {
                        id: TEAM_QUESTION,
                        column: TEAM,
                        title: "Team".into(),
                        kind: ColumnKind::Select { multi: false },
                        options: vec![
                            QuestionOption {
                                id: EMPLOYEE,
                                label: "Employee".into(),
                                color: Some("#4A90E2".into()),
                            },
                            QuestionOption {
                                id: CONTRACTOR,
                                label: "Contractor".into(),
                                color: Some("#4A90E2".into()),
                            },
                        ],
                        help_text: "".into(),
                        required: true,
                        widget: Some(Widget::Choice),
                    },
                    FormQuestionDetail {
                        id: START_QUESTION,
                        column: START_DATE,
                        title: "Start date".into(),
                        kind: ColumnKind::Date,
                        options: vec![],
                        help_text: "Your first day".into(),
                        required: true,
                        widget: Some(Widget::Date),
                    },
                ],
            },
            FormSectionDetail::Gate {
                id: ELIGIBILITY,
                title: "Eligibility".into(),
                description: "".into(),
                rules: FilterGroup {
                    conjunction: Conjunction::And,
                    conditions: vec![
                        FilterNode::Condition(FilterCondition {
                            column: TEAM,
                            test: FilterTest::Options {
                                operator: SetOperator::IsNoneOf,
                                options: vec![CONTRACTOR],
                            },
                        }),
                        FilterNode::Condition(FilterCondition {
                            column: START_DATE,
                            test: FilterTest::Date {
                                operator: DateOperator::Before,
                                value: Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap(),
                            },
                        }),
                    ],
                },
                message: "The offsite is for employees who started before September.".into(),
            },
            FormSectionDetail::Questions {
                id: LOGISTICS,
                title: "Logistics".into(),
                description: "".into(),
                questions: vec![FormQuestionDetail {
                    id: DIET_QUESTION,
                    column: DIET,
                    title: "Dietary needs".into(),
                    kind: ColumnKind::Text,
                    options: vec![],
                    help_text: "".into(),
                    required: false,
                    widget: Some(Widget::Paragraph),
                }],
            },
        ]
    );

    // A day later, an employee who started in August passes the gate.
    world.lock().unwrap().now = Utc.with_ymd_and_hms(2026, 9, 2, 10, 30, 0).unwrap();
    let passing = forms
        .submit_response(
            form_receipt::<ViewAccessLevel>(form_id, VIEWER, AccessLevel::View),
            Submission {
                answers: vec![
                    Answer {
                        question: TEAM_QUESTION,
                        value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]),
                    },
                    Answer {
                        question: START_QUESTION,
                        value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
                    },
                    Answer {
                        question: DIET_QUESTION,
                        value: CellValue::Text("Vegetarian".into()),
                    },
                ],
            },
        )
        .await
        .unwrap();
    let SubmissionOutcome::Submitted { response, row, .. } = passing else {
        panic!("the employee's response is saved, not {passing:?}");
    };

    // A contractor is stopped at the gate, and nothing is written.
    let failing = forms
        .submit_response(
            form_receipt::<ViewAccessLevel>(form_id, CONTRACTOR_RESPONDENT, AccessLevel::View),
            Submission {
                answers: vec![
                    Answer {
                        question: TEAM_QUESTION,
                        value: CellValue::Options(vec![OptionRef::Id(CONTRACTOR)]),
                    },
                    Answer {
                        question: START_QUESTION,
                        value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 20, 0, 0, 0).unwrap()),
                    },
                ],
            },
        )
        .await
        .unwrap();
    assert_eq!(
        failing,
        SubmissionOutcome::Stopped {
            section: ELIGIBILITY,
            message: "The offsite is for employees who started before September.".into(),
        }
    );

    // The databases service received the creation batch, the builder's own
    // columns, and one insert for the passing response, applied as its
    // respondent under the form's internal receipt.
    let world = world.lock().unwrap();
    assert_eq!(world.batches.len(), 3);
    assert_eq!(
        world.batches[2],
        RecordedBatch {
            database: database_id,
            internal: true,
            viewer: VIEWER.into(),
            ops: vec![DatabaseOp::Rows {
                table: table_id,
                change: RowsChange::Insert {
                    rows: vec![vec![
                        CellWrite {
                            column: TEAM,
                            value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]),
                        },
                        CellWrite {
                            column: START_DATE,
                            value: CellValue::Date(
                                Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()
                            ),
                        },
                        CellWrite {
                            column: DIET,
                            value: CellValue::Text("Vegetarian".into()),
                        },
                        CellWrite {
                            column: submitted_column,
                            value: CellValue::Date(
                                Utc.with_ymd_and_hms(2026, 9, 2, 10, 30, 0).unwrap()
                            ),
                        },
                        CellWrite {
                            column: respondent_column,
                            value: CellValue::Entities(vec![EntityRef {
                                entity_type: EntityKind::User,
                                entity_id: VIEWER.into(),
                            }]),
                        },
                    ]],
                },
            }],
        }
    );
    assert_eq!(
        world.database(database_id).table(table_id).unwrap().rows,
        vec![(
            row,
            BTreeMap::from([
                (TEAM, CellValue::Options(vec![OptionRef::Id(EMPLOYEE)])),
                (
                    START_DATE,
                    CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap())
                ),
                (DIET, CellValue::Text("Vegetarian".into())),
                (
                    submitted_column,
                    CellValue::Date(Utc.with_ymd_and_hms(2026, 9, 2, 10, 30, 0).unwrap())
                ),
                (
                    respondent_column,
                    CellValue::Entities(vec![EntityRef {
                        entity_type: EntityKind::User,
                        entity_id: VIEWER.into(),
                    }])
                ),
            ])
        )]
    );
    let stopped_entry = world.ledger[1].response.id;
    assert_eq!(
        world.ledger,
        vec![
            LedgerEntry {
                response: FormResponse {
                    id: response,
                    form_id,
                    status: ResponseStatus::Submitted,
                    stopped_at_section: None,
                    row: Some(row),
                    submitted_at: Utc.with_ymd_and_hms(2026, 9, 2, 10, 30, 0).unwrap(),
                    updated_at: Utc.with_ymd_and_hms(2026, 9, 2, 10, 30, 0).unwrap(),
                },
                respondent: Some(VIEWER.into()),
            },
            LedgerEntry {
                response: FormResponse {
                    id: stopped_entry,
                    form_id,
                    status: ResponseStatus::Stopped,
                    stopped_at_section: Some(ELIGIBILITY),
                    row: None,
                    submitted_at: Utc.with_ymd_and_hms(2026, 9, 2, 10, 30, 0).unwrap(),
                    updated_at: Utc.with_ymd_and_hms(2026, 9, 2, 10, 30, 0).unwrap(),
                },
                respondent: Some(CONTRACTOR_RESPONDENT.into()),
            },
        ]
    );
    assert_eq!(
        world.event_types(),
        vec!["form.created", "form.response_submitted"]
    );
}
