use super::*;
use crate::domain::drafts::{
    FormDraftError, FormDraftRepository, FormDraftStore, LayoutDraftState, LayoutProjection,
};
use loro::{ExportMode, LoroDoc};

#[derive(Clone)]
pub(crate) struct FakeDrafts(pub(crate) Shared);

fn available(world: &World) -> Result<(), FormDraftError> {
    if world.fail_drafts {
        return Err(FormDraftError::Unavailable(rootcause::report!(
            "draft service unavailable"
        )));
    }
    Ok(())
}

impl FormDraftStore for FakeDrafts {
    async fn ensure(&self, id: FormId, snapshot: Vec<u8>) -> Result<(), FormDraftError> {
        let mut world = self.0.lock().unwrap();
        available(&world)?;
        world.drafts.entry(id).or_insert(snapshot);
        Ok(())
    }
    async fn snapshot(&self, id: FormId) -> Result<Vec<u8>, FormDraftError> {
        let world = self.0.lock().unwrap();
        available(&world)?;
        world
            .drafts
            .get(&id)
            .cloned()
            .ok_or_else(|| FormDraftError::Unavailable(rootcause::report!("draft missing")))
    }
    async fn update(
        &self,
        id: FormId,
        expected_revision: Vec<u8>,
        update: Vec<u8>,
    ) -> Result<(), FormDraftError> {
        let mut world = self.0.lock().unwrap();
        available(&world)?;
        let snapshot = world
            .drafts
            .get_mut(&id)
            .ok_or_else(|| FormDraftError::Unavailable(rootcause::report!("draft missing")))?;
        let document = LoroDoc::new();
        document.import(snapshot).unwrap();
        if document.oplog_vv() != loro::VersionVector::decode(&expected_revision).unwrap() {
            return Err(FormDraftError::Conflict);
        }
        document.import(&update).unwrap();
        *snapshot = document.export(ExportMode::Snapshot).unwrap();
        Ok(())
    }
    async fn retire(&self, id: FormId) -> Result<(), FormDraftError> {
        let mut world = self.0.lock().unwrap();
        available(&world)?;
        world.drafts.remove(&id);
        world.retired_drafts.push(id);
        Ok(())
    }
}

impl FormDraftRepository for FakeRepo {
    type Error = FakeError;
    async fn conflicting_layout_id(
        &self,
        id: FormId,
        layout: &FormLayout,
    ) -> Result<Option<uuid::Uuid>, Self::Error> {
        let world = self.0.lock().unwrap();
        let others: Vec<_> = world
            .layouts
            .iter()
            .filter(|(form, _)| **form != id)
            .flat_map(|(_, layout)| layout_ids(layout))
            .collect();
        Ok(layout_ids(layout)
            .into_iter()
            .find(|id| others.contains(id)))
    }
    async fn draft_state(&self, id: FormId) -> Result<Option<LayoutDraftState>, Self::Error> {
        let world = self.0.lock().unwrap();
        Ok(live(&world, id).map(|_| world.draft_states.get(&id).cloned().unwrap_or_default()))
    }
    async fn enable_draft(&self, id: FormId) -> Result<bool, Self::Error> {
        let mut world = self.0.lock().unwrap();
        if live(&world, id).is_none() {
            return Ok(false);
        }
        world.draft_states.entry(id).or_default().enabled = true;
        Ok(true)
    }
    async fn project_layout(
        &self,
        id: FormId,
        layout: &FormLayout,
        expected_revision: Option<&[u8]>,
        revision: &[u8],
        updated_at: DateTime<Utc>,
        required_audience: Option<Audience>,
    ) -> Result<LayoutProjection, Self::Error> {
        let mut world = self.0.lock().unwrap();
        if live(&world, id).is_none() {
            return Ok(LayoutProjection::Written(LayoutReplacement::FormGone));
        }
        let state = world.draft_states.entry(id).or_default();
        if !state.enabled || state.revision.as_deref() != expected_revision {
            return Ok(LayoutProjection::RevisionChanged);
        }
        let outcome = replace_layout_locked(&mut world, id, layout, updated_at, required_audience)?;
        if outcome == LayoutReplacement::Replaced {
            world.draft_states.get_mut(&id).unwrap().revision = Some(revision.to_vec());
        }
        Ok(LayoutProjection::Written(outcome))
    }
}
