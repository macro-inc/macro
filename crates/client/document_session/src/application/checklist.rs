//! Session-owned derived output; no model state or sync clocks are synthesized.
use crate::{EditorSurface, SessionError, ViewEffect};
impl EditorSurface {
    pub(crate) fn finish_checklist_output(
        &mut self,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        for updates in self.checklist.finish(self.core.state())? {
            view.push(ViewEffect::ChecklistPlans(updates));
        }
        Ok(())
    }
}
