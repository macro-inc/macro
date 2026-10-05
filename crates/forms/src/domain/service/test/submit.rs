//! Submitting: who may respond, what is validated, what the gates stop, and
//! exactly what is written.

use std::collections::BTreeMap;

use ::databases::domain::models::{DatabaseError, OpRefusal};
use entity_access::domain::models::ViewAccessLevel;
use models_databases::{
    CellValue, CellWrite, DatabaseOp, EntityKind, EntityRef, OptionRef, RowsChange,
};

use super::*;
use crate::domain::models::{
    Answer, FormError, FormResponse, ResponseStatus, Submission, SubmissionOutcome,
};
use crate::domain::ports::FormsService;

fn employee_answers() -> Vec<Answer> {
    vec![
        Answer {
            question: TEAM_QUESTION,
            value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]),
        },
        Answer {
            question: START_QUESTION,
            value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
        },
    ]
}

fn contractor_answers() -> Vec<Answer> {
    vec![
        Answer {
            question: TEAM_QUESTION,
            value: CellValue::Options(vec![OptionRef::Id(CONTRACTOR)]),
        },
        Answer {
            question: START_QUESTION,
            value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
        },
    ]
}

async fn submit_as(
    forms: &Service,
    user: &'static str,
    answers: Vec<Answer>,
) -> Result<SubmissionOutcome, FormError> {
    forms
        .submit_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, user, AccessLevel::View),
            Submission { answers },
        )
        .await
}

fn rows(world: &Shared) -> usize {
    world
        .lock()
        .unwrap()
        .database(RSVP_DATABASE)
        .table(RSVP_TABLE)
        .unwrap()
        .rows
        .len()
}

#[tokio::test]
async fn an_anonymous_visitor_cannot_respond_to_a_members_form() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let refused = service(&world)
        .submit_response(
            anonymous_receipt::<ViewAccessLevel>(RSVP_FORM),
            Submission {
                answers: employee_answers(),
            },
        )
        .await;
    assert!(matches!(refused, Err(FormError::SignInRequired)));
    assert_eq!(rows(&world), 0);
    assert!(world.lock().unwrap().ledger.is_empty());
}

#[tokio::test]
async fn an_anonymous_response_to_a_public_form_is_written_as_the_owner_with_no_respondent() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let outcome = service(&world)
        .submit_response(
            anonymous_receipt::<ViewAccessLevel>(RSVP_FORM),
            Submission {
                answers: employee_answers(),
            },
        )
        .await
        .unwrap();
    let SubmissionOutcome::Submitted { response, row } = outcome else {
        panic!("saved, not {outcome:?}");
    };
    let world = world.lock().unwrap();
    assert_eq!(
        world.batches,
        vec![RecordedBatch {
            database: RSVP_DATABASE,
            internal: true,
            viewer: OWNER.into(),
            ops: vec![DatabaseOp::Rows {
                table: RSVP_TABLE,
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
                            column: SUBMITTED,
                            value: CellValue::Date(start_of_tests()),
                        },
                    ]],
                },
            }],
        }]
    );
    assert_eq!(
        world.ledger,
        vec![LedgerEntry {
            response: FormResponse {
                id: response,
                form_id: RSVP_FORM,
                status: ResponseStatus::Submitted,
                stopped_at_section: None,
                row: Some(row),
                submitted_at: start_of_tests(),
                updated_at: start_of_tests(),
            },
            respondent: None,
        }]
    );
    assert_eq!(world.event_types(), vec!["form.response_submitted"]);
    assert!(world.events[0]["metadata"].get("respondent").is_none());
}

#[tokio::test]
async fn anonymous_visitors_of_a_public_form_respond_without_a_limit() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let forms = service(&world);
    for _ in 0..2 {
        forms
            .submit_response(
                anonymous_receipt::<ViewAccessLevel>(RSVP_FORM),
                Submission {
                    answers: employee_answers(),
                },
            )
            .await
            .unwrap();
    }
    assert_eq!(rows(&world), 2);
}

