//! Same-core host transactions admitted by the normal session input path.
use super::*;
use lexical_model::*;
use std::{
    fmt,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

static ADOPT: CommandKey<CompatUpdate> = CommandKey::new("compat-adopt-update");

/// Single-consumption staged update. Clones share consumption and acknowledgement.
#[derive(Clone)]
pub struct CompatUpdate {
    pending: Arc<Mutex<Option<PendingUpdate>>>,
    adopted: Arc<AtomicBool>,
}
impl fmt::Debug for CompatUpdate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CompatUpdate")
    }
}
impl CompatUpdate {
    /// Keep unpublished state owned while ordinary session admission runs.
    pub fn new(pending: PendingUpdate) -> Self {
        Self {
            pending: Arc::new(Mutex::new(Some(pending))),
            adopted: Arc::new(AtomicBool::new(false)),
        }
    }
    /// Route through DocumentSession.handle; never whitelist this command as local.
    pub fn input(&self) -> SessionInput {
        SessionInput::Editor(Input::Command {
            command: Command::Extension(ExtensionCommand::new(&ADOPT, self.clone())),
            selection: ViewSelection::KeepModel,
        })
    }
    /// Recover ownership after ordinary policy rejects the command before adoption.
    /// This does not undo an adopted update or an already published transition.
    pub fn recover_unadopted(&self) -> Result<Option<PendingUpdate>, Error> {
        if self.was_adopted() {
            return Ok(None);
        }
        Ok(self
            .pending
            .lock()
            .map_err(|_| Error::Invariant("host update lock poisoned"))?
            .take())
    }
    /// Adoption is not a successful-commit receipt; callers must also check output errors.
    pub fn was_adopted(&self) -> bool {
        self.adopted.load(Ordering::Acquire)
    }
}

/// Core registry plus the internal admission command, without behavior plugins.
/// The host must add exactly its registered JS classes and handlers.
pub fn compat_editor_builder(mode: EditorMode, _: u64) -> EditorBuilder {
    Editor::builder(mode).plugin(AdoptUpdate)
}
struct AdoptUpdate;
impl Plugin for AdoptUpdate {
    fn name(&self) -> &'static str {
        "compat-update-admission"
    }
    fn commands(&self) -> &[CommandRegistration] {
        static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
            command: CommandKind::Extension(&ADOPT),
            priority: CommandPriority::Critical,
            placement: Placement::Before,
        }];
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(update) = command.payload(&ADOPT) else {
            return Ok(Handled::No);
        };
        let _span = tracing::info_span!("editor.compat.admit").entered();
        let pending = {
            let mut pending = update
                .pending
                .lock()
                .map_err(|_| Error::Invariant("host update lock poisoned"))?;
            pending.take()
        }
        .ok_or(Error::Invariant("host update already consumed"))?;
        tx.adopt_foreign_update(pending)?;
        update.adopted.store(true, Ordering::Release);
        Ok(Handled::Yes)
    }
}
impl DocumentSession<EditorSurface> {
    /// Start on the existing core without publishing or granting edit authority.
    pub fn suspend_compat_update(&mut self) -> PendingUpdate {
        self.surface.core.suspend_foreign_update()
    }
    /// Scope a primitive/callback on the existing editor, retaining opaque results.
    pub fn with_compat_update<T>(
        &mut self,
        pending: PendingUpdate,
        body: impl FnOnce(&mut Transaction<'_>) -> T,
    ) -> Result<(PendingUpdate, T), Error> {
        self.surface.core.with_foreign_update(pending, body)
    }
}

#[cfg(test)]
#[path = "compatibility/test.rs"]
mod test;
