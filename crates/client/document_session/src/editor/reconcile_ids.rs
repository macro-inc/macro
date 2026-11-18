//! The Source post-Loro ID pass is a separate update after the import commits.
use super::*;

impl EditorSurface {
    pub(super) fn reconcile_root_id(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError> {
        if let Some(capture) = &self.follow_up_errors {
            capture.clear();
        }
        let output = self
            .core
            .apply(
                Input::Command {
                    command: Command::Extension(ExtensionCommand::new(
                        &builder::RECONCILE_ROOT_ID,
                        (),
                    )),
                    selection: ViewSelection::KeepModel,
                },
                history_time(now)?,
            )
            .map_err(|error| {
                Self::failed_dom_disposition(&error, view);
                self.checklist.observe(&error.committed);
                SessionError::Model(error.error)
            })?;
        // C-ROOT-ID-UNDO-01: Source records this write as an id-only local undo step.
        // Persist the repair, but exclude it from native undo like other remote fix-ups.
        let changed = if access == Access::Edit {
            self.projection
                .as_mut()
                .ok_or(SessionError::NotReady)?
                .local_commit(doc, &output.commits, FIXUP_ORIGIN, now.wall.0 / 1000)?
                .changed
        } else {
            false
        };
        Self::output(
            output,
            view,
            &mut self.checklist,
            self.reported_errors.as_deref(),
            self.follow_up_errors.as_deref(),
        );
        Ok(changed)
    }
}