#[tokio::test]
async fn a_signed_in_visitor_of_a_public_form_keeps_their_identity_and_one_response() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let forms = service(&world);
    submit_as(&forms, VIEWER, employee_answers()).await.unwrap();
    let again = submit_as(&forms, VIEWER, employee_answers()).await;
    assert!(matches!(again, Err(FormError::AlreadyResponded)));
    let world = world.lock().unwrap();
    let (_, cells) = &world
        .database(RSVP_DATABASE)
        .table(RSVP_TABLE)
        .unwrap()
        .rows[0];
    assert_eq!(
        cells.get(&RESPONDENT),
        Some(&CellValue::Entities(vec![EntityRef {
            entity_type: EntityKind::User,
            entity_id: VIEWER.into(),
        }]))
    );
    assert_eq!(world.batches[0].viewer, VIEWER);
    assert_eq!(world.ledger.len(), 1);
    assert_eq!(world.ledger[0].respondent.as_deref(), Some(VIEWER));
}

#[tokio::test]
async fn a_member_responds_once_and_a_second_submission_writes_nothing() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, employee_answers()).await.unwrap();
    let again = submit_as(&forms, VIEWER, employee_answers()).await;
    assert!(matches!(again, Err(FormError::AlreadyResponded)));
    assert_eq!(rows(&world), 1);
    assert_eq!(world.lock().unwrap().batches.len(), 1);
}

#[tokio::test]
async fn a_response_racing_an_accepted_one_keeps_its_row_and_is_refused_by_the_one_per_person_key()
{
    let world = world();
    seed_rsvp(&world, Audience::Members);
    // Another submission by the same person records its entry while this
    // one's row is being written: both passed the early check.
    world.lock().unwrap().competing_submission = Some((RSVP_FORM, VIEWER.to_string()));
    let refused = submit_as(&service(&world), VIEWER, employee_answers()).await;
    assert!(matches!(refused, Err(FormError::AlreadyResponded)));
    // The row is committed and stays, as RFC 01 §7 decides; only the winning
    // entry is in the ledger.
    assert_eq!(rows(&world), 1);
    let world = world.lock().unwrap();
    assert_eq!(world.ledger.len(), 1);
    assert_ne!(
        world.ledger[0].response.row,
        Some(
            world
                .database(RSVP_DATABASE)
                .table(RSVP_TABLE)
                .unwrap()
                .rows[0]
                .0
        )
    );
    assert!(world.events.is_empty());
}

#[tokio::test]
async fn a_stopped_respondent_writes_no_row_and_may_try_again() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let stopped = submit_as(&forms, VIEWER, contractor_answers())
        .await
        .unwrap();
    assert_eq!(
        stopped,
        SubmissionOutcome::Stopped {
            section: ELIGIBILITY,
            message: GATE_MESSAGE.into(),
        }
    );
    assert_eq!(rows(&world), 0);
    assert!(world.lock().unwrap().batches.is_empty());
    assert_eq!(
        world.lock().unwrap().ledger[0].response.status,
        ResponseStatus::Stopped
    );

    let passed = submit_as(&forms, VIEWER, employee_answers()).await.unwrap();
    let SubmissionOutcome::Submitted { response, row } = passed else {
        panic!("saved, not {passed:?}");
    };
    let world = world.lock().unwrap();
    assert_eq!(world.ledger.len(), 1);
    assert_eq!(
        world.ledger[0].response,
        FormResponse {
            id: response,
            form_id: RSVP_FORM,
            status: ResponseStatus::Submitted,
            stopped_at_section: None,
            row: Some(row),
            submitted_at: start_of_tests(),
            updated_at: start_of_tests(),
        }
    );
}

#[tokio::test]
async fn an_anonymous_stop_leaves_no_ledger_entry() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let stopped = service(&world)
        .submit_response(
            anonymous_receipt::<ViewAccessLevel>(RSVP_FORM),
            Submission {
                answers: contractor_answers(),
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
    assert!(world.ledger.is_empty());
    assert!(world.batches.is_empty());
}

#[tokio::test]
async fn required_questions_after_a_stopping_gate_need_no_answer_but_reached_ones_do() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    {
        let mut world = world.lock().unwrap();
        let layout = world.layouts.get_mut(&RSVP_FORM).unwrap();
        let FormSection::Questions { questions, .. } = &mut layout.sections[2] else {
            panic!("the third section asks questions");
        };
        questions[0].required = true;
    }
    let forms = service(&world);

    // Stopped at the gate: Diet, required but after it, is not reached.
    let stopped = submit_as(&forms, VIEWER, contractor_answers())
        .await
        .unwrap();
    assert!(matches!(stopped, SubmissionOutcome::Stopped { .. }));

    // Past the gate, Diet is reached and must be answered.
    let missing = submit_as(&forms, EDITOR, employee_answers()).await;
    assert!(matches!(
        missing,
        Err(FormError::MissingAnswer {
            question: DIET_QUESTION
        })
    ));

    // A required question of the first section is checked before any gate.
    let first_missing = submit_as(
        &forms,
        STRANGER,
        vec![Answer {
            question: TEAM_QUESTION,
            value: CellValue::Options(vec![OptionRef::Id(CONTRACTOR)]),
        }],
    )
    .await;
    assert!(matches!(
        first_missing,
        Err(FormError::MissingAnswer {
            question: START_QUESTION
        })
    ));
    assert_eq!(rows(&world), 0);
}

