//! A purged form's collaborative surface: retired only once the form row is
//! gone, so a form that stays restorable keeps a live surface; and the form
//! ids collab surfaces keep off-limits to callers.

use std::sync::Arc;

#[cfg(feature = "outbound")]
use collab_surface::domain::ports::FormIds;
use entity_access::domain::models::OwnerAccessLevel;

use super::*;
use crate::domain::drafts::{FormDraftError, FormDraftStore};
use crate::domain::ports::FormsService;
#[cfg(feature = "outbound")]
use crate::outbound::collaborative_layout::RepositoryFormIds;

/// Drafts that note, at each retirement, whether the form row still existed.
#[derive(Clone)]
struct RetirementWitness {
    drafts: FakeDrafts,
    world: Shared,
    form_existed_at_retirement: Arc<Mutex<Vec<bool>>>,
}

impl FormDraftStore for RetirementWitness {
    async fn ensure(&self, id: FormId, snapshot: Vec<u8>) -> Result<(), FormDraftError> {
        self.drafts.ensure(id, snapshot).await
    }
    async fn snapshot(&self, id: FormId) -> Result<Vec<u8>, FormDraftError> {
        self.drafts.snapshot(id).await
    }
    async fn update(
        &self,
        id: FormId,
        expected_revision: Vec<u8>,
        update: Vec<u8>,
    ) -> Result<(), FormDraftError> {
        self.drafts.update(id, expected_revision, update).await
    }
    async fn retire(&self, id: FormId) -> Result<(), FormDraftError> {
        let existed = self
            .world
            .lock()
            .unwrap()
            .forms
            .iter()
            .any(|stored| stored.form.id == id);
        self.form_existed_at_retirement
            .lock()
            .unwrap()
            .push(existed);
        self.drafts.retire(id).await
    }
}

fn owner() -> EntityAccessReceipt<OwnerAccessLevel> {
    form_receipt::<OwnerAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner)
}

#[tokio::test]
async fn a_purge_retires_the_surface_only_once_the_form_is_gone() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let witness = RetirementWitness {
        drafts: FakeDrafts(world.clone()),
        world: world.clone(),
        form_existed_at_retirement: Arc::new(Mutex::new(vec![])),
    };
    let forms = FormsServiceImpl::new(
        FakeRepo(world.clone()),
        Arc::new(FakeDatabases(world.clone())),
        FakeAccess(world.clone()),
        RecordingFormEvents(world.clone()),
        FixedClock(world.clone()),
        RecordingBroker(world.clone()),
        witness.clone(),
    );
    forms.trash_form(owner()).await.unwrap();

    forms.delete_form_permanently(owner()).await.unwrap();

    // Retiring first would leave a form whose delete then failed restorable
    // with a surface that never comes back.
    assert_eq!(
        *witness.form_existed_at_retirement.lock().unwrap(),
        vec![false]
    );
    assert_eq!(world.lock().unwrap().retired_drafts, vec![RSVP_FORM]);
}

#[tokio::test]
async fn a_purge_whose_surface_retirement_fails_still_purges_the_form() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    forms.trash_form(owner()).await.unwrap();
    world.lock().unwrap().fail_drafts = true;

    // The form is gone either way; its surface is retired the next time
    // anything asks collab surfaces for it.
    forms.delete_form_permanently(owner()).await.unwrap();

    let world = world.lock().unwrap();
    assert!(world.forms.is_empty());
    assert!(world.retired_drafts.is_empty());
    assert_eq!(world.event_types(), vec!["form.trashed", "form.purged"]);
}

#[cfg(feature = "outbound")]
#[tokio::test]
async fn live_and_trashed_forms_keep_their_ids_from_collab_surfaces_until_purged() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let ids = RepositoryFormIds::new(Arc::new(FakeRepo(world.clone())));
    let forms = service(&world);

    // Live, before its builder ever opened: no surface holds the id yet.
    assert!(ids.is_form_id(RSVP_FORM.into_uuid()).await.unwrap());
    forms.trash_form(owner()).await.unwrap();
    assert!(ids.is_form_id(RSVP_FORM.into_uuid()).await.unwrap());
    forms.delete_form_permanently(owner()).await.unwrap();
    assert!(!ids.is_form_id(RSVP_FORM.into_uuid()).await.unwrap());
    assert!(!ids.is_form_id(Uuid::from_u128(0xabba)).await.unwrap());
}
