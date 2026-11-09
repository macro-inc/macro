//! Retain actual external commit receipts until their sparse wire delivery succeeds.
use super::*;
use lexical_model::{Commit, DirtyIntent};

const MAX_PUBLICATIONS: usize = 256;

#[derive(Clone)]
pub(super) struct Publication {
    pub(super) version: u64,
    commit: Commit,
}

impl Host {
    pub(super) fn ensure_publications_drained(&self) -> Result<(), BoundaryError> {
        if !self.publications.is_empty()
            || !self
                .receipts
                .lock()
                .map_err(|_| BoundaryError::Invalid("compatibility receipt lock"))?
                .is_empty()
        {
            return Err(BoundaryError::Invalid(
                "compatibility publications must be drained",
            ));
        }
        Ok(())
    }

    fn enqueue_publications(&mut self, state: &EditorState) -> Result<(), BoundaryError> {
        let owner = state.view().foreign_instance_owner();
        let receipts = self.receipts.clone();
        let mut receipts = receipts
            .lock()
            .map_err(|_| BoundaryError::Invalid("compatibility receipt lock"))?;
        if receipts
            .iter()
            .any(|(source, _)| !source.same_owner(&owner))
        {
            return Err(BoundaryError::Invalid(
                "unacknowledged compatibility owner receipts",
            ));
        }
        let owner_changed = !self.owner.same_owner(&owner);
        if owner_changed && (!self.cold_bootstrap || !self.publications.is_empty()) {
            return Err(BoundaryError::Invalid(
                "compatibility owner change requires an explicit cold fence",
            ));
        }
        let count = receipts.len().min(MAX_PUBLICATIONS);
        let count_u64 = u64::try_from(count)
            .map_err(|_| BoundaryError::Invalid("publication count exceeds version range"))?;
        self.next_version
            .checked_add(count_u64)
            .ok_or(BoundaryError::Invalid("publication version exhausted"))?;
        if owner_changed && count > 0 {
            self.owner_aliases.insert(owner.downgrade());
            self.owner = owner;
            self.bootstrap_fence_version = None;
        }
        let pending: Vec<_> = receipts.drain(..count).collect();
        drop(receipts);
        for (_, commit) in pending {
            let version = self.reserve_version()?;
            self.states.insert(version, commit.next.clone());
            self.publications.push_back(Publication { version, commit });
            self.version = version;
        }
        Ok(())
    }

    pub(super) fn take_inline_receipts(
        &mut self,
        state: &EditorState,
    ) -> Result<Vec<Commit>, BoundaryError> {
        let owner = state.view().foreign_instance_owner();
        if !self.publications.is_empty() || !self.owner.same_owner(&owner) {
            return Err(BoundaryError::Invalid(
                "inline admission cannot pass external publications",
            ));
        }
        let mut receipts = self
            .receipts
            .lock()
            .map_err(|_| BoundaryError::Invalid("compatibility receipt lock"))?;
        if receipts
            .iter()
            .any(|(source, _)| !source.same_owner(&owner))
        {
            return Err(BoundaryError::Invalid(
                "unacknowledged compatibility owner receipts",
            ));
        }
        Ok(std::mem::take(&mut *receipts)
            .into_iter()
            .map(|(_, commit)| commit)
            .collect())
    }

    fn external_publication(
        &mut self,
        publication: &Publication,
    ) -> Result<compat::CompatCommit, BoundaryError> {
        let commit = &publication.commit;
        let source = commit.next.view().snapshot_for_foreign_read()?;
        Ok(compat::CompatCommit {
            // Drain-only metadata creates no new Machine effects. The causal session
            // call/executor processes its actual output flags independently.
            flags: 0,
            version: publication.version,
            changed: !commit.changes.is_empty()
                || commit.prev.selection() != commit.next.selection()
                || commit.composition_changed,
            dirty_leaves: commit
                .changes
                .dirty_leaves
                .iter()
                .copied()
                .map(records::key)
                .collect(),
            dirty_elements: commit
                .changes
                .dirty_elements
                .iter()
                .map(|(key, intent)| compat::CompatDirtyElement {
                    key: records::key(*key),
                    intentional: *intent == DirtyIntent::Intentional,
                })
                .collect(),
            tags: commit.tags.iter().map(ToString::to_string).collect(),
            batch: self.publication_batch(
                &commit.next,
                std::slice::from_ref(commit),
                publication.version,
            )?,
            selection: self.selection(&source, publication.version)?,
        })
    }
}

impl EditorSession {
    pub(super) fn compat_take_publications_inner(&mut self) -> Result<Vec<u8>, BoundaryError> {
        let (host, machine) = self.compat_parts()?;
        if host.pending.is_some() {
            return Err(BoundaryError::Invalid(
                "publication drain requires a closed update",
            ));
        }
        let machine::Session::Editor(session) = &machine.session else {
            return Err(BoundaryError::Invalid("compatibility editor surface"));
        };
        let owner = session.surface().state().view().foreign_instance_owner();
        if (!host.owner.same_owner(&owner)
            && (!host.cold_bootstrap || !host.publications.is_empty()))
            || host
                .receipts
                .lock()
                .map_err(|_| BoundaryError::Invalid("compatibility receipt lock"))?
                .iter()
                .any(|(source, _)| !source.same_owner(&owner))
        {
            return Err(BoundaryError::Invalid(
                "unacknowledged compatibility owner change",
            ));
        }
        let _span =
            tracing::info_span!("editor.compat.publications.drain", editor_id = host.editor)
                .entered();
        if host.publications.is_empty() {
            host.enqueue_publications(session.surface().state())?;
        }
        let pending: Vec<_> = host.publications.iter().cloned().collect();
        let commits = pending
            .iter()
            .map(|publication| host.external_publication(publication))
            .collect::<Result<Vec<_>, _>>()?;
        let encoded = bytes(&compat::CompatPublications { commits })?;
        host.publications.clear();
        Ok(encoded)
    }
}

#[wasm_bindgen]
impl EditorSession {
    /// Drain exact external commit receipts; repeated drains return no commits.
    #[wasm_bindgen(js_name = compatTakePublications)]
    pub fn compat_take_publications(&mut self) -> Result<Vec<u8>, JsError> {
        self.compat_take_publications_inner().map_err(js)
    }
}

#[cfg(test)]
mod test;
