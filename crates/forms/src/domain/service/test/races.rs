//! Rules that span a form's facts and its layout hold when the two are
//! written at once, and a layout naming another form's ids is refused as a
//! repeated id. The fakes' hooks commit the concurrent write at the moment
//! the real repository's row lock would let it through.

use entity_access::domain::models::EditAccessLevel;

use super::*;
use crate::domain::models::{FormError, LayoutProblem, UpdateForm};
use crate::domain::ports::FormsService;

const RESUME: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xf11e));
const RESUME_QUESTION: FormQuestionId = FormQuestionId::from_uuid(Uuid::from_u128(0xf11f));

fn with_resume_column(world: &Shared) {
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0]
        .columns
        .push(FakeColumn {
            id: RESUME,
            name: "Resume".into(),
            kind: ColumnKind::Link,
            options: vec![],
        });
}

fn asking_for_a_file() -> FormLayout {
    FormLayout {
        sections: vec![FormSection::Questions {
            id: ABOUT_YOU,
            title: "".into(),
            description: "".into(),
            questions: vec![QuestionLayout {
                id: RESUME_QUESTION,
                column: RESUME,
                help_text: "".into(),
                required: false,
                widget: Some(Widget::File),
            }],
        }],
    }
}

#[tokio::test]
async fn a_file_question_put_while_the_form_goes_public_is_refused_and_the_layout_kept() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    with_resume_column(&world);
    // The owner's switch to public commits after the put read the form as
    // members-only, before the put writes.
    world.lock().unwrap().audience_before_next_layout_write = Some(Audience::Public);

    let refused = service(&world)
        .put_layout(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            asking_for_a_file(),
        )
        .await;

    assert!(matches!(refused, Err(FormError::FileUploadNeedsSignIn)));
    let world = world.lock().unwrap();
    assert_eq!(world.forms[0].form.audience, Audience::Public);
    assert_eq!(world.layouts.get(&RSVP_FORM), Some(&rsvp_layout()));
}

#[tokio::test]
async fn going_public_while_a_file_question_is_put_is_refused_and_the_audience_kept() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    with_resume_column(&world);
    // The editor's file question commits after the switch read the form,
    // before the switch writes.
    world.lock().unwrap().layout_before_next_update = Some(asking_for_a_file());

    let refused = service(&world)
        .update_form(
            form_receipt::<EditAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner),
            UpdateForm {
                audience: Some(Audience::Public),
                ..UpdateForm::default()
            },
        )
        .await;

    assert!(matches!(refused, Err(FormError::FileUploadNeedsSignIn)));
    let world = world.lock().unwrap();
    assert_eq!(world.forms[0].form.audience, Audience::Members);
    assert_eq!(world.layouts.get(&RSVP_FORM), Some(&asking_for_a_file()));
}

#[tokio::test]
async fn a_layout_without_a_file_question_is_written_whatever_the_audience_became() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().audience_before_next_layout_write = Some(Audience::Public);
    service(&world)
        .put_layout(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            FormLayout { sections: vec![] },
        )
        .await
        .unwrap();
    assert_eq!(
        world.lock().unwrap().layouts.get(&RSVP_FORM),
        Some(&FormLayout { sections: vec![] })
    );
}

#[tokio::test]
async fn a_layout_reusing_another_forms_id_is_a_repeated_id_and_the_old_layout_stays() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let other_form = FormId::from_uuid(Uuid::from_u128(0xf0f9));
    let taken = FormSectionId::from_uuid(Uuid::from_u128(0x5e99));
    world.lock().unwrap().layouts.insert(
        other_form,
        FormLayout {
            sections: vec![FormSection::Questions {
                id: taken,
                title: "Someone else's".into(),
                description: "".into(),
                questions: vec![],
            }],
        },
    );

    let refused = service(&world)
        .put_layout(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            FormLayout {
                sections: vec![FormSection::Questions {
                    id: taken,
                    title: "Mine".into(),
                    description: "".into(),
                    questions: vec![],
                }],
            },
        )
        .await;

    let Err(FormError::InvalidLayout(LayoutProblem::RepeatedId { id })) = refused else {
        panic!("a repeated id, not {refused:?}");
    };
    assert_eq!(id, *taken.as_uuid());
    let world = world.lock().unwrap();
    assert_eq!(world.layouts.get(&RSVP_FORM), Some(&rsvp_layout()));
    assert_eq!(
        world.layouts.get(&other_form).unwrap().sections[0].id(),
        taken
    );
}
