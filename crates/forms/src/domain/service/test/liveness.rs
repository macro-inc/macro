//! A form's open pages hear that it changed: after each committed change of
//! its facts, layout or responses, one ping naming the form and nothing
//! else. A refused change pings nobody, and a failed ping never fails the
//! change it announces.

use entity_access::domain::models::{EditAccessLevel, OwnerAccessLevel, ViewAccessLevel};
use models_databases::{CellValue, OptionRef};

use super::*;
use crate::domain::models::{Answer, FormError, Submission, SubmissionOutcome, UpdateForm};
use crate::domain::ports::FormsService;

fn employee() -> Vec<Answer> {
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

fn contractor() -> Vec<Answer> {
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

fn pings(world: &Shared) -> Vec<FormId> {
    world.lock().unwrap().form_pings.clone()
}

#[tokio::test]
async fn each_committed_change_of_a_forms_facts_layout_and_lifecycle_pings_its_pages_once() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let owner = || form_receipt::<OwnerAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner);

    forms
        .put_layout(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            rsvp_layout(),
        )
        .await
        .unwrap();
    assert_eq!(pings(&world), vec![RSVP_FORM]);
    forms
        .update_form(
            form_receipt::<EditAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner),
            UpdateForm {
                tally_visible: Some(true),
                ..UpdateForm::default()
            },
        )
        .await
        .unwrap();
    forms
        .rename_form(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            "Offsite".into(),
        )
        .await
        .unwrap();
    forms.trash_form(owner()).await.unwrap();
    forms.restore_form(owner()).await.unwrap();
    forms.delete_form_permanently(owner()).await.unwrap();

    assert_eq!(pings(&world), vec![RSVP_FORM; 6]);
}

#[tokio::test]
async fn refused_changes_and_no_op_lifecycle_calls_ping_nobody() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let refused = forms
        .update_form(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            UpdateForm {
                audience: Some(Audience::Public),
                ..UpdateForm::default()
            },
        )
        .await;
    assert!(matches!(refused, Err(FormError::OwnerOnly)));
    let stray_column = ColumnId::from_uuid(Uuid::from_u128(0x5719));
    assert!(
        forms
            .put_layout(
                form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
                FormLayout {
                    sections: vec![FormSection::Questions {
                        id: ABOUT_YOU,
                        title: "".into(),
                        description: "".into(),
                        questions: vec![QuestionLayout {
                            id: TEAM_QUESTION,
                            column: stray_column,
                            help_text: "".into(),
                            required: false,
                            widget: None,
                        }],
                    }],
                },
            )
            .await
            .is_err()
    );
    // Restoring a form that is not in the trash changes nothing.
    forms
        .restore_form(form_receipt::<OwnerAccessLevel>(
            RSVP_FORM,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();
    assert!(pings(&world).is_empty());
}

#[tokio::test]
async fn responses_ping_the_form_when_the_ledger_or_a_row_changes() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let forms = service(&world);
    let respond = |receipt, answers| forms.submit_response(receipt, Submission { answers });

    // A signed-in stop changes the ledger's counts.
    respond(
        form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
        contractor(),
    )
    .await
    .unwrap();
    assert_eq!(pings(&world), vec![RSVP_FORM]);
    // An anonymous stop writes nothing, so it pings nobody.
    respond(
        anonymous_receipt::<ViewAccessLevel>(RSVP_FORM),
        contractor(),
    )
    .await
    .unwrap();
    assert_eq!(pings(&world), vec![RSVP_FORM]);
    // Saved responses, signed in or not.
    respond(
        form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
        employee(),
    )
    .await
    .unwrap();
    respond(anonymous_receipt::<ViewAccessLevel>(RSVP_FORM), employee())
        .await
        .unwrap();
    assert_eq!(pings(&world), vec![RSVP_FORM; 3]);

    // An accepted edit rewrites the row; a stopped edit writes nothing.
    let edited = forms
        .edit_my_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission {
                answers: employee(),
            },
        )
        .await
        .unwrap();
    assert!(matches!(edited, SubmissionOutcome::Submitted { .. }));
    assert_eq!(pings(&world), vec![RSVP_FORM; 4]);
    let stopped = forms
        .edit_my_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission {
                answers: contractor(),
            },
        )
        .await
        .unwrap();
    assert!(matches!(stopped, SubmissionOutcome::Stopped { .. }));
    assert_eq!(pings(&world), vec![RSVP_FORM; 4]);
}

#[tokio::test]
async fn a_failed_ping_never_fails_the_change_it_announces() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().fail_form_pings = true;
    let forms = service(&world);
    forms
        .put_layout(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            rsvp_layout(),
        )
        .await
        .unwrap();
    let saved = forms
        .submit_response(
            form_receipt::<ViewAccessLevel>(RSVP_FORM, VIEWER, AccessLevel::View),
            Submission {
                answers: employee(),
            },
        )
        .await
        .unwrap();
    assert!(matches!(saved, SubmissionOutcome::Submitted { .. }));
    assert_eq!(world.lock().unwrap().ledger.len(), 1);
}
