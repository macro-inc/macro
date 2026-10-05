//! Collaboration is durable without an open browser, and cannot publish an
//! invalid or older revision over the last accepted layout.

use super::*;
use crate::domain::collaboration::{read_layout, replace_layout};
use crate::domain::drafts::FormDraftStore;

#[tokio::test]
async fn the_builder_initializes_an_editor_only_durable_layout() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let layout = FormLayout {
        sections: vec![FormSection::Questions {
            id: ABOUT_YOU,
            title: "Contact details".into(),
            description: "Tell us how to reach you.".into(),
            questions: vec![QuestionLayout {
                id: TEAM_QUESTION,
                column: TEAM,
                help_text: "Choose your team.".into(),
                required: true,
                widget: None,
            }],
        }],
    };
    world
        .lock()
        .unwrap()
        .layouts
        .insert(RSVP_FORM, layout.clone());

    let result = service(&world)
        .collaborate_form(form_receipt::<EditAccessLevel>(
            RSVP_FORM,
            EDITOR,
            AccessLevel::Edit,
        ))
        .await
        .expect("the editor can initialize collaboration");

    assert_eq!(result.detail.access, FormAccess::Edit);
    assert_eq!(result.publication_error, None);
    assert_eq!(result.detail.sections[0].id(), ABOUT_YOU);
    let world = world.lock().unwrap();
    assert!(world.draft_states[&RSVP_FORM].enabled);
    assert_eq!(
        read_layout(&world.drafts[&RSVP_FORM]).unwrap().layout,
        layout
    );
}

#[tokio::test]
async fn a_respondent_read_publishes_durable_edits_after_the_editor_left() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let forms = service(&world);
    forms
        .collaborate_form(form_receipt::<EditAccessLevel>(
            RSVP_FORM,
            EDITOR,
            AccessLevel::Edit,
        ))
        .await
        .unwrap();
    let mut changed = rsvp_layout();
    let FormSection::Questions { title, .. } = &mut changed.sections[0] else {
        panic!("questions");
    };
    *title = "Updated together".into();
    let snapshot = world.lock().unwrap().drafts[&RSVP_FORM].clone();
    let change = replace_layout(&snapshot, &changed).unwrap();
    FakeDrafts(world.clone())
        .update(RSVP_FORM, change.expected_revision, change.update)
        .await
        .unwrap();
    assert_eq!(world.lock().unwrap().layouts[&RSVP_FORM], rsvp_layout());

    let detail = forms
        .get_form(anonymous_receipt::<ViewAccessLevel>(RSVP_FORM))
        .await
        .unwrap();
    let crate::domain::models::FormSectionDetail::Questions { title, .. } = &detail.sections[0]
    else {
        panic!("questions");
    };
    assert_eq!(title, "Updated together");
    assert_eq!(world.lock().unwrap().layouts[&RSVP_FORM], changed);
}

#[tokio::test]
async fn an_invalid_shared_draft_remains_editable_without_replacing_the_accepted_layout() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let forms = service(&world);
    forms
        .collaborate_form(form_receipt::<EditAccessLevel>(
            RSVP_FORM,
            EDITOR,
            AccessLevel::Edit,
        ))
        .await
        .unwrap();
    let mut invalid = rsvp_layout();
    invalid.sections.swap(0, 1);
    let snapshot = world.lock().unwrap().drafts[&RSVP_FORM].clone();
    let change = replace_layout(&snapshot, &invalid).unwrap();
    FakeDrafts(world.clone())
        .update(RSVP_FORM, change.expected_revision, change.update)
        .await
        .unwrap();

    let result = forms
        .collaborate_form(form_receipt::<EditAccessLevel>(
            RSVP_FORM,
            EDITOR,
            AccessLevel::Edit,
        ))
        .await
        .unwrap();
    assert!(result.publication_error.is_some());
    assert_eq!(world.lock().unwrap().layouts[&RSVP_FORM], rsvp_layout());
    assert_eq!(
        read_layout(&world.lock().unwrap().drafts[&RSVP_FORM])
            .unwrap()
            .layout,
        invalid
    );
    let detail = forms
        .get_form(anonymous_receipt::<ViewAccessLevel>(RSVP_FORM))
        .await
        .unwrap();
    assert_eq!(detail.sections[0].id(), ABOUT_YOU);
}

#[tokio::test]
async fn stale_snapshots_never_replace_a_newer_published_revision() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    forms
        .collaborate_form(form_receipt::<EditAccessLevel>(
            RSVP_FORM,
            EDITOR,
            AccessLevel::Edit,
        ))
        .await
        .unwrap();
    let old_snapshot = world.lock().unwrap().drafts[&RSVP_FORM].clone();
    let changed = FormLayout { sections: vec![] };
    forms
        .put_layout(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            changed.clone(),
        )
        .await
        .unwrap();
    world.lock().unwrap().drafts.insert(RSVP_FORM, old_snapshot);

    let read = forms
        .get_form(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            VIEWER,
            AccessLevel::View,
        ))
        .await;
    assert!(matches!(read, Err(FormError::Conflict)));
    assert_eq!(world.lock().unwrap().layouts[&RSVP_FORM], changed);
}

#[tokio::test]
async fn a_collaboration_outage_is_reported_instead_of_serving_silently_stale_layouts() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    forms
        .collaborate_form(form_receipt::<EditAccessLevel>(
            RSVP_FORM,
            EDITOR,
            AccessLevel::Edit,
        ))
        .await
        .unwrap();
    world.lock().unwrap().fail_drafts = true;
    assert!(matches!(
        forms
            .get_form(form_receipt::<ViewAccessLevel>(
                RSVP_FORM,
                VIEWER,
                AccessLevel::View
            ))
            .await,
        Err(FormError::Collaboration(_))
    ));
}

#[tokio::test]
async fn a_tally_uses_durable_question_removals_without_an_editor_publication() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    world.lock().unwrap().forms[0].form.tally_visible = true;
    let forms = service(&world);
    forms
        .collaborate_form(form_receipt::<EditAccessLevel>(
            RSVP_FORM,
            EDITOR,
            AccessLevel::Edit,
        ))
        .await
        .unwrap();
    let snapshot = world.lock().unwrap().drafts[&RSVP_FORM].clone();
    let change = replace_layout(&snapshot, &FormLayout { sections: vec![] }).unwrap();
    FakeDrafts(world.clone())
        .update(RSVP_FORM, change.expected_revision, change.update)
        .await
        .unwrap();

    let tally = forms
        .tally(anonymous_receipt::<ViewAccessLevel>(RSVP_FORM))
        .await
        .unwrap();

    assert!(
        tally.questions.is_empty(),
        "a removed poll question must not remain visible"
    );
    assert!(
        world.lock().unwrap().layouts[&RSVP_FORM]
            .sections
            .is_empty()
    );
}
