//! Read-only receipts from actual core publications, including changes without flat ops.
use lexical_model::*;
use std::sync::{Arc, Mutex};

pub(crate) type Receipts = Arc<Mutex<Vec<(ForeignEditorIdentity, Commit)>>>;
pub(crate) struct Observer(pub(crate) Receipts);
impl Plugin for Observer {
    fn name(&self) -> &'static str {
        "compat-publication-observer"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        self.0
            .lock()
            .map_err(|_| Error::Invariant("compatibility receipt lock poisoned"))?
            .push((tx.foreign_editor_identity(), commit.clone()));
        Ok(())
    }
}
