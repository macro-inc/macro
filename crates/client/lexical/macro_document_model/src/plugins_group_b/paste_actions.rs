//! Source PasteNode actions behind the paste chip menu.
use super::*;
use crate::nodes::{Maybe, PasteNode};

#[derive(Clone, Debug, serde::Deserialize)]
struct PasteAction {
    key: u32,
}

static TO_TEXT: CommandKey<NodeKey> = CommandKey::new("group-b.paste-to-text");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != TO_TEXT.name() {
        return Ok(None);
    }
    let action: PasteAction = serde_json::from_str(json)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &TO_TEXT,
        NodeKey::from_parts(KeyParts {
            index: action.key,
            generation,
        }),
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(PasteActions)
}

static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&TO_TEXT),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

struct PasteActions;
impl Plugin for PasteActions {
    fn name(&self) -> &'static str {
        "group-b.paste-actions"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(paste) = command.payload(&TO_TEXT) else {
            return Ok(Handled::No);
        };
        let Some(node) = tx.get::<PasteNode>(*paste) else {
            return Ok(Handled::No);
        };
        // Source would pass undefined content to the markdown importer; a
        // missing payload stays an explicit refusal here.
        let Maybe::Value(content) = node.content.clone() else {
            return Ok(Handled::No);
        };
        to_text(tx, *paste, &content)?;
        Ok(Handled::Yes)
    }
}

/// Source $convertPasteToText.
fn to_text(tx: &mut Transaction<'_>, paste: NodeKey, content: &str) -> Result<(), Error> {
    let wrapper = tx.create(Paragraph {})?.key();
    tx.replace(paste, wrapper, false)?;
    super::markdown_unwrap::import_unwrap_select(tx, wrapper, content)
}

#[cfg(test)]
mod test;
