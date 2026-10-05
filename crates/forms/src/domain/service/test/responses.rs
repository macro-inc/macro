//! A respondent's own response and its edits, and what editors and poll
//! voters read: the summary and the tally.

use std::collections::BTreeMap;

use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use models_databases::{
    CellValue, CellWrite, DatabaseOp, EntityKind, EntityRef, OptionRef, RowChange, RowChanges,
    RowId, RowsChange,
};

use super::*;
use crate::domain::models::{
    Answer, FormError, FormResponse, FormTally, MyResponse, QuestionTally, ResponseStatus,
    ResponseSummary, SectionCount, Submission, SubmissionOutcome, TallyBucket, TallyValue,
};
use crate::domain::ports::FormsService;

fn answers(team: OptionId, diet: Option<&str>) -> Vec<Answer> {
    let mut answers = vec![
        Answer {
            question: TEAM_QUESTION,
            value: CellValue::Options(vec![OptionRef::Id(team)]),
        },
        Answer {
            question: START_QUESTION,
            value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
        },
    ];
    if let Some(diet) = diet {
        answers.push(Answer {
            question: DIET_QUESTION,
            value: CellValue::Text(diet.into()),
        });
    }
    answers
}

async fn respond(forms: &Service, user: &'static str, answers: Vec<Answer>) -> SubmissionOutcome {
    forms
        .submit_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, user, AccessLevel::View),
            Submission { answers },
        )
        .await
        .unwrap()
}

fn submitted(outcome: SubmissionOutcome) -> (crate::domain::models::FormResponseId, RowId) {
    let SubmissionOutcome::Submitted { response, row, .. } = outcome else {
        panic!("saved, not {outcome:?}");
    };
    (response, row)
}

#[tokio::test]
async fn a_respondent_reads_their_response_back_from_the_row_as_it_is_now() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let (response, row) =
        submitted(respond(&forms, VIEWER, answers(EMPLOYEE, Some("Vegan"))).await);

    // An editor fixes the diet in the grid; the respondent sees the fix.
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0].rows[0]
        .1
        .insert(DIET, CellValue::Text("Vegetarian".into()));

    let mine = forms
        .my_response(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            VIEWER,
            AccessLevel::View,
        ))
        .await
        .unwrap();
    assert_eq!(
        mine,
        MyResponse {
            response: FormResponse {
                id: response,
                form_id: RSVP_FORM,
                status: ResponseStatus::Submitted,
                stopped_at_section: None,
                row: Some(row),
                submitted_at: start_of_tests(),
                updated_at: start_of_tests(),
            },
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
            booking: None,
        }
    );
}

#[tokio::test]
async fn reading_ones_response_needs_a_signed_in_respondent_with_one() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let forms = service(&world);
    assert!(matches!(
        forms
            .my_response(anonymous_receipt::<ViewAccessLevel>(RSVP_FORM))
            .await,
        Err(FormError::SignInRequired)
    ));
    assert!(matches!(
        forms
            .my_response(form_receipt::<ViewAccessLevel>(
                RSVP_FORM,
                VIEWER,
                AccessLevel::View
            ))
            .await,
        Err(FormError::NoResponse)
    ));
}

#[tokio::test]
async fn a_response_whose_row_was_deleted_reads_with_no_answers() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    respond(&forms, VIEWER, answers(EMPLOYEE, None)).await;
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0]
        .rows
        .clear();
    let mine = forms
        .my_response(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            VIEWER,
            AccessLevel::View,
        ))
        .await
        .unwrap();
    assert_eq!(mine.answers, vec![]);
}

