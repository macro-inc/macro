//! Source documentMetadataPlugin queues `editor.update(..., { tag: 'history-merge' })`
//! after a node-mutating update whose previous version is stale. Native runs that
//! update deterministically, in the same drain right after the triggering chain is
//! projected, as its own local Loro commit.
use super::*;
use macro_document_model::plugins_group_b::{
    DOCUMENT_METADATA_UPGRADE_REQUESTED, document_metadata_normalize, document_metadata_upgrade,
};

impl EditorSurface {
    /// True when an output requests the following metadata upgrade update.
    pub(super) fn requests_metadata_upgrade(effects: &[Effect]) -> bool {
        effects.iter().any(|effect| {
            matches!(effect, Effect::PluginEvent(event)
                if event.payload(&DOCUMENT_METADATA_UPGRADE_REQUESTED).is_some())
        })
    }

    /// Source's first node-mutating update after load queues the history-merge metadata
    /// update; its full-state sync writes derived root state (search text, a parsed null
    /// slot), then the version when stale. One undo group, after the initial content.
    pub(super) fn load_follow_up(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        upgrade: bool,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError> {
        if let Some(undo) = &mut self.undo
            && self.history_ready
            && !self.group_active
        {
            self.group_active = undo.group_start().is_ok();
        }
        // Source publishes its parsed live metadata before the queued version bump.
        // Consume this state-only update in the refresh projection below, so derived
        // search text and metadata share one Loro commit and one recovery boundary.
        let normalized = match self.core.apply(
            Input::Command {
                command: document_metadata_normalize(),
                selection: ViewSelection::KeepModel,
            },
            history_time(now)?,
        ) {
            Ok(output) => output.commits,
            Err(error) => {
                if let Some(observer) = &self.reported_errors {
                    observer.reported(&error.error, view.len());
                }
                view.push(ViewEffect::Editor(Effect::FollowUpFailed {
                    plugin: "group-b.document-metadata",
                    kind: error.error.kind(),
                    message: Arc::from(error.error.to_string()),
                }));
                *error.committed
            }
        };
        let normalized = if normalized
            .iter()
            .any(|commit| commit.stored_state_superseded)
        {
            normalized.as_slice()
        } else {
            &[]
        };
        let state = self.core.state().clone();
        // Source's load write is a background update: a failed projection write is reported
        // and the open continues. Partial ops are sealed as a fixup, then the editor and its
        // projection are rebuilt from the actual document, as resync does, without
        // rerunning this follow-up. A missing projection is an invariant failure and stays
        // fatal.
        let projection = self.projection.as_mut().ok_or(SessionError::NotReady)?;
        #[cfg(feature = "test-faults")]
        if let Some(writes) = self.fail_load_refresh_after_writes.take() {
            projection.fail_after_writes(writes);
        }
        let mut upgrade = upgrade;
        let refreshed =
            match projection.refresh_root_search_text(doc, &state, normalized, now.wall.0 / 1000) {
                Ok(projected) => projected.changed,
                Err(error) => {
                    view.push(ViewEffect::Editor(Effect::FollowUpFailed {
                        plugin: "load-search-text",
                        kind: "Projection",
                        message: Arc::from(error.to_string()),
                    }));
                    doc.commit_with(
                        loro::CommitOptions::new()
                            .origin(FIXUP_ORIGIN)
                            .timestamp(now.wall.0 / 1000),
                    );
                    // Initialize carries the rebuilt state.
                    let mut rebuilt = Vec::new();
                    if let Attached::Ready { upgrade: requested } =
                        self.attach_editor(doc, now, Access::Edit, &mut rebuilt)?
                    {
                        upgrade = requested;
                    }
                    if let Some(undo) = &mut self.undo
                        && self.history_ready
                        && !self.group_active
                    {
                        self.group_active = undo.group_start().is_ok();
                    }
                    false
                }
            };
        // Only the application Metadata plugin requests the upgrade.
        if !upgrade {
            return Ok(refreshed);
        }
        Ok(self.upgrade_document_metadata(doc, now, Access::Edit, view)? || refreshed)
    }

    /// Apply and project the upgrade as its own update. Edit access only; a failure is
    /// reported as a follow-up failure and leaves the triggering update applied.
    pub(super) fn upgrade_document_metadata(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError> {
        let time = history_time(now)?;
        if access != Access::Edit || self.projection.is_none() {
            return Ok(false);
        }
        let output = match self.core.apply(
            Input::Command {
                command: document_metadata_upgrade(),
                selection: ViewSelection::KeepModel,
            },
            time,
        ) {
            Ok(output) => output,
            Err(error) => {
                if let Some(observer) = &self.reported_errors {
                    observer.reported(&error.error, view.len());
                }
                view.push(ViewEffect::Editor(Effect::FollowUpFailed {
                    plugin: "group-b.document-metadata",
                    kind: error.error.kind(),
                    message: Arc::from(error.error.to_string()),
                }));
                return Ok(false);
            }
        };
        self.group(&output.commits, time)?;
        let projection = self.projection.as_mut().ok_or(SessionError::NotReady)?;
        let projected = if self
            .undo
            .as_ref()
            .is_some_and(|undo| undo.accepts_projected_checkpoint(LOCAL_ORIGIN))
        {
            projection.local_commit_without_events(doc, &output.commits, now.wall.0 / 1000)?
        } else {
            projection.local_commit(doc, &output.commits, LOCAL_ORIGIN, now.wall.0 / 1000)?
        };
        if projected.events_suppressed && projected.changed {
            self.undo
                .as_ref()
                .ok_or(SessionError::NotReady)?
                .record_projected_checkpoint()?;
        }
        Self::output(
            output,
            view,
            &mut self.checklist,
            self.reported_errors.as_deref(),
            self.follow_up_errors.as_deref(),
        );
        Ok(projected.changed)
    }
}
