//! Entry-correlated main transaction evidence for the ordinary native profile.
use crate::*;
use lexical_model::{Handled, MainCommitOutcome};
use std::num::NonZeroU64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct InputCommitEntryId(NonZeroU64);
impl InputCommitEntryId {
    fn parse(value: &str) -> Result<Self, BoundaryError> {
        let bytes = value.as_bytes();
        if !matches!(bytes.first(), Some(b'1'..=b'9')) || !bytes.iter().all(u8::is_ascii_digit) {
            return Err(BoundaryError::Invalid("input commit correlation"));
        }
        let raw = value
            .parse::<u64>()
            .map_err(|_| BoundaryError::Invalid("input commit correlation range"))?;
        NonZeroU64::new(raw)
            .map(Self)
            .ok_or(BoundaryError::Invalid("input commit correlation"))
    }
}

#[derive(Default)]
enum InputCommitSlot {
    #[default]
    Empty,
    InFlight {
        entry_id: InputCommitEntryId,
    },
    Complete {
        entry_id: InputCommitEntryId,
        outcome: MainCommitOutcome,
    },
}
#[derive(Default)]
pub(crate) struct InputCommitLedger {
    highest: Option<InputCommitEntryId>,
    slot: InputCommitSlot,
}
impl InputCommitLedger {
    fn begin(&mut self, text: &str) -> Result<InputCommitEntryId, BoundaryError> {
        let entry_id = InputCommitEntryId::parse(text)?;
        if self.highest.is_some_and(|highest| entry_id <= highest) {
            return Err(BoundaryError::Invalid("input commit correlation reused"));
        }
        self.highest = Some(entry_id);
        self.slot = InputCommitSlot::InFlight { entry_id };
        Ok(entry_id)
    }
    fn finish(
        &mut self,
        entry_id: InputCommitEntryId,
        outcome: MainCommitOutcome,
    ) -> Result<(), BoundaryError> {
        if !matches!(self.slot, InputCommitSlot::InFlight { entry_id: current } if current == entry_id)
        {
            self.invalidate();
            return Err(BoundaryError::Invalid("input commit entry changed"));
        }
        self.slot = InputCommitSlot::Complete { entry_id, outcome };
        Ok(())
    }
    pub(crate) fn invalidate(&mut self) {
        self.slot = InputCommitSlot::Empty;
    }
    fn read(&self, text: &str) -> Result<InputCommitReceipt, BoundaryError> {
        let requested = InputCommitEntryId::parse(text)?;
        match self.slot {
            InputCommitSlot::Complete { entry_id, outcome } if requested == entry_id => {
                Ok(InputCommitReceipt { entry_id, outcome })
            }
            _ => Err(BoundaryError::Invalid("input commit receipt unavailable")),
        }
    }
}

/// Whether the exact observed main transaction reached a successful commit.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputCommitKind {
    /// No successful main transaction commit was observed for this entry.
    NotPublished,
    /// The main transaction committed, independently of later failures.
    Published,
}
/// Owned primitive evidence. This retains no editor, output or native lease.
#[wasm_bindgen]
pub struct InputCommitReceipt {
    entry_id: InputCommitEntryId,
    outcome: MainCommitOutcome,
}
#[wasm_bindgen]
impl InputCommitReceipt {
    /// The exact accepted session-local correlation identity.
    #[wasm_bindgen(getter, js_name = entryId)]
    pub fn entry_id(&self) -> u64 {
        self.entry_id.0.get()
    }
    /// Publication outcome of only the designated main transaction.
    #[wasm_bindgen(getter, js_name = mainKind)]
    pub fn main_kind(&self) -> InputCommitKind {
        match self.outcome {
            MainCommitOutcome::NotPublished => InputCommitKind::NotPublished,
            MainCommitOutcome::Published { .. } => InputCommitKind::Published,
        }
    }
    /// Actual main commit identity, absent when no main transaction committed.
    #[wasm_bindgen(getter, js_name = commitId)]
    pub fn commit_id(&self) -> Option<u64> {
        match self.outcome {
            MainCommitOutcome::NotPublished => None,
            MainCommitOutcome::Published { commit_id, .. } => Some(commit_id.0),
        }
    }
    /// Actual main command handling result, absent without a main commit.
    #[wasm_bindgen(getter, js_name = mainHandled)]
    pub fn main_handled(&self) -> Option<bool> {
        match self.outcome {
            MainCommitOutcome::NotPublished => None,
            MainCommitOutcome::Published { handled, .. } => Some(handled == Handled::Yes),
        }
    }
}

#[wasm_bindgen]
impl EditorSession {
    /// Observe the main commit of one closed programmatic application input.
    /// Correlation is a canonical nonzero decimal u64, never a graph capability.
    #[wasm_bindgen(js_name = inputObserved)]
    pub fn input_observed(
        &mut self,
        msg: &[u8],
        now: f64,
        wall: f64,
        entry_id: &str,
    ) -> Result<u32, JsError> {
        self.machine
            .input_observed(msg, now, wall, entry_id)
            .map_err(js)
    }
    /// Copy the exact completed receipt without advancing or consuming output.
    #[wasm_bindgen(js_name = readInputCommitReceipt)]
    pub fn read_input_commit_receipt(&self, entry_id: &str) -> Result<InputCommitReceipt, JsError> {
        self.machine.input_commits.read(entry_id).map_err(js)
    }
}

#[cfg(test)]
mod test;

impl machine::Machine {
    pub(crate) fn input_observed(
        &mut self,
        msg: &[u8],
        now: f64,
        wall: f64,
        entry_id: &str,
    ) -> Result<u32, BoundaryError> {
        let entry = self.input_commits.begin(entry_id)?;
        let mut outcome = MainCommitOutcome::NotPublished;
        let result = (|| {
            let msg = wire::SessionInputMsg::deserialize(msg)?;
            if msg.kind != 2
                || !matches!(&msg.editor, wire::EditorInputMsg::EditorApplication {
                    keyboard: false, key, mods: 0, code: 0, ..
                } if key.is_empty())
            {
                return Err(BoundaryError::Invalid(
                    "observed programmatic application required",
                ));
            }
            let input = editor_input::input(msg.editor, self.generation())?;
            self.call_with_main_commit(input, now, wall, &mut outcome)
        })();
        // A trap before this point leaves InFlight, never a false NotPublished.
        // Preserve an original native error if finishing the slot also fails.
        let finished = self.input_commits.finish(entry, outcome);
        result.and_then(|flags| finished.map(|()| flags))
    }
}
