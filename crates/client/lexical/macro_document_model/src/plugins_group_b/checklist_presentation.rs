//! Closed settings intent; the owning queued session selects presentation or edit.
use lexical_model::{Command, CommandKey, Error, ExtensionCommand, Input, KeyEvent, ViewSelection};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

/// Decoded metadata carries no access, graph or publication authority.
#[derive(Clone, Debug)]
pub struct SettingsIntent {
    pub(super) generation: u32,
    pub(super) key: u32,
    pub(super) observed_sequence: u64,
    pub(super) settings: Arc<Value>,
}
impl SettingsIntent {
    /// Reuse the existing persisted writer only after actual session Edit admission.
    pub fn edit_input(&self) -> Input {
        Input::Command {
            command: super::checklist::settings_command(
                self.key,
                self.generation,
                self.settings.as_ref().clone(),
            ),
            selection: ViewSelection::KeepModel,
        }
    }
}
static SETTINGS: CommandKey<SettingsIntent> = CommandKey::new("group-b.checklist-settings-intent");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    key: u32,
    observed_sequence: String,
    settings: Value,
}
pub(super) fn decode(
    name: &str,
    json: &str,
    generation: u32,
    event: Option<&KeyEvent>,
) -> Result<Option<Command>, Error> {
    if name != SETTINGS.name() {
        return Ok(None);
    }
    if event.is_some() {
        return Err(Error::Invariant(
            "checklist settings are not a keyboard command",
        ));
    }
    let request: Request = serde_json::from_str(json)?;
    if !request.settings.is_null() && !request.settings.is_object() {
        return Err(Error::Invariant("task-list settings object"));
    }
    let observed_sequence = request
        .observed_sequence
        .parse::<u64>()
        .map_err(|_| Error::Invariant("checklist settings sequence"))?;
    if observed_sequence == 0 || observed_sequence.to_string() != request.observed_sequence {
        return Err(Error::Invariant("checklist settings sequence"));
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &SETTINGS,
        SettingsIntent {
            generation,
            key: request.key,
            observed_sequence,
            settings: Arc::new(request.settings),
        },
    ))))
}

/// Extract only the exact private command key, independently validating selection.
pub fn input_intent(input: &Input) -> Result<Option<&SettingsIntent>, Error> {
    if let Input::Command {
        command: Command::Extension(command),
        selection,
    } = input
        && let Some(intent) = command.payload(&SETTINGS)
    {
        if !matches!(selection, ViewSelection::KeepModel) {
            return Err(Error::Invariant("checklist settings selection"));
        }
        return Ok(Some(intent));
    }
    Ok(None)
}

/// Refuse nested metadata inputs before any preceding member can mutate a model.
pub fn contains_intent(input: &Input) -> bool {
    match input {
        Input::Batch(inputs) => inputs.iter().any(contains_intent),
        Input::Command {
            command: Command::Extension(command),
            ..
        } => command.payload(&SETTINGS).is_some(),
        _ => false,
    }
}
