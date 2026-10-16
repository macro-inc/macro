//! The booking step: its destination reaches a respondent only once their
//! answers pass every gate and the response is saved, and only while the
//! saved row still passes the form as it is now.

use entity_access::domain::models::ViewAccessLevel;
use models_databases::{CellValue, OptionRef};
use models_forms::{BookingEventTypeId, BookingProfileId, BookingTarget, UnlockedBooking};
use serde_json::json;

use super::*;
use crate::domain::models::{
    Answer, FormError, MyResponse, ResponseStatus, Submission, SubmissionOutcome,
};
use crate::domain::ports::FormsService;

const BOOK_A_TIME: FormSectionId = FormSectionId::from_uuid(Uuid::from_u128(0x5e04));
const PROFILE: BookingProfileId = BookingProfileId::from_uuid(Uuid::from_u128(0xb001));
const EVENT_TYPE: BookingEventTypeId = BookingEventTypeId::from_uuid(Uuid::from_u128(0xb002));

/// The RSVP form with a booking step after its last section.
fn booking_layout() -> FormLayout {
    let mut layout = rsvp_layout();
    layout.sections.push(FormSection::Booking {
        id: BOOK_A_TIME,
        title: "Book your travel call".into(),
        description: "Pick a time with the offsite team.".into(),
        target: BookingTarget {
            profile_id: PROFILE,
            event_type_id: EVENT_TYPE,
        },
    });
    layout
}

fn seed_booking(world: &Shared, audience: Audience) {
    seed_rsvp(world, audience);
    world
        .lock()
        .unwrap()
        .layouts
        .insert(RSVP_FORM, booking_layout());
}

fn unlocked() -> UnlockedBooking {
    UnlockedBooking {
        section: BOOK_A_TIME,
        title: "Book your travel call".into(),
        description: "Pick a time with the offsite team.".into(),
        target: BookingTarget {
            profile_id: PROFILE,
            event_type_id: EVENT_TYPE,
        },
    }
}

fn start_date() -> CellValue {
    CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap())
}

fn answers(team: OptionId) -> Vec<Answer> {
    vec![
        Answer {
            question: TEAM_QUESTION,
            value: CellValue::Options(vec![OptionRef::Id(team)]),
        },
        Answer {
            question: START_QUESTION,
            value: start_date(),
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

async fn edit_as(
    forms: &Service,
    user: &'static str,
    answers: Vec<Answer>,
) -> Result<SubmissionOutcome, FormError> {
    forms
        .edit_my_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, user, AccessLevel::View),
            Submission { answers },
        )
        .await
}

async fn mine(forms: &Service, user: &'static str) -> MyResponse {
    forms
        .my_response(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            user,
            AccessLevel::View,
        ))
        .await
        .unwrap()
}

/// Whether the booking destination appears anywhere in `text`.
fn reveals_target(text: &str) -> bool {
    text.contains(&PROFILE.to_string()) || text.contains(&EVENT_TYPE.to_string())
}

#[tokio::test]
async fn an_accepted_response_unlocks_the_booking_step_and_a_stopped_one_never_sees_it() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().layouts.insert(
        RSVP_FORM,
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
                        conditions: vec![FilterNode::Condition(FilterCondition {
                            column: TEAM,
                            test: FilterTest::Options {
                                operator: SetOperator::IsNoneOf,
                                options: vec![CONTRACTOR],
                            },
                        })],
                    },
                    message: GATE_MESSAGE.into(),
                },
                FormSection::Booking {
                    id: BOOK_A_TIME,
                    title: "Book your travel call".into(),
                    description: "Pick a time with the offsite team.".into(),
                    target: BookingTarget {
                        profile_id: PROFILE,
                        event_type_id: EVENT_TYPE,
                    },
                },
            ],
        },
    );
    let forms = service(&world);

    let stopped = submit_as(
        &forms,
        STRANGER,
        vec![
            Answer {
                question: TEAM_QUESTION,
                value: CellValue::Options(vec![OptionRef::Id(CONTRACTOR)]),
            },
            Answer {
                question: START_QUESTION,
                value: start_date(),
            },
        ],
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
    assert_eq!(
        serde_json::to_value(&stopped).unwrap(),
        json!({
            "outcome": "stopped",
            "section": ELIGIBILITY.to_string(),
            "message": GATE_MESSAGE,
        })
    );

    let accepted = submit_as(
        &forms,
        VIEWER,
        vec![
            Answer {
                question: TEAM_QUESTION,
                value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]),
            },
            Answer {
                question: START_QUESTION,
                value: start_date(),
            },
        ],
    )
    .await
    .unwrap();
    let (response, row) = {
        let world = world.lock().unwrap();
        let entry = world
            .ledger
            .iter()
            .find(|entry| entry.respondent.as_deref() == Some(VIEWER))
            .expect("the accepted response is in the ledger");
        (entry.response.id, entry.response.row.expect("saved row"))
    };
    assert_eq!(
        accepted,
        SubmissionOutcome::Submitted {
            response,
            row,
            booking: Some(UnlockedBooking {
                section: BOOK_A_TIME,
                title: "Book your travel call".into(),
                description: "Pick a time with the offsite team.".into(),
                target: BookingTarget {
                    profile_id: PROFILE,
                    event_type_id: EVENT_TYPE,
                },
            }),
        }
    );
    assert_eq!(
        serde_json::to_value(&accepted).unwrap(),
        json!({
            "outcome": "submitted",
            "response": response.to_string(),
            "row": row.to_string(),
            "booking": {
                "section": BOOK_A_TIME.to_string(),
                "title": "Book your travel call",
                "description": "Pick a time with the offsite team.",
                "target": {
                    "profileId": PROFILE.to_string(),
                    "eventTypeId": EVENT_TYPE.to_string(),
                },
            },
        })
    );
}

