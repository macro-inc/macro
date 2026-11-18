//! Sealed main transitions admitted through the ordinary synchronous session policy.
use crate::*;
use lexical_model::*;
use std::{
    fmt,
    sync::{Arc, Mutex},
};

pub(crate) static ADOPT_PREPARED: CommandKey<PreparedAdmission> =
    CommandKey::new("staged-adopt-prepared-update");

enum AdmissionState {
    Pending(Box<PreparedUpdate>),
    InFlight,
    Adopted,
    Recovered,
}
struct Admission {
    state: Mutex<AdmissionState>,
    receipt: PreparedReceipt,
}

/// Single-consumption admission for a genuine sealed MAIN transition.
/// Readiness/access checks remain in handle. After-commit follow-ups and Loro
/// history remain on the ordinary path; main publication is not a drained chain.
#[derive(Clone)]
pub struct PreparedAdmission(Arc<Admission>);
impl fmt::Debug for PreparedAdmission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PreparedAdmission")
            .field("receipt", &self.0.receipt)
            .finish_non_exhaustive()
    }
}
impl PreparedAdmission {
    /// Retain one real sealed update while the host schedules DOM work.
    pub fn new(prepared: PreparedUpdate) -> Self {
        Self(Arc::new(Admission {
            receipt: prepared.receipt(),
            state: Mutex::new(AdmissionState::Pending(Box::new(prepared))),
        }))
    }
    /// Route through normal handle; never add this command to local_commands.
    /// The caller separately rechecks its durable-state generation before admission.
    pub fn input(&self) -> SessionInput {
        SessionInput::Editor(Input::Command {
            command: Command::Extension(ExtensionCommand::new(&ADOPT_PREPARED, self.clone())),
            selection: ViewSelection::KeepModel,
        })
    }
    /// Actual main publication, even if later output encoding fails.
    /// An adopted update without this receipt is a fatal failure, never a retry.
    pub fn main_publication(&self) -> Option<CommitId> {
        self.0.receipt.main_publication()
    }
    /// Whether the command transferred the capsule; this is not publication proof.
    pub fn was_adopted(&self) -> Result<bool, Error> {
        Ok(matches!(
            *self
                .0
                .state
                .lock()
                .map_err(|_| Error::Invariant("prepared admission lock poisoned"))?,
            AdmissionState::Adopted
        ))
    }
    /// Recover exactly once after a refusal before adoption; never undo publication.
    pub fn recover_unadopted(&self) -> Result<Option<PreparedUpdate>, Error> {
        let mut state = self
            .0
            .state
            .lock()
            .map_err(|_| Error::Invariant("prepared admission lock poisoned"))?;
        match std::mem::replace(&mut *state, AdmissionState::Recovered) {
            AdmissionState::Pending(prepared) => Ok(Some(*prepared)),
            AdmissionState::InFlight => {
                *state = AdmissionState::InFlight;
                Err(Error::Invariant("prepared admission is in progress"))
            }
            other => {
                *state = other;
                Ok(None)
            }
        }
    }
    fn adopt(&self, tx: &mut Transaction<'_>) -> Result<Handled, Error> {
        let prepared = {
            let mut state = self
                .0
                .state
                .lock()
                .map_err(|_| Error::Invariant("prepared admission lock poisoned"))?;
            match std::mem::replace(&mut *state, AdmissionState::InFlight) {
                AdmissionState::Pending(prepared) => prepared,
                other => {
                    *state = other;
                    return Err(Error::Invariant("prepared update already consumed"));
                }
            }
        };
        let _span = tracing::info_span!("editor.prepared.admit").entered();
        match tx.adopt_prepared_update(*prepared) {
            Ok(()) => {
                *self
                    .0
                    .state
                    .lock()
                    .map_err(|_| Error::Invariant("prepared admission lock poisoned"))? =
                    AdmissionState::Adopted;
                Ok(Handled::Yes)
            }
            Err(refusal) => {
                let (error, prepared) = refusal.into_parts();
                *self
                    .0
                    .state
                    .lock()
                    .map_err(|_| Error::Invariant("prepared admission lock poisoned"))? =
                    AdmissionState::Pending(Box::new(prepared));
                Err(error)
            }
        }
    }
}

pub(crate) fn admit_prepared(
    tx: &mut Transaction<'_>,
    command: &ExtensionCommand,
) -> Result<Handled, Error> {
    match command.payload(&ADOPT_PREPARED) {
        Some(prepared) => prepared.adopt(tx),
        None => Ok(Handled::No),
    }
}

impl DocumentSession<EditorSurface> {
    /// Prepare the genuine main transition without publication or I/O.
    /// This model epoch is not the canonical Loro/durable-state generation.
    pub fn prepare_staged_update(
        &mut self,
        pending: PendingUpdate,
    ) -> Result<PreparedUpdate, PreparationFailure> {
        self.surface.core.prepare_staged_update(pending)
    }
}

#[cfg(test)]
#[path = "prepared/test.rs"]
mod test;
