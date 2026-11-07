//! Branching: a questions section shown only when earlier answers pass its
//! show-when rules. A skipped section asks nothing: its required questions
//! need no answer, answers sent for it are neither checked nor written, and
//! later gates and rules never see them.

use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use models_databases::views::{PresenceOperator, TextOperator};
use models_databases::{
    CellValue, CellWrite, DatabaseOp, EntityKind, EntityRef, OptionRef, RowChange, RowChanges,
    RowsChange,
};

use super::*;
use crate::domain::models::{
    Answer, FormError, FormSectionDetail, LayoutProblem, Submission, SubmissionOutcome,
};
use crate::domain::ports::FormsService;

const PLUS_ONES_FULL: &str = "Plus ones are full.";

/// About you (Team and Start date, required); Logistics, shown only to
/// employees (Diet required, Plus one optional); then a gate stopping
/// anyone bringing a plus one.
fn branching_layout() -> FormLayout {
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
                        help_text: "".into(),
                        required: true,
                        widget: None,
                    },
                ],
                show_when: None,
            },
            FormSection::Questions {
                id: LOGISTICS,
                title: "Logistics".into(),
                description: "".into(),
                questions: vec![
                    QuestionLayout {
                        id: DIET_QUESTION,
                        column: DIET,
                        help_text: "".into(),
                        required: true,
                        widget: None,
                    },
                    QuestionLayout {
                        id: PLUS_ONE_QUESTION,
                        column: PLUS_ONE,
                        help_text: "".into(),
                        required: false,
                        widget: None,
                    },
                ],
                show_when: Some(FilterGroup {
                    conjunction: Conjunction::And,
                    conditions: vec![FilterNode::Condition(FilterCondition {
                        column: TEAM,
                        test: FilterTest::Options {
                            operator: SetOperator::IsAnyOf,
                            options: vec![EMPLOYEE],
                        },
                    })],
                }),
            },
            FormSection::Gate {
                id: ELIGIBILITY,
                title: "Plus ones".into(),
                description: "".into(),
                rules: FilterGroup {
                    conjunction: Conjunction::Or,
                    conditions: vec![
                        FilterNode::Condition(FilterCondition {
                            column: PLUS_ONE,
                            test: FilterTest::Presence {
                                operator: PresenceOperator::IsEmpty,
                            },
                        }),
                        FilterNode::Condition(FilterCondition {
                            column: PLUS_ONE,
                            test: FilterTest::Checkbox { checked: false },
                        }),
                    ],
                },
                message: PLUS_ONES_FULL.into(),
            },
        ],
    }
}

fn seed_branching(world: &Shared) {
    seed_rsvp(world, Audience::Members);
    world
        .lock()
        .unwrap()
        .layouts
        .insert(RSVP_FORM, branching_layout());
}

async fn submit_as(
    world: &Shared,
    user: &'static str,
    answers: Vec<Answer>,
) -> Result<SubmissionOutcome, FormError> {
    service(world)
        .submit_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, user, AccessLevel::View),
            Submission { answers },
        )
        .await
}

#[tokio::test]
async fn a_skipped_section_needs_no_answers_and_its_answers_are_neither_checked_written_nor_gated()
{
    let world = world();
    seed_branching(&world);

    // A contractor skips Logistics: Diet, required there, is unanswered; a
    // number sent for the text Diet is not refused; and the checked Plus
    // one is not seen by the gate, so it does not stop them.
    let outcome = submit_as(
        &world,
        VIEWER,
        vec![
            Answer {
                question: TEAM_QUESTION,
                value: CellValue::Options(vec![OptionRef::Id(CONTRACTOR)]),
            },
            Answer {
                question: START_QUESTION,
                value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
            },
            Answer {
                question: DIET_QUESTION,
                value: CellValue::Number(3.0),
            },
            Answer {
                question: PLUS_ONE_QUESTION,
                value: CellValue::Boolean(true),
            },
        ],
    )
    .await
    .unwrap();

    assert!(matches!(outcome, SubmissionOutcome::Submitted { .. }));
    let world = world.lock().unwrap();
    assert_eq!(
        world.batches[0].ops,
        vec![DatabaseOp::Rows {
            table: RSVP_TABLE,
            change: RowsChange::Insert {
                rows: vec![vec![
                    CellWrite {
                        column: TEAM,
                        value: CellValue::Options(vec![OptionRef::Id(CONTRACTOR)]),
                    },
                    CellWrite {
                        column: START_DATE,
                        value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
                    },
                    CellWrite {
                        column: SUBMITTED,
                        value: CellValue::Date(start_of_tests()),
                    },
                    CellWrite {
                        column: RESPONDENT,
                        value: CellValue::Entities(vec![EntityRef {
                            entity_type: EntityKind::User,
                            entity_id: VIEWER.into(),
                        }]),
                    },
                ]],
            },
        }]
    );
}