#[tokio::test]
async fn a_form_without_a_booking_step_unlocks_nothing() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let outcome = submit_as(&forms, VIEWER, answers(EMPLOYEE)).await.unwrap();
    assert!(matches!(
        outcome,
        SubmissionOutcome::Submitted { booking: None, .. }
    ));
    assert_eq!(mine(&forms, VIEWER).await.booking, None);
}

#[tokio::test]
async fn an_anonymous_accepted_response_unlocks_the_booking_step() {
    let world = world();
    seed_booking(&world, Audience::Public);
    let outcome = service(&world)
        .submit_response(
            anonymous_receipt::<ViewAccessLevel>(RSVP_FORM),
            Submission {
                answers: answers(EMPLOYEE),
            },
        )
        .await
        .unwrap();
    let SubmissionOutcome::Submitted { booking, .. } = outcome else {
        panic!("saved, not {outcome:?}");
    };
    assert_eq!(booking, Some(unlocked()));
}

#[tokio::test]
async fn an_anonymous_stopped_response_reveals_no_destination() {
    let world = world();
    seed_booking(&world, Audience::Public);
    let outcome = service(&world)
        .submit_response(
            anonymous_receipt::<ViewAccessLevel>(RSVP_FORM),
            Submission {
                answers: answers(CONTRACTOR),
            },
        )
        .await
        .unwrap();
    assert!(matches!(outcome, SubmissionOutcome::Stopped { .. }));
    assert!(!reveals_target(&serde_json::to_string(&outcome).unwrap()));
}

#[tokio::test]
async fn a_response_whose_ledger_entry_fails_unlocks_nothing() {
    let world = world();
    seed_booking(&world, Audience::Members);
    world.lock().unwrap().fail_next_ledger_write = true;
    let failed = submit_as(&service(&world), VIEWER, answers(EMPLOYEE))
        .await
        .unwrap_err();
    assert!(!reveals_target(&format!("{failed} {failed:?}")));
}

#[tokio::test]
async fn an_invalid_submission_reveals_no_destination_in_its_error() {
    let world = world();
    seed_booking(&world, Audience::Members);
    let refused = submit_as(
        &service(&world),
        VIEWER,
        vec![Answer {
            question: TEAM_QUESTION,
            value: CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]),
        }],
    )
    .await
    .unwrap_err();
    assert!(matches!(
        refused,
        FormError::MissingAnswer {
            question: START_QUESTION
        }
    ));
    assert!(!reveals_target(&format!("{refused} {refused:?}")));
}

#[tokio::test]
async fn a_successful_edit_unlocks_the_booking_step() {
    let world = world();
    seed_booking(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, answers(EMPLOYEE)).await.unwrap();
    let edited = edit_as(&forms, VIEWER, answers(EMPLOYEE)).await.unwrap();
    let SubmissionOutcome::Submitted { booking, .. } = edited else {
        panic!("saved, not {edited:?}");
    };
    assert_eq!(booking, Some(unlocked()));
}

#[tokio::test]
async fn an_edit_stopped_at_a_gate_reveals_no_destination() {
    let world = world();
    seed_booking(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, answers(EMPLOYEE)).await.unwrap();
    let edited = edit_as(&forms, VIEWER, answers(CONTRACTOR)).await.unwrap();
    assert!(matches!(edited, SubmissionOutcome::Stopped { .. }));
    assert!(!reveals_target(&serde_json::to_string(&edited).unwrap()));
}

