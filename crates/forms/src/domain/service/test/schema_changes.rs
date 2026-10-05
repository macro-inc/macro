//! The table's schema changes under a form: a column deleted or retyped in
//! the grid. Responding refuses a form whose gates no longer fit its table
//! instead of stopping everyone; the builder still loads it, and a layout
//! read back puts back as it is.

use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use models_databases::{CellValue, OptionRef};

use super::*;
use crate::domain::models::{
    Answer, FormDetail, FormError, FormSectionDetail, LayoutProblem, Submission, UpdateForm,
};
use crate::domain::ports::FormsService;

const RESUME: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xf11e));
const RESUME_QUESTION: FormQuestionId = FormQuestionId::from_uuid(Uuid::from_u128(0xf11f));

fn retype(world: &Shared, column: ColumnId, kind: ColumnKind) {
    let mut world = world.lock().unwrap();
    let table = &mut world.database_mut(RSVP_DATABASE).tables[0];
    let found = table
        .columns
        .iter_mut()
        .find(|candidate| candidate.id == column)
        .unwrap();
    found.kind = kind;
    found.options = vec![];
}

fn delete_column(world: &Shared, column: ColumnId) {
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0]
        .columns
        .retain(|candidate| candidate.id != column);
}

fn set_widget(world: &Shared, question: FormQuestionId, widget: Widget) {
    let mut world = world.lock().unwrap();
    for section in &mut world.layouts.get_mut(&RSVP_FORM).unwrap().sections {
        if let FormSection::Questions { questions, .. } = section {
            for asked in questions.iter_mut().filter(|asked| asked.id == question) {
                asked.widget = Some(widget);
            }
        }
    }
}

async fn read(world: &Shared, user: &'static str, level: AccessLevel) -> FormDetail {
    service(world)
        .get_form(form_receipt::<ViewAccessLevel>(RSVP_FORM, user, level))
        .await
        .unwrap()
}

/// The layout a builder puts back from what it read.
fn layout_of(detail: &FormDetail) -> FormLayout {
    FormLayout {
        sections: detail
            .sections
            .iter()
            .map(|section| match section {
                FormSectionDetail::Questions {
                    id,
                    title,
                    description,
                    questions,
                } => FormSection::Questions {
                    id: *id,
                    title: title.clone(),
                    description: description.clone(),
                    questions: questions
                        .iter()
                        .map(|question| QuestionLayout {
                            id: question.id,
                            column: question.column,
                            help_text: question.help_text.clone(),
                            required: question.required,
                            widget: question.widget,
                        })
                        .collect(),
                },
                FormSectionDetail::Booking {
                    id,
                    title,
                    description,
                    target,
                } => FormSection::Booking {
                    id: *id,
                    title: title.clone(),
                    description: description.clone(),
                    target: target.clone().expect("editor sees the booking target"),
                },
                FormSectionDetail::Gate {
                    id,
                    title,
                    description,
                    rules,
                    message,
                } => FormSection::Gate {
                    id: *id,
                    title: title.clone(),
                    description: description.clone(),
                    rules: rules.clone(),
                    message: message.clone(),
                },
            })
            .collect(),
    }
}

async fn submit(world: &Shared) -> Result<crate::domain::models::SubmissionOutcome, FormError> {
    service(world)
        .submit_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission {
                answers: vec![Answer {
                    question: START_QUESTION,
                    value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
                }],
            },
        )
        .await
}

#[tokio::test]
async fn a_gate_on_a_deleted_column_refuses_responses_as_an_invalid_layout_before_any_write() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    delete_column(&world, TEAM);

    let refused = submit(&world).await;

    assert!(matches!(
        refused,
        Err(FormError::InvalidLayout(
            LayoutProblem::GateNamesLaterColumn { column: TEAM }
        ))
    ));
    {
        let world = world.lock().unwrap();
        assert!(world.batches.is_empty());
        assert!(world.ledger.is_empty());
    }
    // The builder still loads the form, gate and all, to repair it.
    let detail = read(&world, EDITOR, AccessLevel::Edit).await;
    assert!(matches!(detail.sections[1], FormSectionDetail::Gate { .. }));
}

#[tokio::test]
async fn a_gate_whose_test_no_longer_fits_its_retyped_column_refuses_responses() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    retype(&world, TEAM, ColumnKind::Text);

    let refused = service(&world)
        .submit_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission {
                answers: vec![
                    Answer {
                        question: TEAM_QUESTION,
                        value: CellValue::Text("Design".into()),
                    },
                    Answer {
                        question: START_QUESTION,
                        value: CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()),
                    },
                ],
            },
        )
        .await;

    assert!(matches!(
        refused,
        Err(FormError::InvalidLayout(LayoutProblem::GateRule { .. }))
    ));
    assert!(world.lock().unwrap().batches.is_empty());
}