#[tokio::test]
async fn blank_text_and_clear_count_as_no_answer() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let refused = submit_as(
        &service(&world),
        VIEWER,
        vec![
            Answer {
                question: TEAM_QUESTION,
                value: CellValue::Clear,
            },
            Answer {
                question: START_QUESTION,
                value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
            },
            Answer {
                question: DIET_QUESTION,
                value: CellValue::Text("   ".into()),
            },
        ],
    )
    .await;
    assert!(matches!(
        refused,
        Err(FormError::MissingAnswer {
            question: TEAM_QUESTION
        })
    ));
}

#[tokio::test]
async fn malformed_answers_are_refused_before_anything_is_written() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let with = |extra: Answer| {
        let mut answers = employee_answers();
        answers.push(extra);
        answers
    };

    let unknown = submit_as(
        &forms,
        VIEWER,
        with(Answer {
            question: FormQuestionId::from_uuid(Uuid::from_u128(0xbad)),
            value: CellValue::Text("?".into()),
        }),
    )
    .await;
    assert!(matches!(unknown, Err(FormError::UnknownQuestion { .. })));

    let repeated = submit_as(
        &forms,
        VIEWER,
        with(Answer {
            question: TEAM_QUESTION,
            value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]),
        }),
    )
    .await;
    assert!(matches!(
        repeated,
        Err(FormError::RepeatedAnswer {
            question: TEAM_QUESTION
        })
    ));

    let wrong_kind = submit_as(
        &forms,
        VIEWER,
        with(Answer {
            question: DIET_QUESTION,
            value: CellValue::Number(3.0),
        }),
    )
    .await;
    assert!(matches!(
        wrong_kind,
        Err(FormError::InvalidAnswer {
            question: DIET_QUESTION,
            ..
        })
    ));

    let two_teams = submit_as(
        &forms,
        VIEWER,
        vec![
            Answer {
                question: TEAM_QUESTION,
                value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE), OptionRef::Id(CONTRACTOR)]),
            },
            employee_answers().remove(1),
        ],
    )
    .await;
    assert!(matches!(
        two_teams,
        Err(FormError::InvalidAnswer {
            question: TEAM_QUESTION,
            ..
        })
    ));

    let unknown_label = submit_as(
        &forms,
        VIEWER,
        vec![
            Answer {
                question: TEAM_QUESTION,
                value: CellValue::Options(vec![OptionRef::Label("Intern".into())]),
            },
            employee_answers().remove(1),
        ],
    )
    .await;
    assert!(matches!(
        unknown_label,
        Err(FormError::InvalidAnswer {
            question: TEAM_QUESTION,
            ..
        })
    ));

    // An unasked column cannot be written by naming its question: it has none.
    let managed = submit_as(
        &forms,
        VIEWER,
        with(Answer {
            question: FormQuestionId::from_uuid(*SUBMITTED.as_uuid()),
            value: CellValue::Date(start_of_tests()),
        }),
    )
    .await;
    assert!(matches!(managed, Err(FormError::UnknownQuestion { .. })));

    assert!(world.lock().unwrap().batches.is_empty());
    assert!(world.lock().unwrap().ledger.is_empty());
}

#[tokio::test]
async fn an_option_named_by_label_is_written_by_id_and_passes_the_gate_by_id() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let stopped = submit_as(
        &service(&world),
        VIEWER,
        vec![
            Answer {
                question: TEAM_QUESTION,
                value: CellValue::Options(vec![OptionRef::Label("contractor".into())]),
            },
            employee_answers().remove(1),
        ],
    )
    .await
    .unwrap();
    assert!(matches!(stopped, SubmissionOutcome::Stopped { .. }));

    service(&world)
        .submit_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            Submission {
                answers: vec![
                    Answer {
                        question: TEAM_QUESTION,
                        value: CellValue::Options(vec![OptionRef::Label("EMPLOYEE".into())]),
                    },
                    employee_answers().remove(1),
                ],
            },
        )
        .await
        .unwrap();
    let world = world.lock().unwrap();
    let DatabaseOp::Rows {
        change: RowsChange::Insert { rows },
        ..
    } = &world.batches[0].ops[0]
    else {
        panic!("an insert");
    };
    assert_eq!(
        rows[0][0],
        CellWrite {
            column: TEAM,
            value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]),
        }
    );
}

