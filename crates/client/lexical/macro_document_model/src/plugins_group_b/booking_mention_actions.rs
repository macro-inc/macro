//! Booking display-label updates from the rendered component.
use super::*;
use crate::nodes::{BookingLinkMentionNode, Maybe};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct LabelUpdate {
    key: u32,
    label: String,
}

#[derive(Clone, Debug)]
struct LabelCommand {
    key: NodeKey,
    label: String,
}

static LABEL: CommandKey<LabelCommand> = CommandKey::new("group-b.booking-mention-label");
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&LABEL),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != LABEL.name() {
        return Ok(None);
    }
    let object: serde_json::Map<String, serde_json::Value> = serde_json::from_str(json)?;
    let update: LabelUpdate = serde_json::from_value(serde_json::Value::Object(object))?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &LABEL,
        LabelCommand {
            key: NodeKey::from_parts(KeyParts {
                index: update.key,
                generation,
            }),
            label: update.label,
        },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(BookingActions)
}

struct BookingActions;

impl Plugin for BookingActions {
    fn name(&self) -> &'static str {
        "group-b.booking-label"
    }

    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }

    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(command) = command.payload(&LABEL) else {
            return Ok(Handled::No);
        };
        let Some(current) = tx.get::<BookingLinkMentionNode>(command.key) else {
            return Ok(Handled::No);
        };
        if command.label.is_empty() || current.label.as_deref() == Some(command.label.as_str()) {
            return Ok(Handled::No);
        }
        tx.get_mut::<BookingLinkMentionNode>(command.key)?.label =
            Maybe::Value(command.label.clone());
        tx.add_tag(UpdateTag::Historic);
        tx.add_tag(UpdateTag::SkipDomSelection);
        tx.add_tag(UpdateTag::SkipScrollIntoView);
        Ok(Handled::Yes)
    }
}
