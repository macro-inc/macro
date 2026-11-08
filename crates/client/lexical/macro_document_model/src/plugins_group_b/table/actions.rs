//! Typed application table actions independent of DOM controls.
use super::*;
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
enum TableAction {
    ConvertList { key: u32 },
}
#[derive(Clone, Debug)]
struct TableCommand {
    action: TableAction,
    generation: u32,
}
static TABLE: CommandKey<TableCommand> = CommandKey::new("group-b.table");
pub(in crate::plugins_group_b) fn decode(
    name: &str,
    json: &str,
    generation: u32,
) -> Result<Option<Command>, Error> {
    if name != TABLE.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &TABLE,
        TableCommand {
            action: serde_json::from_str(json)?,
            generation,
        },
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(Actions)
}
struct Actions;
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&TABLE),
    priority: CommandPriority::Editor,
    placement: Placement::After,
}];
impl Plugin for Actions {
    fn name(&self) -> &'static str {
        "group-b.table-actions"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        let Some(command) = extension.payload(&TABLE) else {
            return Ok(Handled::No);
        };
        let handled = match command.action {
            TableAction::ConvertList { key } => super::list_grid::convert(
                tx,
                NodeKey::from_parts(KeyParts {
                    index: key,
                    generation: command.generation,
                }),
            )?,
        };
        Ok(if handled { Handled::Yes } else { Handled::No })
    }
}