#[tokio::test]
async fn an_edit_rewrites_every_question_of_the_row_and_clears_dropped_answers() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let (response, row) =
        submitted(respond(&forms, VIEWER, answers(EMPLOYEE, Some("Vegan"))).await);
    world.lock().unwrap().now = Utc.with_ymd_and_hms(2026, 9, 3, 8, 0, 0).unwrap();

    let edited = forms
        .edit_my_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission {
                answers: vec![
                    Answer {
                        question: TEAM_QUESTION,
                        value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]),
                    },
                    Answer {
                        question: START_QUESTION,
                        value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 18, 0, 0, 0).unwrap()),
                    },
                    Answer {
                        question: PLUS_ONE_QUESTION,
                        value: CellValue::Boolean(true),
                    },
                ],
            },
        )
        .await
        .unwrap();
    assert_eq!(
        edited,
        SubmissionOutcome::Submitted {
            response,
            row,
            booking: None,
        }
    );

    let world = world.lock().unwrap();
    assert_eq!(
        world.batches[1],
        RecordedBatch {
            database: RSVP_DATABASE,
            internal: true,
            viewer: VIEWER.into(),
            ops: vec![DatabaseOp::Rows {
                table: RSVP_TABLE,
                change: RowsChange::Update {
                    changes: RowChanges::PerRow {
                        rows: vec![RowChange {
                            row,
                            cells: vec![
                                CellWrite {
                                    column: TEAM,
                                    value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]),
                                },
                                CellWrite {
                                    column: START_DATE,
                                    value: CellValue::Date(
                                        Utc.with_ymd_and_hms(2026, 8, 18, 0, 0, 0).unwrap()
                                    ),
                                },
                                CellWrite {
                                    column: DIET,
                                    value: CellValue::Clear,
                                },
                                CellWrite {
                                    column: PLUS_ONE,
                                    value: CellValue::Boolean(true),
                                },
                            ],
                        }],
                    },
                },
            }],
        }
    );
    assert_eq!(
        world.ledger[0].response.updated_at,
        Utc.with_ymd_and_hms(2026, 9, 3, 8, 0, 0).unwrap()
    );
    assert_eq!(world.ledger[0].response.submitted_at, start_of_tests());
    // The managed cells keep the original submission.
    let (_, cells) = &world
        .database(RSVP_DATABASE)
        .table(RSVP_TABLE)
        .unwrap()
        .rows[0];
    assert_eq!(
        cells.get(&SUBMITTED),
        Some(&CellValue::Date(start_of_tests()))
    );
    assert_eq!(cells.get(&DIET), None);
}

#[tokio::test]
async fn an_edit_of_a_response_whose_row_was_deleted_writes_a_new_row_and_repoints_it() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let (response, _) = submitted(respond(&forms, VIEWER, answers(EMPLOYEE, None)).await);
    {
        let mut world = world.lock().unwrap();
        world.database_mut(RSVP_DATABASE).tables[0].rows.clear();
        // The row's foreign key nulls the entry's row.
        world.ledger[0].response.row = None;
        world.now = Utc.with_ymd_and_hms(2026, 9, 4, 8, 0, 0).unwrap();
    }
    let edited = forms
        .edit_my_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission {
                answers: answers(EMPLOYEE, Some("Vegan")),
            },
        )
        .await
        .unwrap();
    let SubmissionOutcome::Submitted {
        response: edited_response,
        row,
        ..
    } = edited
    else {
        panic!("saved");
    };
    assert_eq!(edited_response, response);
    let world = world.lock().unwrap();
    assert_eq!(world.ledger[0].response.row, Some(row));
    assert_eq!(
        world
            .database(RSVP_DATABASE)
            .table(RSVP_TABLE)
            .unwrap()
            .rows,
        vec![(
            row,
            BTreeMap::from([
                (TEAM, CellValue::Options(vec![OptionRef::Id(EMPLOYEE)])),
                (
                    START_DATE,
                    CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap())
                ),
                (DIET, CellValue::Text("Vegan".into())),
                (SUBMITTED, CellValue::Date(start_of_tests())),
                (
                    RESPONDENT,
                    CellValue::Entities(vec![EntityRef {
                        entity_type: EntityKind::User,
                        entity_id: VIEWER.into(),
                    }])
                ),
            ])
        )]
    );
}

