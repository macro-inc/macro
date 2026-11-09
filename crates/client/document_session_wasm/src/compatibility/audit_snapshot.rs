//! Cold retention facts; observing these counters never advances the editor.
use super::*;

impl EditorSession {
    fn compat_audit_snapshot_inner(&self) -> Result<compat::CompatAuditSnapshot, BoundaryError> {
        let host = self
            .compatibility
            .as_ref()
            .ok_or(BoundaryError::Invalid("compatibility session required"))?;
        if host.pending.is_some() {
            return Err(BoundaryError::Invalid(
                "compatibility audit requires a closed update",
            ));
        }
        let machine::Session::Editor(session) = &self.machine.session else {
            return Err(BoundaryError::Invalid("compatibility editor surface"));
        };
        let state = session.surface().state();
        let published = host
            .states
            .get(&host.version)
            .ok_or(BoundaryError::Invalid(
                "current compatibility graph is not retained",
            ))?;
        let receipts = host
            .receipts
            .lock()
            .map_err(|_| BoundaryError::Invalid("compatibility receipt lock"))?;
        if !receipts.is_empty()
            || !host
                .owner
                .same_owner(&state.view().foreign_instance_owner())
            || !state.same_snapshot(published)
        {
            return Err(BoundaryError::Invalid(
                "compatibility audit requires acknowledged publications",
            ));
        }
        Ok(compat::CompatAuditSnapshot {
            version: host.version,
            retirement_epoch: host.retirement_epoch,
            retained_captures: u64::try_from(host.captures.len())
                .map_err(|_| BoundaryError::Invalid("capture count exceeds audit range"))?,
            live_nodes: u64::try_from(session.surface().state().node_count())
                .map_err(|_| BoundaryError::Invalid("node count exceeds audit range"))?,
        })
    }
}
#[wasm_bindgen]
impl EditorSession {
    /// Observe retained captures and actual live nodes outside measured editing windows.
    #[wasm_bindgen(js_name = compatAuditSnapshot)]
    pub fn compat_audit_snapshot(&self) -> Result<Vec<u8>, JsError> {
        self.compat_audit_snapshot_inner()
            .and_then(|value| bytes(&value))
            .map_err(js)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn cold_counts_observe_release_without_allocating_captures_or_advancing_state(
    ) -> Result<(), BoundaryError> {
        let config = wire::SessionConfigMsg {
            doc: "compat-audit-counts".into(),
            session: "00000000-0000-0000-0000-000000000001".into(),
            user: "fixture-user".into(),
            peers: vec![41, 42, 43],
            access: wire::Access::Edit,
            transport: wire::Transport::None,
            durable: false,
            chatter: false,
            headless: false,
            view_engine: 1,
            view_os: 0,
            token: String::new(),
            traceparent: String::new(),
            coalesce: 25,
            snapshot_interval: 0,
            observed: vec![],
        };
        let mut editor = EditorSession::create_compat_inner(
            generated::ABI_MAJOR,
            &bytes(&config)?,
            0.0,
            0.0,
            &bytes(&compat::CompatConfig {
                editor_id: 1,
                classes: vec![],
            })?,
        )?;
        let empty = editor.compat_audit_snapshot_inner()?;
        assert!(empty.retained_captures == 0);
        assert!(empty.live_nodes == 1);
        editor.compat_snapshot_inner(0)?;
        let captured = editor.compat_audit_snapshot_inner()?;
        assert!(captured.retained_captures == 1);
        assert!(captured.live_nodes == 1);
        for _ in 0..3 {
            let observed = editor.compat_audit_snapshot_inner()?;
            assert_eq!(observed, captured);
        }
        editor
            .compat_discard()
            .expect("no pending update to discard");
        let unchanged = editor.compat_audit_snapshot_inner()?;
        assert_eq!(unchanged, captured);
        let host = editor.compatibility.as_ref().unwrap();
        assert_eq!(host.version, 0);
        assert_eq!(host.next_capture, 2);
        assert_eq!(host.states.len(), 1);
        assert!(host.states[&0]
            .view()
            .node_or_err(lexical_model::NodeKey::ROOT)?
            .foreign_raw_root_cached_text()
            .is_none());
        editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
        assert!(editor.compat_audit_snapshot_inner().is_err());
        editor.compat_discard().expect("discard pending");
        editor
            .machine
            .sync(doc_sync_core::SyncInput::Start, 0.0, None)?;
        editor.machine.sync(
            doc_sync_core::SyncInput::Seed {
                kind: doc_sync_core::SeedKind::Optimistic,
                snapshot: vec![],
            },
            1.0,
            None,
        )?;
        assert!(editor.compat_audit_snapshot_inner().is_err());
        let version = editor.compat_current_version_inner()?;
        assert!(version > 0);
        let before = editor.compat_audit_snapshot_inner()?;
        editor.compat_release_version(0).expect("retire graph");
        let released = editor.compat_audit_snapshot_inner()?;
        assert!(released.retained_captures == 0);
        assert!(released.live_nodes == before.live_nodes);
        assert!(released.version == version);
        assert!(released.retirement_epoch == before.retirement_epoch + 1);
        editor
            .compat_release_version(0)
            .expect("acknowledge valid empty prune");
        let repeated = editor.compat_audit_snapshot_inner()?;
        assert!(repeated.retained_captures == released.retained_captures);
        assert!(repeated.version == released.version);
        assert!(repeated.retirement_epoch == released.retirement_epoch + 1);
        let observed = editor.compat_audit_snapshot_inner()?;
        assert_eq!(observed, repeated);
        let host = editor.compatibility.as_mut().unwrap();
        host.retirement_epoch = u64::MAX;
        assert!(host.prune_capture_index().is_err());
        assert_eq!(host.retirement_epoch, u64::MAX);
        Ok(())
    }
}
