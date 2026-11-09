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

static ADOPT: CommandKey<StagedUpdate> = CommandKey::new("staged-adopt-update");

/// Single-consumption staged update. Clones share consumption and acknowledgement.
#[derive(Clone)]
pub struct StagedUpdate {
    pending: Arc<Mutex<Option<PendingUpdate>>>,
    adopted: Arc<AtomicBool>,
}
impl fmt::Debug for StagedUpdate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("StagedUpdate")
    }
}
impl StagedUpdate {
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

/// Core registry plus the common admission command, without behavior plugins.
/// The caller supplies its registered node types and editing handlers.
pub fn staging_editor_builder(mode: EditorMode, _: u64) -> EditorBuilder {
    register_staged_updates(Editor::builder(mode))
}
pub(crate) fn register_staged_updates(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(AdoptUpdate)
}
struct AdoptUpdate;
impl Plugin for AdoptUpdate {
    fn name(&self) -> &'static str {
        "staged-update-admission"
    }
    fn commands(&self) -> &[CommandRegistration] {
        static COMMANDS: [CommandRegistration; 2] = [
            CommandRegistration {
                command: CommandKind::Extension(&ADOPT),
                priority: CommandPriority::Critical,
                placement: Placement::Before,
            },
            CommandRegistration {
                command: CommandKind::Extension(&crate::prepared::ADOPT_PREPARED),
                priority: CommandPriority::Critical,
                placement: Placement::Before,
            },
        ];
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(update) = command.payload(&ADOPT) else {
            return crate::prepared::admit_prepared(tx, command);
        };
        let _span = tracing::info_span!("editor.staging.admit").entered();
        let pending = {
            let mut pending = update
                .pending
                .lock()
                .map_err(|_| Error::Invariant("host update lock poisoned"))?;
            pending.take()
        }
        .ok_or(Error::Invariant("host update already consumed"))?;
        tx.adopt_staged_update(pending)?;
        update.adopted.store(true, Ordering::Release);
        Ok(Handled::Yes)
    }
}
impl DocumentSession<EditorSurface> {
    /// Start on the existing core without publishing or granting edit authority.
    pub fn suspend_staged_update(&mut self) -> PendingUpdate {
        self.surface.core.suspend_staged_update()
    }
    /// Scope a primitive/callback on the existing editor, retaining opaque results.
    pub fn with_staged_update<T>(
        &mut self,
        pending: PendingUpdate,
        body: impl FnOnce(&mut Transaction<'_>) -> T,
    ) -> Result<(PendingUpdate, T), Error> {
        self.surface.core.with_staged_update(pending, body)
    }
}

#[cfg(test)]
#[path = "staging/test.rs"]
mod test;