#[tokio::test]
async fn a_shown_section_asks_its_questions_and_later_gates_see_its_answers() {
    let world = world();
    seed_branching(&world);
    let employee = |diet: Option<&str>, plus_one: bool| {
        let mut answers = vec![
            Answer {
                question: TEAM_QUESTION,
                value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]),
            },
            Answer {
                question: START_QUESTION,
                value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
            },
            Answer {
                question: PLUS_ONE_QUESTION,
                value: CellValue::Boolean(plus_one),
            },
        ];
        if let Some(diet) = diet {
            answers.push(Answer {
                question: DIET_QUESTION,
                value: CellValue::Text(diet.into()),
            });
        }
        answers
    };

    // An employee is shown Logistics, so its required Diet must be answered.
    assert!(matches!(
        submit_as(&world, VIEWER, employee(None, false)).await,
        Err(FormError::MissingAnswer {
            question: DIET_QUESTION
        })
    ));
    // Its Plus one is seen by the gate.
    assert_eq!(
        submit_as(&world, VIEWER, employee(Some("Vegan"), true))
            .await
            .unwrap(),
        SubmissionOutcome::Stopped {
            section: ELIGIBILITY,
            message: PLUS_ONES_FULL.into(),
        }
    );
    let outcome = submit_as(&world, VIEWER, employee(Some("Vegan"), false))
        .await
        .unwrap();

    assert!(matches!(outcome, SubmissionOutcome::Submitted { .. }));
    let world = world.lock().unwrap();
    assert_eq!(
        world.batches[0].ops,
        vec![DatabaseOp::Rows {
            table: RSVP_TABLE,
            change: RowsChange::Insert {
                rows: vec![vec![
                    CellWrite {
                        column: TEAM,
                        value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]),
                    },
                    CellWrite {
                        column: START_DATE,
                        value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
                    },
                    CellWrite {
                        column: DIET,
                        value: CellValue::Text("Vegan".into()),
                    },
                    CellWrite {
                        column: PLUS_ONE,
                        value: CellValue::Boolean(false),
                    },
                    CellWrite {
                        column: SUBMITTED,
                        value: CellValue::Date(start_of_tests()),
                    },
                    CellWrite {
                        column: RESPONDENT,
                        value: CellValue::Entities(vec![EntityRef {
                            entity_type: EntityKind::User,
                            entity_id: VIEWER.into(),
                        }]),
                    },
                ]],
            },
        }]
    );
}

#[tokio::test]
async fn an_edit_that_skips_a_section_clears_its_saved_answers() {
    let world = world();
    seed_branching(&world);
    let SubmissionOutcome::Submitted { row, .. } = submit_as(
        &world,
        VIEWER,
        vec![
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
                value: CellValue::Text("Vegan".into()),
            },
        ],
    )
    .await
    .unwrap() else {
        panic!("the first response is saved");
    };

    // Now a contractor: Logistics is skipped, so Diet is cleared even
    // though the page sent it again.
    service(&world)
        .edit_my_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission {
                answers: vec![
                    Answer {
                        question: TEAM_QUESTION,
                        value: CellValue::Options(vec![OptionRef::Id(CONTRACTOR)]),
                    },
                    Answer {
                        question: START_QUESTION,
                        value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
                    },
                    Answer {
                        question: DIET_QUESTION,
                        value: CellValue::Text("Vegan".into()),
                    },
                ],
            },
        )
        .await
        .unwrap();

    let world = world.lock().unwrap();
    assert_eq!(
        world.batches[1].ops,
        vec![DatabaseOp::Rows {
            table: RSVP_TABLE,
            change: RowsChange::Update {
                changes: RowChanges::PerRow {
                    rows: vec![RowChange {
                        row,
                        cells: vec![
                            CellWrite {
                                column: TEAM,
                                value: CellValue::Options(vec![OptionRef::Id(CONTRACTOR)]),
                            },
                            CellWrite {
                                column: START_DATE,
                                value: CellValue::Date(
                                    Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()
                                ),
                            },
                            CellWrite {
                                column: DIET,
                                value: CellValue::Clear,
                            },
                            CellWrite {
                                column: PLUS_ONE,
                                value: CellValue::Clear,
                            },
                        ],
                    }],
                },
            },
        }]
    );
}