#[tokio::test]
async fn a_refused_edit_reveals_no_destination() {
    let world = world();
    seed_booking(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, answers(EMPLOYEE)).await.unwrap();
    world.lock().unwrap().refuse_next_batch =
        Some(::databases::domain::models::DatabaseError::NotFound);
    let refused = edit_as(&forms, VIEWER, answers(EMPLOYEE))
        .await
        .unwrap_err();
    assert!(matches!(refused, FormError::TableGone));
    assert!(!reveals_target(&format!("{refused} {refused:?}")));
}

#[tokio::test]
async fn a_saved_response_that_still_passes_reads_back_its_booking_step() {
    let world = world();
    seed_booking(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, answers(EMPLOYEE)).await.unwrap();
    let mine = mine(&forms, VIEWER).await;
    assert_eq!(mine.response.status, ResponseStatus::Submitted);
    assert_eq!(mine.booking, Some(unlocked()));
}

#[tokio::test]
async fn a_stopped_response_reads_back_no_booking_step() {
    let world = world();
    seed_booking(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, answers(CONTRACTOR))
        .await
        .unwrap();
    let mine = mine(&forms, VIEWER).await;
    assert_eq!(mine.response.status, ResponseStatus::Stopped);
    assert_eq!(mine.booking, None);
    assert!(!reveals_target(&serde_json::to_string(&mine).unwrap()));
}

#[tokio::test]
async fn a_response_whose_row_was_deleted_reads_back_no_booking_step() {
    let world = world();
    seed_booking(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, answers(EMPLOYEE)).await.unwrap();
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0]
        .rows
        .clear();
    let mine = mine(&forms, VIEWER).await;
    assert_eq!(mine.answers, vec![]);
    assert_eq!(mine.booking, None);
}

#[tokio::test]
async fn a_response_a_tightened_gate_now_stops_reads_back_no_booking_step() {
    let world = world();
    seed_booking(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, answers(EMPLOYEE)).await.unwrap();
    {
        let mut world = world.lock().unwrap();
        let layout = world.layouts.get_mut(&RSVP_FORM).unwrap();
        let FormSection::Gate { rules, .. } = &mut layout.sections[1] else {
            panic!("the second section is the gate");
        };
        *rules = FilterGroup {
            conjunction: Conjunction::And,
            conditions: vec![FilterNode::Condition(FilterCondition {
                column: TEAM,
                test: FilterTest::Options {
                    operator: SetOperator::IsNoneOf,
                    options: vec![EMPLOYEE, CONTRACTOR],
                },
            })],
        };
    }
    let mine = mine(&forms, VIEWER).await;
    assert_eq!(mine.response.status, ResponseStatus::Submitted);
    assert_eq!(mine.booking, None);
}

#[tokio::test]
async fn a_response_missing_a_newly_required_answer_reads_back_no_booking_step() {
    let world = world();
    seed_booking(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, answers(EMPLOYEE)).await.unwrap();
    {
        let mut world = world.lock().unwrap();
        let layout = world.layouts.get_mut(&RSVP_FORM).unwrap();
        let FormSection::Questions { questions, .. } = &mut layout.sections[2] else {
            panic!("the third section is logistics");
        };
        questions[0].required = true;
    }
    let mine = mine(&forms, VIEWER).await;
    assert_eq!(mine.booking, None);
}

#[tokio::test]
async fn an_editor_fixing_the_row_into_passing_restores_the_booking_step() {
    let world = world();
    seed_booking(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, answers(EMPLOYEE)).await.unwrap();
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0].rows[0]
        .1
        .insert(TEAM, CellValue::Options(vec![OptionRef::Id(CONTRACTOR)]));
    assert_eq!(mine(&forms, VIEWER).await.booking, None);
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0].rows[0]
        .1
        .insert(TEAM, CellValue::Options(vec![OptionRef::Id(EMPLOYEE)]));
    assert_eq!(mine(&forms, VIEWER).await.booking, Some(unlocked()));
}

#[tokio::test]
async fn my_response_without_a_booking_step_serializes_no_booking_field() {
    let world = world();
    seed_booking(&world, Audience::Members);
    let forms = service(&world);
    submit_as(&forms, VIEWER, answers(CONTRACTOR))
        .await
        .unwrap();
    let wire = serde_json::to_value(mine(&forms, VIEWER).await).unwrap();
    assert!(wire.get("booking").is_none());
    assert_eq!(
        serde_json::from_value::<MyResponse>(wire).unwrap().booking,
        None
    );
}
