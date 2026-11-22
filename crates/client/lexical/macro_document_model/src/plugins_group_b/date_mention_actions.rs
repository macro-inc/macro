//! Source DateMention picker edit (DateMentionNode.setDate + setDisplayFormat).
use super::*;
use crate::nodes::{DateMentionNode, Maybe};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DateUpdate {
    key: u32,
    date: String,
    display_format: String,
}

#[derive(Clone, Debug)]
struct DateCommand {
    key: NodeKey,
    date: String,
    display_format: String,
}

static DATE: CommandKey<DateCommand> = CommandKey::new("group-b.date-mention");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != DATE.name() {
        return Ok(None);
    }
    let value: serde_json::Value = serde_json::from_str(json)?;
    if !value.is_object() {
        return Err(Error::Invariant("date mention object payload"));
    }
    let update: DateUpdate = serde_json::from_value(value)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &DATE,
        DateCommand {
            key: NodeKey::from_parts(KeyParts {
                index: update.key,
                generation,
            }),
            date: update.date,
            display_format: update.display_format,
        },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(DateMentionActions)
}

static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&DATE),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

struct DateMentionActions;
impl Plugin for DateMentionActions {
    fn name(&self) -> &'static str {
        "group-b.date-mention-actions"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(update) = command.payload(&DATE) else {
            return Ok(Handled::No);
        };
        if !tx.is::<DateMentionNode>(update.key) {
            return Ok(Handled::No);
        }
        // Source handleDateChange: a plain untagged editor.update.
        let mut node = tx.get_mut::<DateMentionNode>(update.key)?;
        node.date = Maybe::Value(update.date.clone());
        node.display_format = Maybe::Value(update.display_format.clone());
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
mod test;
