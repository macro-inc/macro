//! Anonymous forms: who responded is kept apart from what they answered, at
//! every level of access, and still nobody responds twice.

use databases_types::{CellValue, CellWrite, DatabaseOp, OptionRef, RowsChange};
use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};

use super::*;
use crate::domain::models::{
    Answer, FormError, MyResponse, SharingRefusal, Submission, SubmissionOutcome, UpdateForm,
};
use crate::domain::ports::{CreateFormCommand, CreateSource, FormsService};

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

fn seed_anonymous(world: &Shared) {
    seed_rsvp(world, Audience::Members);
    world.lock().unwrap().forms[0].form.anonymous = true;
}

#[tokio::test]
async fn an_anonymous_response_leaves_a_receipt_and_a_dated_ledger_entry_naming_nobody() {
    let world = world();
    seed_anonymous(&world);
    let outcome = submit_as(&service(&world), VIEWER, employee_answers())
        .await
        .unwrap();
    let SubmissionOutcome::Submitted { response, row, .. } = outcome else {
        panic!("saved, not {outcome:?}");
    };
    let day = Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap();
    let world = world.lock().unwrap();
    assert_eq!(world.receipts, vec![(RSVP_FORM, VIEWER.to_string())]);
    assert_eq!(world.ledger.len(), 1);
    assert_eq!(world.ledger[0].respondent, None);
    assert_eq!(world.ledger[0].response.id, response);
    assert_eq!(world.ledger[0].response.row, Some(row));
    assert_eq!(world.ledger[0].response.submitted_at, day);
    assert_eq!(world.ledger[0].response.updated_at, day);
    // Written as the owner, with no Respondent cell and only the day.
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
                            value: CellValue::Date(day),
                        },
                    ]],
                },
            }],
        }]
    );
}

#[tokio::test]
async fn an_anonymous_response_event_names_nobody_and_carries_only_the_day() {
    let world = world();
    seed_anonymous(&world);
    submit_as(&service(&world), VIEWER, employee_answers())
        .await
        .unwrap();
    let world = world.lock().unwrap();
    assert_eq!(world.event_types(), vec!["form.response_submitted"]);
    let metadata = &world.events[0]["metadata"];
    assert!(metadata.get("respondent").is_none());
    assert_eq!(metadata["submitted_at"], "2026-09-01T00:00:00Z");
    assert!(!world.events[0].to_string().contains(VIEWER));
}

#[tokio::test]
async fn a_second_anonymous_response_is_refused_and_writes_nothing() {
    let world = world();
    seed_anonymous(&world);
    let forms = service(&world);
    submit_as(&forms, VIEWER, employee_answers()).await.unwrap();
    let again = submit_as(&forms, VIEWER, employee_answers()).await;
    assert!(matches!(again, Err(FormError::AlreadyResponded)));
    let world = world.lock().unwrap();
    assert_eq!(world.batches.len(), 1);
    assert_eq!(world.ledger.len(), 1);
    assert_eq!(world.receipts.len(), 1);
}

#[tokio::test]
async fn an_anonymous_response_racing_another_by_the_same_person_is_refused_by_the_receipt() {
    let world = world();
    seed_anonymous(&world);
    world.lock().unwrap().competing_submission = Some((RSVP_FORM, VIEWER.to_string()));
    let raced = submit_as(&service(&world), VIEWER, employee_answers()).await;
    assert!(matches!(raced, Err(FormError::AlreadyResponded)));
    let world = world.lock().unwrap();
    assert_eq!(world.receipts, vec![(RSVP_FORM, VIEWER.to_string())]);
    assert_eq!(world.ledger.len(), 1);
}

#[tokio::test]
async fn a_respondent_reads_back_only_that_they_responded_to_an_anonymous_form() {
    let world = world();
    seed_anonymous(&world);
    let forms = service(&world);
    submit_as(&forms, VIEWER, employee_answers()).await.unwrap();
    let mine = forms
        .my_response(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            VIEWER,
            AccessLevel::View,
        ))
        .await
        .unwrap();
    assert_eq!(mine, MyResponse::Anonymous);
    let stranger = forms
        .my_response(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            STRANGER,
            AccessLevel::View,
        ))
        .await;
    assert!(matches!(stranger, Err(FormError::NoResponse)));
}