#[tokio::test]
async fn a_refusal_from_the_databases_service_names_the_question_and_records_nothing() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().refuse_next_batch = Some(DatabaseError::InvalidOp(OpRefusal {
        op: 0,
        row: Some(0),
        column: Some(DIET),
        taken: None,
        reason: "too long".into(),
    }));
    let forms = service(&world);
    let mut answers = employee_answers();
    answers.push(Answer {
        question: DIET_QUESTION,
        value: CellValue::Text("Vegetarian".into()),
    });
    let refused = submit_as(&forms, VIEWER, answers.clone()).await;
    assert!(matches!(
        refused,
        Err(FormError::InvalidAnswer { question: DIET_QUESTION, ref reason }) if reason == "too long"
    ));
    assert!(world.lock().unwrap().ledger.is_empty());

    // Nothing was recorded, so the respondent can submit again.
    submit_as(&forms, VIEWER, answers).await.unwrap();
    assert_eq!(rows(&world), 1);
}

#[tokio::test]
async fn a_failed_write_after_a_stop_leaves_the_stop_as_it_was() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, contractor_answers())
        .await
        .unwrap();
    let stop = world.lock().unwrap().ledger[0].clone();
    world.lock().unwrap().refuse_next_batch = Some(DatabaseError::VersionConflict);
    let refused = submit_as(&forms, VIEWER, employee_answers()).await;
    assert!(matches!(refused, Err(FormError::Conflict)));
    assert_eq!(world.lock().unwrap().ledger, vec![stop]);
}

#[tokio::test]
async fn a_closed_form_or_one_past_its_closing_time_takes_no_response() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    world.lock().unwrap().forms[0].form.status = FormStatus::Closed;
    assert!(matches!(
        submit_as(&forms, VIEWER, employee_answers()).await,
        Err(FormError::Closed)
    ));

    {
        let mut world = world.lock().unwrap();
        world.forms[0].form.status = FormStatus::Open;
        world.forms[0].form.closes_at = Some(Utc.with_ymd_and_hms(2026, 9, 1, 12, 0, 0).unwrap());
        world.now = Utc.with_ymd_and_hms(2026, 9, 1, 12, 0, 0).unwrap();
    }
    assert!(matches!(
        submit_as(&forms, VIEWER, employee_answers()).await,
        Err(FormError::Closed)
    ));

    world.lock().unwrap().now = Utc.with_ymd_and_hms(2026, 9, 1, 11, 59, 59).unwrap();
    submit_as(&forms, VIEWER, employee_answers()).await.unwrap();
    assert_eq!(rows(&world), 1);
}

#[tokio::test]
async fn a_form_over_a_trashed_database_refuses_with_table_gone() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().database_mut(RSVP_DATABASE).trashed = true;
    assert!(matches!(
        submit_as(&service(&world), VIEWER, employee_answers()).await,
        Err(FormError::TableGone)
    ));
}

#[tokio::test]
async fn a_trashed_form_takes_no_response() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().forms[0].trashed_at = Some(start_of_tests());
    assert!(matches!(
        submit_as(&service(&world), VIEWER, employee_answers()).await,
        Err(FormError::NotFound)
    ));
}

#[tokio::test]
async fn a_managed_column_deleted_in_the_grid_is_no_longer_written() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0]
        .columns
        .retain(|column| column.id != SUBMITTED);
    let outcome = submit_as(&service(&world), VIEWER, employee_answers())
        .await
        .unwrap();
    let SubmissionOutcome::Submitted { row, .. } = outcome else {
        panic!("saved");
    };
    let world = world.lock().unwrap();
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
async fn a_ledger_failure_after_the_row_is_written_surfaces_and_keeps_the_row() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().fail_next_ledger_write = true;
    let failed = submit_as(&service(&world), VIEWER, employee_answers()).await;
    assert!(matches!(failed, Err(FormError::Repository(_))));
    assert_eq!(rows(&world), 1);
    let world = world.lock().unwrap();
    assert!(world.ledger.is_empty());
    assert!(world.events.is_empty());
}
