//! Transaction lifecycle over the one live SessionCore and its normal admission path.
use super::*;
use lexical_model::*;

impl Host {
    pub(super) fn reserve_version(&mut self) -> Result<u64, BoundaryError> {
        let version = self.next_version;
        self.next_version = version
            .checked_add(1)
            .ok_or(BoundaryError::Invalid("publication version exhausted"))?;
        Ok(version)
    }
    fn refresh(&mut self, state: &EditorState) -> Result<Vec<Commit>, BoundaryError> {
        let receipts = std::mem::take(
            &mut *self
                .receipts
                .lock()
                .map_err(|_| BoundaryError::Invalid("compatibility receipt lock"))?,
        );
        let owner = state.view().foreign_instance_owner();
        let commits: Vec<_> = receipts
            .into_iter()
            .filter(|(receipt_owner, _)| receipt_owner.same_owner(&owner))
            .map(|(_, commit)| commit)
            .collect();
        if !self.owner.same_owner(&owner) || !commits.is_empty() {
            self.version = self.reserve_version()?;
            self.owner_aliases.insert(owner.downgrade());
            self.owner = owner;
            self.states.insert(self.version, state.clone());
        }
        Ok(commits)
    }
}
impl EditorSession {
    pub(super) fn compat_parts(
        &mut self,
    ) -> Result<(&mut Host, &mut machine::Machine), BoundaryError> {
        Ok((
            self.compatibility
                .as_mut()
                .ok_or(BoundaryError::Invalid("compatibility session required"))?,
            &mut self.machine,
        ))
    }
    pub(super) fn compat_begin_inner(&mut self, tags: &[u8]) -> Result<(), BoundaryError> {
        let tags = compat::CompatBegin::deserialize(tags)?;
        let (host, machine) = self.compat_parts()?;
        if host.pending.is_some() {
            return Err(BoundaryError::Invalid(
                "compatibility update already active",
            ));
        }
        let machine::Session::Editor(session) = &mut machine.session else {
            return Err(BoundaryError::Invalid("compatibility editor surface"));
        };
        host.refresh(session.surface().state())?;
        let update = host
            .update
            .checked_add(1)
            .ok_or(BoundaryError::Invalid("update identity exhausted"))?;
        let pending = session.suspend_compat_update();
        let (pending, ()) = session.with_compat_update(pending, |tx| {
            for tag in tags.tags {
                tx.add_tag(tag.parse().expect("custom update tags are infallible"));
            }
        })?;
        host.pending_version = Some(host.reserve_version()?);
        host.update = update;
        host.pending = Some(pending);
        Ok(())
    }
    pub(super) fn compat_flush_inner(&mut self) -> Result<(), BoundaryError> {
        let (host, machine) = self.compat_parts()?;
        let machine::Session::Editor(session) = &mut machine.session else {
            return Err(BoundaryError::Invalid("compatibility editor surface"));
        };
        let pending = host
            .pending
            .take()
            .ok_or(BoundaryError::Invalid("compatibility update required"))?;
        let (pending, result) = session.with_compat_update(pending, |tx| {
            let result = tx.flush();
            let active = tx
                .selection()
                .and_then(|_| tx.foreign_selection_identity(SelectionSlot::Active));
            host.selection_values
                .reconcile_active(active.as_ref(), host.update);
            result
        })?;
        host.pending = Some(pending);
        result?;
        Ok(())
    }
    pub(super) fn compat_finish_noop_inner(&mut self) -> Result<bool, BoundaryError> {
        let (host, machine) = self.compat_parts()?;
        let machine::Session::Editor(session) = &mut machine.session else {
            return Err(BoundaryError::Invalid("compatibility editor surface"));
        };
        let pending = host
            .pending
            .take()
            .ok_or(BoundaryError::Invalid("compatibility update required"))?;
        let (pending, effects) =
            session.with_compat_update(pending, |tx| tx.has_foreign_effects())?;
        if effects {
            host.pending = Some(pending);
            Ok(false)
        } else {
            let dropped_version = host.pending_version.take();
            host.discard_reservations();
            host.selection_values.finish_update(host.update, false);
            if let Some(version) = dropped_version {
                host.selection_values.release_graph(version);
                host.abandon_capture_graph(version);
            }
            host.prune_capture_index()?;
            Ok(true)
        }
    }
    pub(super) fn compat_current_version_inner(&mut self) -> Result<u64, BoundaryError> {
        let (host, machine) = self.compat_parts()?;
        let machine::Session::Editor(session) = &machine.session else {
            return Err(BoundaryError::Invalid("compatibility editor surface"));
        };
        host.refresh(session.surface().state())?;
        Ok(host.version)
    }
    pub(super) fn compat_snapshot_inner(
        &mut self,
        version: u64,
    ) -> Result<compat::CompatSnapshot, BoundaryError> {
        let (host, _) = self.compat_parts()?;
        let state = host
            .states
            .get(&version)
            .ok_or(BoundaryError::Invalid("unknown compatibility version"))?
            .clone();
        let source = state.view().snapshot_for_foreign_read()?;
        Ok(compat::CompatSnapshot {
            version,
            batch: host.batch(&state, version)?,
            selection: host.selection(&source, version)?,
        })
    }
    pub(super) fn compat_commit_inner(
        &mut self,
        now: f64,
        wall: f64,
    ) -> Result<compat::CompatCommit, BoundaryError> {
        codec::now(now, wall)?;
        let dropped = self.compatibility.as_ref().and_then(|host| {
            host.pending
                .as_ref()
                .map(|_| (host.update, host.pending_version))
        });
        let mut flags = 0;
        let result = self
            .compat_commit_admitted_inner(now, wall, false, &mut flags)
            .and_then(|(packet, error)| error.map_or(Ok(packet), Err));
        if let (Err(_), Some((update, version))) = (&result, dropped) {
            let host = self
                .compatibility
                .as_mut()
                .ok_or(BoundaryError::Invalid("compatibility session required"))?;
            if version == Some(host.version) && host.pending_version != version {
                // A real publication remains authoritative even if its output also
                // reported an error; never retire that newly published graph here.
                return result;
            }
            // The legacy finalizer consumes this update even when admission is
            // refused; retained owned values become detached, not stale Active.
            host.pending = None;
            host.pending_version = None;
            host.discard_reservations();
            host.selection_values.finish_update(update, false);
            if let Some(version) = version {
                host.selection_values.release_graph(version);
                host.abandon_capture_graph(version);
            }
            host.prune_capture_index()?;
        }
        result
    }
    pub(super) fn compat_commit_admitted_inner(
        &mut self,
        now: f64,
        wall: f64,
        recover_refusal: bool,
        observed_flags: &mut u32,
    ) -> Result<(compat::CompatCommit, Option<BoundaryError>), BoundaryError> {
        let (host, machine) = self.compat_parts()?;
        let pending = host
            .pending
            .take()
            .ok_or(BoundaryError::Invalid("compatibility update required"))?;
        if !recover_refusal {
            host.discard_reservations();
        }
        let adoption = document_session::compatibility::CompatUpdate::new(pending);
        let previous_version = host.version;
        let flags = machine.call(adoption.input(), now, Some(wall))?;
        *observed_flags = flags;
        let machine::Session::Editor(session) = &mut machine.session else {
            return Err(BoundaryError::Invalid("compatibility editor surface"));
        };
        let error = session.last_output().view.iter().find_map(|effect| {
            if let document_session::ViewEffect::Error(error) = effect {
                Some(BoundaryError::Model(Error::invariant(error.to_string())))
            } else {
                None
            }
        });
        if !adoption.was_adopted() {
            if recover_refusal {
                let pending = adoption.recover_unadopted()?.ok_or(BoundaryError::Invalid(
                    "refused update ownership was consumed",
                ))?;
                let (pending, reopened) =
                    session.with_compat_update(pending, |tx| tx.reopen_foreign_reconciliation())?;
                host.pending = Some(pending);
                reopened?;
            }
            return Err(error.unwrap_or(BoundaryError::Invalid(
                "compatibility update was not admitted",
            )));
        }
        if recover_refusal {
            host.discard_reservations();
        }
        let commits = host.refresh(session.surface().state())?;
        if commits.is_empty() {
            return Err(error.unwrap_or(BoundaryError::Invalid("adopted update did not publish")));
        }
        let pending_version = host
            .pending_version
            .take()
            .ok_or(BoundaryError::Invalid("pending publication version"))?;
        let refreshed_version = host.version;
        if refreshed_version != previous_version {
            host.states.remove(&refreshed_version);
        }
        host.version = pending_version;
        let publication = session
            .surface()
            .state()
            .view()
            .snapshot_for_foreign_read()?;
        host.selection_values
            .reconcile_active(publication.selection_identity(), host.update);
        host.selection_values.finish_update(host.update, true);
        host.states
            .insert(pending_version, session.surface().state().clone());
        let mut leaves = vec![];
        let mut elements: Vec<compat::CompatDirtyElement> = vec![];
        let mut tags = vec![];
        let mut seen_leaves = std::collections::HashSet::new();
        let mut element_indices: HashMap<NodeKey, usize> = HashMap::new();
        let mut seen_tags = std::collections::HashSet::new();
        let mut changed = false;
        for commit in &commits {
            changed |= !commit.changes.is_empty()
                || commit.prev.selection() != commit.next.selection()
                || commit.composition_changed;
            for key in &commit.changes.dirty_leaves {
                if seen_leaves.insert(*key) {
                    leaves.push(records::key(*key));
                }
            }
            for (key, intent) in &commit.changes.dirty_elements {
                let intentional = *intent == DirtyIntent::Intentional;
                if let Some(index) = element_indices.get(key) {
                    elements[*index].intentional |= intentional;
                } else {
                    element_indices.insert(*key, elements.len());
                    elements.push(compat::CompatDirtyElement {
                        key: records::key(*key),
                        intentional,
                    });
                }
            }
            for tag in commit.tags.iter() {
                let tag = tag.to_string();
                if seen_tags.insert(tag.clone()) {
                    tags.push(tag);
                }
            }
        }
        let state = session.surface().state().clone();
        let source = state.view().snapshot_for_foreign_read()?;
        Ok((
            compat::CompatCommit {
                flags,
                version: host.version,
                changed,
                dirty_leaves: leaves,
                dirty_elements: elements,
                tags,
                batch: host.publication_batch(&state, &commits, host.version)?,
                selection: host.selection(&source, host.version)?,
            },
            error,
        ))
    }
}
#[wasm_bindgen]
impl EditorSession {
    /// Open unpublished edits on this session's actual core.
    #[wasm_bindgen(js_name=compatBegin)]
    pub fn compat_begin(&mut self, tags: &[u8]) -> Result<(), JsError> {
        self.compat_begin_inner(tags).map_err(js)
    }
    /// Normalize the unpublished update without admitting or publishing it.
    #[wasm_bindgen(js_name=compatFlush)]
    pub fn compat_flush(&mut self) -> Result<(), JsError> {
        self.compat_flush_inner().map_err(js)
    }
    /// Admit the staged update through the normal readiness, access and WAL path.
    #[wasm_bindgen(js_name=compatCommit)]
    pub fn compat_commit(&mut self, now: f64, wall: f64) -> Result<Vec<u8>, JsError> {
        self.compat_commit_inner(now, wall)
            .and_then(|packet| bytes(&packet))
            .map_err(js)
    }
    /// Discard unpublished edits without rolling back other session inputs.
    #[wasm_bindgen(js_name=compatDiscard)]
    pub fn compat_discard(&mut self) -> Result<(), JsError> {
        let (host, _) = self.compat_parts().map_err(js)?;
        if host.pending.is_none() {
            return Ok(());
        }
        host.pending = None;
        let dropped_version = host.pending_version.take();
        host.discard_reservations();
        host.selection_values.finish_update(host.update, false);
        if let Some(version) = dropped_version {
            host.selection_values.release_graph(version);
            host.abandon_capture_graph(version);
        }
        host.prune_capture_index().map_err(js)?;
        Ok(())
    }
    /// Close a flushed no-op without publishing a replacement state or listeners.
    #[wasm_bindgen(js_name=compatFinishNoop)]
    pub fn compat_finish_noop(&mut self) -> Result<bool, JsError> {
        self.compat_finish_noop_inner().map_err(js)
    }
    /// Observe native publications outside the JS update path without reusing versions.
    #[wasm_bindgen(js_name=compatCurrentVersion)]
    pub fn compat_current_version(&mut self) -> Result<u64, JsError> {
        self.compat_current_version_inner().map_err(js)
    }
    /// Capture the exact retained publication, including version zero.
    #[wasm_bindgen(js_name=compatSnapshot)]
    pub fn compat_snapshot(&mut self, version: u64) -> Result<Vec<u8>, JsError> {
        self.compat_snapshot_inner(version)
            .and_then(|packet| bytes(&packet))
            .map_err(js)
    }
    /// Release a retained historical publication and its captured host references.
    #[wasm_bindgen(js_name=compatReleaseVersion)]
    pub fn compat_release_version(&mut self, version: u64) -> Result<(), JsError> {
        self.compat_release_version_inner(version).map_err(js)
    }
}

impl EditorSession {
    pub(super) fn compat_release_version_inner(
        &mut self,
        version: u64,
    ) -> Result<(), BoundaryError> {
        let (host, _) = self.compat_parts()?;
        if version >= host.next_version
            || version == host.version
            || host.pending_version == Some(version)
        {
            return Err(BoundaryError::Invalid(
                "cannot release unissued or active compatibility version",
            ));
        }
        let epoch = host
            .retirement_epoch
            .checked_add(1)
            .ok_or(BoundaryError::Invalid("capture retirement epoch exhausted"))?;
        host.states.remove(&version);
        host.selection_values.release_graph(version);
        let removed = host.capture_leases.retire_graph(version);
        host.remove_captures(removed);
        host.owner_aliases.retain(|owner| owner.upgrade().is_some());
        host.retirement_epoch = epoch;
        Ok(())
    }
}