#[tokio::test]
async fn an_edit_stopped_by_a_gate_leaves_the_saved_response_alone() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    respond(&forms, VIEWER, answers(EMPLOYEE, None)).await;
    let before = world.lock().unwrap().database(RSVP_DATABASE).clone();
    let stopped = forms
        .edit_my_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission {
                answers: answers(CONTRACTOR, None),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        stopped,
        SubmissionOutcome::Stopped {
            section: ELIGIBILITY,
            message: GATE_MESSAGE.into(),
        }
    );
    let world = world.lock().unwrap();
    assert_eq!(world.database(RSVP_DATABASE), &before);
    assert_eq!(world.batches.len(), 1);
    assert_eq!(world.ledger[0].response.status, ResponseStatus::Submitted);
}

#[tokio::test]
async fn an_edit_needs_an_open_form_a_signed_in_respondent_and_a_saved_response() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let forms = service(&world);
    let edit = |receipt| {
        forms.edit_my_response(
            receipt,
            Submission {
                answers: answers(EMPLOYEE, None),
            },
        )
    };
    assert!(matches!(
        edit(anonymous_receipt::<ViewAccessLevel>(RSVP_FORM)).await,
        Err(FormError::SignInRequired)
    ));
    assert!(matches!(
        edit(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            VIEWER,
            AccessLevel::View
        ))
        .await,
        Err(FormError::NoResponse)
    ));

    // A stop is not a saved response.
    respond(&forms, VIEWER, answers(CONTRACTOR, None)).await;
    assert!(matches!(
        edit(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            VIEWER,
            AccessLevel::View
        ))
        .await,
        Err(FormError::NoResponse)
    ));

    respond(&forms, EDITOR, answers(EMPLOYEE, None)).await;
    world.lock().unwrap().forms[0].form.status = FormStatus::Closed;
    assert!(matches!(
        edit(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            EDITOR,
            AccessLevel::View
        ))
        .await,
        Err(FormError::Closed)
    ));
}

#[tokio::test]
async fn the_summary_counts_the_ledger_by_gate_and_the_tables_rows() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let forms = service(&world);
    respond(&forms, VIEWER, answers(EMPLOYEE, None)).await;
    respond(&forms, EDITOR, answers(CONTRACTOR, None)).await;
    respond(&forms, STRANGER, answers(CONTRACTOR, None)).await;
    forms
        .submit_response(
            anonymous_receipt::<ViewAccessLevel>(RSVP_FORM),
            Submission {
                answers: answers(EMPLOYEE, None),
            },
        )
        .await
        .unwrap();
    // A row the grid added, not a response.
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0]
        .rows
        .push((RowId::new(), BTreeMap::new()));

    let summary = forms
        .response_summary(form_receipt::<EditAccessLevel>(
            RSVP_FORM,
            EDITOR,
            AccessLevel::Edit,
        ))
        .await
        .unwrap();
    assert_eq!(
        summary,
        ResponseSummary {
            submitted: 2,
            stopped: 2,
            stopped_by_section: vec![SectionCount {
                section: ELIGIBILITY,
                count: 2,
            }],
            rows: 3,
        }
    );
}

#[tokio::test]
async fn the_tally_counts_every_option_and_checkbox_in_layout_order() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    respond(&forms, VIEWER, answers(EMPLOYEE, None)).await;
    let mut with_plus_one = answers(EMPLOYEE, None);
    with_plus_one.push(Answer {
        question: PLUS_ONE_QUESTION,
        value: CellValue::Boolean(true),
    });
    respond(&forms, EDITOR, with_plus_one).await;

    let tally = forms
        .tally(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();
    assert_eq!(
        tally,
        FormTally {
            questions: vec![
                QuestionTally {
                    question: TEAM_QUESTION,
                    responses: 2,
                    buckets: vec![
                        TallyBucket {
                            value: TallyValue::Option { option: EMPLOYEE },
                            count: 2,
                        },
                        TallyBucket {
                            value: TallyValue::Option { option: CONTRACTOR },
                            count: 0,
                        },
                    ],
                },
                QuestionTally {
                    question: PLUS_ONE_QUESTION,
                    responses: 1,
                    buckets: vec![
                        TallyBucket {
                            value: TallyValue::Checkbox { checked: true },
                            count: 1,
                        },
                        TallyBucket {
                            value: TallyValue::Checkbox { checked: false },
                            count: 0,
                        },
                    ],
                },
            ],
        }
    );
}