#[tokio::test]
async fn an_anonymous_response_cannot_be_changed() {
    let world = world();
    seed_anonymous(&world);
    let forms = service(&world);
    submit_as(&forms, VIEWER, employee_answers()).await.unwrap();
    let refused = forms
        .edit_my_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission {
                answers: employee_answers(),
            },
        )
        .await;
    assert!(matches!(refused, Err(FormError::AnonymousResponseFinal)));
    assert_eq!(world.lock().unwrap().batches.len(), 1);
}

#[tokio::test]
async fn a_gate_stop_on_an_anonymous_form_leaves_no_trace() {
    let world = world();
    seed_anonymous(&world);
    let outcome = submit_as(
        &service(&world),
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
        ],
    )
    .await
    .unwrap();
    assert!(matches!(outcome, SubmissionOutcome::Stopped { .. }));
    let world = world.lock().unwrap();
    assert!(world.ledger.is_empty());
    assert!(world.receipts.is_empty());
}

#[tokio::test]
async fn whether_a_form_is_anonymous_is_fixed_once_anyone_responds() {
    for (starts_anonymous, change) in [(false, true), (true, false)] {
        let world = world();
        seed_rsvp(&world, Audience::Members);
        world.lock().unwrap().forms[0].form.anonymous = starts_anonymous;
        let forms = service(&world);
        submit_as(&forms, VIEWER, employee_answers()).await.unwrap();
        let refused = forms
            .update_form(
                form_receipt::<EditAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner),
                UpdateForm {
                    anonymous: Some(change),
                    ..UpdateForm::default()
                },
            )
            .await;
        assert!(matches!(
            refused,
            Err(FormError::InvalidSharing(SharingRefusal::AnonymityLocked))
        ));
        assert_eq!(
            world.lock().unwrap().forms[0].form.anonymous,
            starts_anonymous
        );
    }
}

#[tokio::test]
async fn a_form_turns_anonymous_while_nobody_has_responded() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let form = service(&world)
        .update_form(
            form_receipt::<EditAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner),
            UpdateForm {
                anonymous: Some(true),
                ..UpdateForm::default()
            },
        )
        .await
        .unwrap();
    assert!(form.anonymous);
}

#[tokio::test]
async fn a_form_created_anonymous_has_no_respondent_column() {
    let world = world();
    let detail = service(&world)
        .create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "Lunch poll".into(),
                source: CreateSource::NewDatabase {
                    is_hidden_in_drive: true,
                    anonymous: true,
                },
            },
        )
        .await
        .unwrap();
    assert!(detail.form.anonymous);
    assert_eq!(detail.form.respondent_column_id, None);
    let world = world.lock().unwrap();
    let names: Vec<&str> = world.databases[0].tables[0]
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect();
    assert_eq!(names, vec!["Submitted"]);
}

/// Everything a fmt subscriber writes, spans opening and closing included.
#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Captured {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test(flavor = "current_thread")]
async fn no_span_or_log_of_an_anonymous_response_names_its_respondent() {
    let captured = Captured::default();
    let writer = captured.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::FULL)
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);
    tracing::callsite::rebuild_interest_cache();

    let world = world();
    seed_anonymous(&world);
    let forms = service(&world);
    submit_as(&forms, VIEWER, employee_answers()).await.unwrap();
    // A refused second vote logs its error.
    let again = submit_as(&forms, VIEWER, employee_answers()).await;
    assert!(matches!(again, Err(FormError::AlreadyResponded)));

    let output = String::from_utf8(captured.0.lock().unwrap().clone()).unwrap();
    assert!(output.contains("submit_response"), "spans were captured");
    assert!(!output.contains(VIEWER), "{output}");
}
