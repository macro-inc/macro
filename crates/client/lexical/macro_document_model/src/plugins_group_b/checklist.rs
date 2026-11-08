//! Checkbox commands and persisted task-list display settings.
use super::*;
use crate::nodes::set_task_list_view_settings;
use lexical_rich_nodes::list::{
    ListItemNode,
    item::{get_checked, toggle_checked},
};
use std::sync::Arc;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
enum ChecklistAction {
    Toggle {
        key: u32,
    },
    ToggleSelection,
    Settings {
        key: u32,
        settings: serde_json::Value,
    },
}
#[derive(Clone, Debug)]
struct ChecklistCommand {
    action: ChecklistAction,
    generation: u32,
}
static CHECKLIST: CommandKey<ChecklistCommand> = CommandKey::new("group-b.checklist");
pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != CHECKLIST.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &CHECKLIST,
        ChecklistCommand {
            action: serde_json::from_str(json)?,
            generation,
        },
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(Checklist)
}
static COMMANDS: [CommandRegistration; 2] = [
    CommandRegistration {
        command: CommandKind::Extension(&CHECKLIST),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::Enter),
        priority: CommandPriority::Low,
        placement: Placement::After,
    },
];
struct Checklist;
impl Plugin for Checklist {
    fn name(&self) -> &'static str {
        "group-b.checklist"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        match command {
            Command::Extension(extension) => {
                let Some(command) = extension.payload(&CHECKLIST) else {
                    return Ok(Handled::No);
                };
                let key = |index| {
                    NodeKey::from_parts(KeyParts {
                        index,
                        generation: command.generation,
                    })
                };
                match &command.action {
                    ChecklistAction::Toggle { key: index } => {
                        let key = key(*index);
                        let Some(item) = tx
                            .view()
                            .cast::<ListItemNode>(key)
                            .filter(|key| tx.is_attached(*key))
                        else {
                            return Ok(Handled::No);
                        };
                        toggle_checked(tx, item)?;
                    }
                    ChecklistAction::ToggleSelection => toggle_selection(tx)?,
                    ChecklistAction::Settings {
                        key: index,
                        settings,
                    } => {
                        let key = key(*index);
                        if !tx.is_attached(key) || !tx.is::<lexical_rich_nodes::list::ListNode>(key)
                        {
                            return Ok(Handled::No);
                        }
                        if !settings.is_null() && !settings.is_object() {
                            return Err(Error::Invariant("task-list settings object"));
                        }
                        set_task_list_view_settings(tx, key, Arc::new(settings.clone()))?;
                    }
                }
                Ok(Handled::Yes)
            }
            Command::Key {
                command: KeyCommand::Enter,
                event: Some(event),
            } => {
                let modifier = if tx.view_host().is_apple() {
                    event.meta
                } else {
                    event.ctrl
                };
                if !modifier || event.shift {
                    return Ok(Handled::No);
                }
                toggle_selection(tx)?;
                Ok(Handled::Yes)
            }
            _ => Ok(Handled::No),
        }
    }
}
fn toggle_selection(tx: &mut Transaction<'_>) -> Result<(), Error> {
    let Some(range) = tx.selection().and_then(Selection::as_range) else {
        return Ok(());
    };
    let nodes = range.nodes(tx.view())?;
    let mut items = Vec::new();
    let mut first_checked = None;
    for mut key in nodes {
        while key != NodeKey::ROOT && tx.parent(key) != Some(NodeKey::ROOT) {
            if let Some(item) = tx.view().cast::<ListItemNode>(key) {
                if first_checked.is_none() {
                    first_checked = get_checked(tx, item);
                }
                if !items.contains(&item) {
                    items.push(item);
                }
                break;
            }
            let Some(parent) = tx.parent(key) else {
                break;
            };
            key = parent;
        }
    }
    for item in items {
        if first_checked.is_none() || get_checked(tx, item) == first_checked {
            toggle_checked(tx, item)?;
        }
    }
    Ok(())
}
