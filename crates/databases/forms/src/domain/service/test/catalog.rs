//! The forms catalog: every live form a viewer holds a grant on, whatever
//! their access to the form's database.

use super::*;
use crate::domain::models::{FormAccess, ListedForm};
use crate::domain::ports::FormsService;

#[tokio::test]
async fn a_viewer_of_a_form_finds_it_without_any_access_to_its_database() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world
        .lock()
        .unwrap()
        .form_grants
        .insert(VIEWER.into(), vec![(RSVP_FORM, AccessLevel::View)]);
    let listed = service(&world)
        .accessible_forms(viewer(VIEWER))
        .await
        .unwrap();
    let form = world.lock().unwrap().forms[0].form.clone();
    assert_eq!(
        listed,
        vec![ListedForm {
            form,
            access: FormAccess::View,
        }]
    );
    // Listing reads no database.
    assert!(world.lock().unwrap().batches.is_empty());
}

#[tokio::test]
async fn strangers_public_only_visitors_and_trashed_forms_are_not_listed() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let forms = service(&world);
    // A public form reached only by its link holds no grant.
    assert!(
        forms
            .accessible_forms(viewer(STRANGER))
            .await
            .unwrap()
            .is_empty()
    );
    {
        let mut world = world.lock().unwrap();
        world
            .form_grants
            .insert(EDITOR.into(), vec![(RSVP_FORM, AccessLevel::Edit)]);
        world.forms[0].trashed_at = Some(start_of_tests());
    }
    assert!(
        forms
            .accessible_forms(viewer(EDITOR))
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn the_catalog_lists_newest_first_with_each_level_and_comment_reads_as_view() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let older = FormId::from_uuid(Uuid::from_u128(0xf0f1));
    let gone = FormId::from_uuid(Uuid::from_u128(0xf0f2));
    {
        let mut world = world.lock().unwrap();
        let mut earlier = world.forms[0].clone();
        earlier.form.id = older;
        earlier.form.created_at = Utc.with_ymd_and_hms(2026, 8, 1, 9, 0, 0).unwrap();
        world.forms.push(earlier);
        world.form_grants.insert(
            EDITOR.into(),
            vec![
                (older, AccessLevel::Comment),
                (RSVP_FORM, AccessLevel::Owner),
                (gone, AccessLevel::View),
            ],
        );
    }
    let listed = service(&world)
        .accessible_forms(viewer(EDITOR))
        .await
        .unwrap();
    assert_eq!(
        listed
            .iter()
            .map(|listed| (listed.form.id, listed.access))
            .collect::<Vec<_>>(),
        vec![(RSVP_FORM, FormAccess::Owner), (older, FormAccess::View)]
    );
}

#[tokio::test]
async fn a_failed_grant_lookup_is_an_access_directory_failure_not_a_repository_one() {
    let world = world();
    world.lock().unwrap().fail_form_grants = true;
    let failed = service(&world).accessible_forms(viewer(VIEWER)).await;
    assert!(matches!(
        failed,
        Err(crate::domain::models::FormError::AccessDirectory(_))
    ));
}
