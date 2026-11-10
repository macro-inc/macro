//! Typed content operations used by shared decorator hosts.
use super::*;
use crate::nodes::SnapshotNode;

#[derive(serde::Deserialize)]
struct Target {
    key: u32,
}

static SNAPSHOT_DELETE: CommandKey<NodeKey> = CommandKey::new("group-b.snapshot-delete");
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&SNAPSHOT_DELETE),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != SNAPSHOT_DELETE.name() {
        return Ok(None);
    }
    let target: Target = serde_json::from_str(json)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &SNAPSHOT_DELETE,
        NodeKey::from_parts(KeyParts {
            index: target.key,
            generation,
        }),
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(ContentActions)
}

struct ContentActions;

impl Plugin for ContentActions {
    fn name(&self) -> &'static str {
        "group-b.decorator-content-actions"
    }

    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }

    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(key) = command.payload(&SNAPSHOT_DELETE) else {
            return Ok(Handled::No);
        };
        if !tx.is::<SnapshotNode>(*key) {
            return Ok(Handled::No);
        }
        super::structure::remove_and_restore_selection(tx, *key)?;
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
mod test;