#[tokio::test]
async fn respondents_read_the_tally_only_when_the_owner_shows_it() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let forms = service(&world);
    assert!(matches!(
        forms
            .tally(form_receipt::<ViewAccessLevel>(
                RSVP_FORM,
                VIEWER,
                AccessLevel::View
            ))
            .await,
        Err(FormError::TallyHidden)
    ));
    assert!(matches!(
        forms
            .tally(anonymous_receipt::<ViewAccessLevel>(RSVP_FORM))
            .await,
        Err(FormError::TallyHidden)
    ));
    forms
        .tally(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            EDITOR,
            AccessLevel::Edit,
        ))
        .await
        .unwrap();

    world.lock().unwrap().forms[0].form.tally_visible = true;
    forms
        .tally(anonymous_receipt::<ViewAccessLevel>(RSVP_FORM))
        .await
        .unwrap();
}

#[tokio::test]
async fn rewriting_a_lost_row_skips_managed_columns_retyped_in_the_grid() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let (response, _) = submitted(respond(&forms, VIEWER, answers(EMPLOYEE, None)).await);
    {
        let mut world = world.lock().unwrap();
        let table = &mut world.database_mut(RSVP_DATABASE).tables[0];
        table.rows.clear();
        for column in &mut table.columns {
            if column.id == SUBMITTED {
                column.kind = ColumnKind::Number;
            }
            if column.id == RESPONDENT {
                column.kind = ColumnKind::Entity {
                    target: EntityKind::User,
                    multi: true,
                };
            }
        }
        world.ledger[0].response.row = None;
    }
    let edited = forms
        .edit_my_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission {
                answers: answers(EMPLOYEE, None),
            },
        )
        .await
        .unwrap();
    let SubmissionOutcome::Submitted {
        response: edited_response,
        row,
        ..
    } = edited
    else {
        panic!("saved, not {edited:?}");
    };
    assert_eq!(edited_response, response);
    let world = world.lock().unwrap();
    let cells = &world
        .database(RSVP_DATABASE)
        .table(RSVP_TABLE)
        .unwrap()
        .rows[0]
        .1;
    assert!(!cells.contains_key(&SUBMITTED));
    assert!(!cells.contains_key(&RESPONDENT));
    assert_eq!(world.ledger[0].response.row, Some(row));
}

#[tokio::test]
async fn a_database_trashed_while_reading_ones_response_reads_as_the_receipt_without_answers() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let (response, row) = submitted(respond(&forms, VIEWER, answers(EMPLOYEE, None)).await);
    world.lock().unwrap().grid_change_before_next_cell_read =
        Some(GridChange::TrashDatabase(RSVP_DATABASE));

    let mine = forms
        .my_response(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            VIEWER,
            AccessLevel::View,
        ))
        .await
        .unwrap();

    assert_eq!(mine.response.id, response);
    assert_eq!(mine.response.row, Some(row));
    assert_eq!(mine.answers, vec![]);
}

#[tokio::test]
async fn a_question_whose_column_is_deleted_while_tallying_drops_out_of_the_tally() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    respond(&forms, VIEWER, answers(EMPLOYEE, None)).await;
    // Team is tallied first; it goes between the table read and its cells.
    world.lock().unwrap().grid_change_before_next_cell_read = Some(GridChange::DeleteColumn(TEAM));

    let tally = forms
        .tally(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();

    assert_eq!(
        tally
            .questions
            .iter()
            .map(|question| question.question)
            .collect::<Vec<_>>(),
        vec![PLUS_ONE_QUESTION]
    );
}
