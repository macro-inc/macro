//! Opaque application-command transport through the model's extension pipeline.
use super::host_callbacks::{Callback, HostValue};
use lexical_model::*;
use std::sync::Arc;
use wasm_bindgen::JsValue;

// One native extension carries JS command identities. Filtering happens before a
// JS call, so unrelated commands never invoke each other's JS listeners. Priority
// ordering and snapshots remain entirely in the model's listener pipeline.
static KEY: CommandKey<Message> = CommandKey::new("conformance-js-command");
#[derive(Clone)]
struct Message {
    name: Arc<str>,
    value: HostValue,
}
impl std::fmt::Debug for Message {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HostedCommand")
    }
}
pub(super) fn command(name: &str, value: JsValue) -> Command {
    Command::Extension(ExtensionCommand::new(
        &KEY,
        Message {
            name: name.into(),
            value: HostValue::new(value),
        },
    ))
}
pub(super) fn registration(priority: u32) -> Result<CommandRegistration, JsValue> {
    let priority = match priority {
        0 => CommandPriority::Editor,
        1 => CommandPriority::Low,
        2 => CommandPriority::Normal,
        3 => CommandPriority::High,
        4 => CommandPriority::Critical,
        _ => return Err(super::debug::error("invalid command priority").into()),
    };
    Ok(CommandRegistration {
        command: CommandKind::Extension(&KEY),
        priority,
        placement: Placement::After,
    })
}
pub(super) struct Listener {
    name: Arc<str>,
    pub(super) callback: Arc<Callback>,
}
impl Listener {
    pub(super) fn new(name: &str, callback: Arc<Callback>) -> Self {
        Self {
            name: name.into(),
            callback,
        }
    }
    pub(super) fn matches(&self, name: &str, function: &js_sys::Function) -> bool {
        self.name.as_ref() == name && self.callback.matches(function)
    }
}
impl ForeignListener for Listener {
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(message) = command.payload(&KEY) else {
            return Ok(Handled::No);
        };
        if message.name != self.name {
            return Ok(Handled::No);
        }
        Ok(if self.callback.command(tx, &message.value)? {
            Handled::Yes
        } else {
            Handled::No
        })
    }
}