#[tokio::test]
async fn a_gate_on_a_deleted_option_refuses_responses() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0]
        .columns
        .iter_mut()
        .find(|column| column.id == TEAM)
        .unwrap()
        .options
        .retain(|(option, _)| *option != CONTRACTOR);

    let refused = service(&world)
        .submit_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
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
                ],
            },
        )
        .await;

    assert!(matches!(
        refused,
        Err(FormError::InvalidLayout(LayoutProblem::GateRule { .. }))
    ));
}

#[tokio::test]
async fn an_edit_of_a_saved_response_is_refused_the_same_way() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    service(&world)
        .submit_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
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
                ],
            },
        )
        .await
        .unwrap();
    delete_column(&world, TEAM);

    let refused = service(&world)
        .edit_my_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission { answers: vec![] },
        )
        .await;

    assert!(matches!(
        refused,
        Err(FormError::InvalidLayout(
            LayoutProblem::GateNamesLaterColumn { column: TEAM }
        ))
    ));
    assert_eq!(world.lock().unwrap().batches.len(), 1);
}

#[tokio::test]
async fn a_widget_that_no_longer_fits_its_retyped_column_reads_as_the_kinds_default_and_puts_back()
{
    let world = world();
    seed_rsvp(&world, Audience::Members);
    set_widget(&world, DIET_QUESTION, Widget::Paragraph);
    retype(&world, DIET, ColumnKind::Date);

    let detail = read(&world, EDITOR, AccessLevel::Edit).await;
    let FormSectionDetail::Questions { questions, .. } = &detail.sections[2] else {
        panic!("logistics");
    };
    assert_eq!(questions[0].kind, ColumnKind::Date);
    assert_eq!(questions[0].widget, Some(Widget::Datetime));

    let put = service(&world)
        .put_layout(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            layout_of(&detail),
        )
        .await
        .unwrap();
    assert_eq!(put.detail.sections, detail.sections);
}

#[tokio::test]
async fn a_stale_file_widget_on_a_column_no_longer_a_link_does_not_keep_the_form_members_only() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    {
        let mut world = world.lock().unwrap();
        world.database_mut(RSVP_DATABASE).tables[0]
            .columns
            .push(FakeColumn {
                id: RESUME,
                name: "Resume".into(),
                kind: ColumnKind::Link,
                options: vec![],
            });
        let FormSection::Questions { questions, .. } =
            &mut world.layouts.get_mut(&RSVP_FORM).unwrap().sections[2]
        else {
            panic!("logistics");
        };
        questions.push(QuestionLayout {
            id: RESUME_QUESTION,
            column: RESUME,
            help_text: "".into(),
            required: false,
            widget: Some(Widget::File),
        });
    }
    retype(&world, RESUME, ColumnKind::Text);

    let detail = read(&world, OWNER, AccessLevel::Owner).await;
    let FormSectionDetail::Questions { questions, .. } = &detail.sections[2] else {
        panic!("logistics");
    };
    assert_eq!(questions[2].widget, Some(Widget::Short));

    let public = service(&world)
        .update_form(
            form_receipt::<EditAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner),
            UpdateForm {
                audience: Some(Audience::Public),
                ..UpdateForm::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(public.audience, Audience::Public);
}

#[tokio::test]
async fn a_public_form_never_shows_a_file_upload_whatever_its_stored_layout() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    {
        let mut world = world.lock().unwrap();
        world.database_mut(RSVP_DATABASE).tables[0]
            .columns
            .push(FakeColumn {
                id: RESUME,
                name: "Resume".into(),
                kind: ColumnKind::Link,
                options: vec![],
            });
        let FormSection::Questions { questions, .. } =
            &mut world.layouts.get_mut(&RSVP_FORM).unwrap().sections[2]
        else {
            panic!("logistics");
        };
        questions.push(QuestionLayout {
            id: RESUME_QUESTION,
            column: RESUME,
            help_text: "".into(),
            required: false,
            widget: Some(Widget::File),
        });
    }

    let detail = read(&world, VIEWER, AccessLevel::View).await;
    let FormSectionDetail::Questions { questions, .. } = &detail.sections[2] else {
        panic!("logistics");
    };
    assert_eq!(questions[2].widget, Some(Widget::Url));
}