#[tokio::test]
async fn show_when_rules_may_test_only_columns_of_earlier_sections_as_a_view_filter_would() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let shown_when = |column: ColumnId, test: FilterTest| FormLayout {
        sections: vec![
            FormSection::Questions {
                id: ABOUT_YOU,
                title: "".into(),
                description: "".into(),
                questions: vec![QuestionLayout {
                    id: TEAM_QUESTION,
                    column: TEAM,
                    help_text: "".into(),
                    required: false,
                    widget: None,
                }],
                show_when: None,
            },
            FormSection::Questions {
                id: LOGISTICS,
                title: "".into(),
                description: "".into(),
                questions: vec![QuestionLayout {
                    id: DIET_QUESTION,
                    column: DIET,
                    help_text: "".into(),
                    required: false,
                    widget: None,
                }],
                show_when: Some(FilterGroup {
                    conjunction: Conjunction::And,
                    conditions: vec![FilterNode::Condition(FilterCondition { column, test })],
                }),
            },
        ],
    };
    let put = |layout: FormLayout| {
        let forms = service(&world);
        async move {
            forms
                .put_layout(
                    form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
                    layout,
                )
                .await
        }
    };

    // Diet is the section's own question.
    assert!(matches!(
        put(shown_when(
            DIET,
            FilterTest::Text {
                operator: TextOperator::Contains,
                value: "vegan".into(),
            }
        ))
        .await,
        Err(FormError::InvalidLayout(
            LayoutProblem::ConditionNamesLaterColumn { column: DIET }
        ))
    ));
    // Notes is never asked.
    assert!(matches!(
        put(shown_when(
            NOTES,
            FilterTest::Text {
                operator: TextOperator::Contains,
                value: "x".into(),
            }
        ))
        .await,
        Err(FormError::InvalidLayout(
            LayoutProblem::ConditionNamesLaterColumn { column: NOTES }
        ))
    ));
    // A text test does not fit a select column.
    assert!(matches!(
        put(shown_when(
            TEAM,
            FilterTest::Text {
                operator: TextOperator::Is,
                value: "Employee".into(),
            }
        ))
        .await,
        Err(FormError::InvalidLayout(
            LayoutProblem::ConditionRule { .. }
        ))
    ));
    let fits = shown_when(
        TEAM,
        FilterTest::Options {
            operator: SetOperator::IsAnyOf,
            options: vec![EMPLOYEE],
        },
    );
    let saved = put(fits.clone()).await.unwrap();

    let FormSection::Questions {
        show_when: expected,
        ..
    } = &fits.sections[1]
    else {
        panic!("the second section asks questions");
    };
    let FormSectionDetail::Questions { show_when, .. } = &saved.detail.sections[1] else {
        panic!("the second section asks questions");
    };
    assert_eq!(show_when, expected);
    assert_eq!(world.lock().unwrap().layouts[&RSVP_FORM], fits);
}

#[tokio::test]
async fn a_show_when_rule_on_a_deleted_column_refuses_responses_before_any_write() {
    let world = world();
    seed_branching(&world);
    // The gate tests Plus one, not Team; only the show-when rule breaks.
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0]
        .columns
        .retain(|column| column.id != TEAM);

    let refused = submit_as(
        &world,
        VIEWER,
        vec![Answer {
            question: START_QUESTION,
            value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
        }],
    )
    .await;

    assert!(matches!(
        refused,
        Err(FormError::InvalidLayout(
            LayoutProblem::ConditionNamesLaterColumn { column: TEAM }
        ))
    ));
    assert!(world.lock().unwrap().batches.is_empty());
}
