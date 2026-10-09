//! A form's facts and lifecycle: who may change what, rename, trash,
//! restore, permanent deletion, and listing a database's forms.

use entity_access::domain::models::{EditAccessLevel, OwnerAccessLevel, ViewAccessLevel};

use super::*;
use crate::domain::models::{FormError, UpdateForm};
use crate::domain::ports::FormsService;

#[tokio::test]
async fn an_editor_changes_the_wording_but_only_the_owner_changes_who_responds_and_when() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    world.lock().unwrap().now = Utc.with_ymd_and_hms(2026, 9, 2, 9, 0, 0).unwrap();
    let worded = forms
        .update_form(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            UpdateForm {
                description: Some("Tell us by Friday.".into()),
                confirmation_message: Some("See you there!".into()),
                ..UpdateForm::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(worded.description, "Tell us by Friday.");
    assert_eq!(worded.confirmation_message, "See you there!");
    assert_eq!(
        worded.updated_at,
        Utc.with_ymd_and_hms(2026, 9, 2, 9, 0, 0).unwrap()
    );

    for owner_only in [
        UpdateForm {
            audience: Some(Audience::Public),
            ..UpdateForm::default()
        },
        UpdateForm {
            status: Some(FormStatus::Closed),
            ..UpdateForm::default()
        },
        UpdateForm {
            closes_at: Some(Some(start_of_tests())),
            ..UpdateForm::default()
        },
        UpdateForm {
            tally_visible: Some(true),
            ..UpdateForm::default()
        },
    ] {
        let refused = forms
            .update_form(
                form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
                owner_only,
            )
            .await;
        assert!(matches!(refused, Err(FormError::OwnerOnly)));
    }

    let closing = Utc.with_ymd_and_hms(2026, 10, 3, 17, 0, 0).unwrap();
    let owned = forms
        .update_form(
            form_receipt::<EditAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner),
            UpdateForm {
                audience: Some(Audience::Public),
                status: Some(FormStatus::Closed),
                closes_at: Some(Some(closing)),
                tally_visible: Some(true),
                ..UpdateForm::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(owned.audience, Audience::Public);
    assert_eq!(owned.status, FormStatus::Closed);
    assert_eq!(owned.closes_at, Some(closing));
    assert!(owned.tally_visible);

    let reopened = forms
        .update_form(
            form_receipt::<EditAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner),
            UpdateForm {
                status: Some(FormStatus::Open),
                closes_at: Some(None),
                ..UpdateForm::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(reopened.closes_at, None);
    assert_eq!(reopened.status, FormStatus::Open);
    assert_eq!(reopened.description, "Tell us by Friday.");
}

#[tokio::test]
async fn a_form_asking_for_a_file_cannot_go_public() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    {
        let mut world = world.lock().unwrap();
        world.database_mut(RSVP_DATABASE).tables[0]
            .columns
            .push(FakeColumn {
                id: ColumnId::from_uuid(Uuid::from_u128(0xf11e)),
                name: "Resume".into(),
                kind: ColumnKind::Link,
                options: vec![],
            });
        let layout = world.layouts.get_mut(&RSVP_FORM).unwrap();
        let FormSection::Questions { questions, .. } = &mut layout.sections[2] else {
            panic!("logistics");
        };
        questions.push(QuestionLayout {
            id: FormQuestionId::from_uuid(Uuid::from_u128(0xf11f)),
            column: ColumnId::from_uuid(Uuid::from_u128(0xf11e)),
            help_text: "".into(),
            required: false,
            widget: Some(Widget::File),
        });
    }
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
    assert_eq!(
        world.lock().unwrap().forms[0].form.audience,
        Audience::Members
    );
}

#[tokio::test]
async fn a_description_longer_than_allowed_is_refused() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let refused = service(&world)
        .update_form(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            UpdateForm {
                description: Some("x".repeat(10_001)),
                ..UpdateForm::default()
            },
        )
        .await;
    assert!(matches!(refused, Err(FormError::InvalidLayout(_))));
}

#[tokio::test]
async fn renaming_a_form_leaves_its_database_alone_and_is_announced() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let renamed = service(&world)
        .rename_form(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            " Offsite RSVP ".into(),
        )
        .await
        .unwrap();
    assert_eq!(renamed.name, "Offsite RSVP");
    let world = world.lock().unwrap();
    assert_eq!(world.database(RSVP_DATABASE).name, "Q4 offsite RSVP");
    assert!(world.batches.is_empty());
    assert_eq!(world.event_types(), vec!["form.renamed"]);
    assert_eq!(world.events[0]["metadata"]["name"], "Offsite RSVP");
    assert_eq!(
        world.events[0]["metadata"]["attribution"]["actor"],
        serde_json::json!(EDITOR)
    );
}

#[tokio::test]
async fn trash_restore_and_purge_are_announced_and_never_touch_the_database() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let owner = || form_receipt::<OwnerAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner);

    forms.trash_form(owner()).await.unwrap();
    // Trashing twice is a no-op.
    forms.trash_form(owner()).await.unwrap();
    assert!(matches!(
        forms
            .get_form(form_receipt::<ViewAccessLevel>(
                RSVP_FORM,
                VIEWER,
                AccessLevel::View
            ))
            .await,
        Err(FormError::NotFound)
    ));
    forms.restore_form(owner()).await.unwrap();
    forms.restore_form(owner()).await.unwrap();
    forms
        .get_form(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            VIEWER,
            AccessLevel::View,
        ))
        .await
        .unwrap();
    forms.delete_form_permanently(owner()).await.unwrap();

    let world = world.lock().unwrap();
    assert_eq!(
        world.event_types(),
        vec!["form.trashed", "form.restored", "form.purged"]
    );
    assert!(world.forms.is_empty());
    assert!(world.layouts.is_empty());
    assert!(world.owner_grants.is_empty());
    assert_eq!(world.databases.len(), 1);
    assert!(world.purged_databases.is_empty());
    assert!(world.batches.is_empty());
}

#[tokio::test]
async fn a_database_lists_its_live_forms() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let listed = forms
        .forms_for_database(database_receipt::<ViewAccessLevel>(
            RSVP_DATABASE,
            VIEWER,
            AccessLevel::View,
        ))
        .await
        .unwrap();
    assert_eq!(
        listed.iter().map(|form| form.id).collect::<Vec<_>>(),
        vec![RSVP_FORM]
    );
    world.lock().unwrap().forms[0].trashed_at = Some(start_of_tests());
    assert!(
        forms
            .forms_for_database(database_receipt::<ViewAccessLevel>(
                RSVP_DATABASE,
                VIEWER,
                AccessLevel::View,
            ))
            .await
            .unwrap()
            .is_empty()
    );
    // A form receipt is not a database receipt.
    assert!(matches!(
        forms
            .forms_for_database(form_receipt::<ViewAccessLevel>(
                RSVP_FORM,
                VIEWER,
                AccessLevel::View
            ))
            .await,
        Err(FormError::NotFound)
    ));
}

#[tokio::test]
async fn a_database_receipt_is_not_a_form_receipt() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let refused = service(&world)
        .get_form(database_receipt::<ViewAccessLevel>(
            RSVP_DATABASE,
            OWNER,
            AccessLevel::Owner,
        ))
        .await;
    assert!(matches!(refused, Err(FormError::NotFound)));
}
