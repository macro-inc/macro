use super::*;
use crate::people::sync::{
    CachedMembership, ContactReconcile, ContactSnapshot, ContactSnapshotRequest, cached_member,
};

impl<S: Storage> Engine<S> {
    /// Capture the contact-write fence under the host lock. Optional enumeration
    /// visits at most one storage page and returns identities only.
    pub async fn contact_snapshot(
        &mut self,
        request: &ContactSnapshotRequest,
    ) -> Result<ContactSnapshot, EngineError<S::Error>> {
        self.people_scope(&request.scope).await?;
        let mut result = ContactSnapshot {
            fence: self.contact_fence,
            ids: vec![],
            next_cursor: None,
            incomplete: false,
        };
        if let Some(scan) = &request.scan {
            if scan.limit == 0
                || scan.limit > MAX_PEOPLE_BATCH
                || scan
                    .after
                    .as_ref()
                    .is_some_and(|value| value.len() > 1024 || value.contains('\0'))
            {
                return Err(PeopleError::InvalidInput.into());
            }
            if self.current_identity().await?.as_deref() != Some(request.scope.identity.as_str()) {
                return Err(EngineError::StaleHydrationScope);
            }
            result.next_cursor = self
                .storage
                .scan_contact_records(scan.after.as_deref(), scan.limit, |key, record| {
                    match cached_member(&request.scope.identity, key, record) {
                        CachedMembership::Member(id) => result.ids.push(id),
                        CachedMembership::NotMember => {}
                        CachedMembership::Incomplete => result.incomplete = true,
                    }
                })
                .await
                .map_err(EngineError::Storage)?;
        }
        Ok(result)
    }

    /// Apply exact, complete membership evidence. No page omission reaches this
    /// method. Any intervening contact authority invalidates the whole request,
    /// even if that write supplied identical values.
    pub async fn reconcile_contacts(
        &mut self,
        request: &ContactReconcile,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.people_scope(&request.scope).await?;
        if self.current_identity().await?.as_deref() != Some(request.scope.identity.as_str())
            || request.viewer != request.scope.identity
        {
            return Err(EngineError::StaleHydrationScope);
        }
        if request.fence != self.contact_fence {
            return Err(EngineError::StaleContactFence);
        }
        if request.requested.len() > MAX_PEOPLE_BATCH
            || request.present.len() > MAX_PEOPLE_BATCH
            || request
                .requested
                .iter()
                .chain(&request.present)
                .any(|id| id.as_ref().len() > 1024)
        {
            return Err(PeopleError::InvalidInput.into());
        }
        let viewer = MacroUserIdStr::parse_from_str(&request.viewer)
            .map_err(|_| PeopleError::InvalidInput)?;
        let requested: BTreeSet<_> = request.requested.iter().map(|id| id.as_ref()).collect();
        let present: BTreeSet<_> = request.present.iter().map(|id| id.as_ref()).collect();
        if present.len() != request.present.len()
            || !present.is_subset(&requested)
            || (requested.contains(viewer.as_ref()) && !present.contains(viewer.as_ref()))
        {
            return Err(PeopleError::InvalidInput.into());
        }
        let keys = requested
            .difference(&present)
            .map(|id| people::contact_key(&request.viewer, id))
            .collect::<Vec<_>>();
        let changed = !keys.is_empty();
        let result = if changed {
            self.delete_keys(&keys).await?
        } else {
            self.revisioned(BTreeSet::new())
        };
        // Consume a nonempty all-present verification without publishing a fake
        // data change. Older absence responses cannot undo this observation.
        if !requested.is_empty() {
            self.contact_fence = Uuid::now_v7();
        }
        if changed {
            self.live_queries
                .extend(result.revision, keys.iter().cloned(), Vec::new());
        }
        Ok(WriteResult {
            field_changes: Some(
                keys.iter()
                    .cloned()
                    .map(|key| crate::field_changes::RecordFieldChange::Invalidate { key })
                    .collect(),
            ),
            changed: keys.into_iter().collect(),
            affected_ops: result.value,
            revision: result.revision,
            revision_advanced: changed,
            search_changed_buckets: Some(BTreeSet::from(["person".into()])),
            identity_errors: vec![],
            mutation_uuid: None,
            reset: false,
            revalidations: vec![],
        })
    }
}
