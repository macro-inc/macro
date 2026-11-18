//! Native application actions used by the shared decorator components.
use super::*;
use crate::nodes::{EquationNode, Maybe, UserMentionNode};
use indexmap::IndexMap;

#[derive(Clone, Debug, serde::Deserialize)]
struct EquationUpdate {
    key: u32,
    equation: String,
}

#[derive(Clone, Debug)]
struct EquationCommand {
    key: NodeKey,
    equation: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct DisplayNames {
    names: IndexMap<String, String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct NodeDelete {
    key: u32,
}

static DELETE: CommandKey<NodeKey> = CommandKey::new("group-b.decorator-delete");

static EQUATION: CommandKey<EquationCommand> = CommandKey::new("group-b.equation");
static DISPLAY_NAMES: CommandKey<DisplayNames> = CommandKey::new("group-b.user-display-names");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name == DELETE.name() {
        let update: NodeDelete = serde_json::from_str(json)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &DELETE,
            NodeKey::from_parts(KeyParts {
                index: update.key,
                generation,
            }),
        ))));
    }
    if name == EQUATION.name() {
        let update: EquationUpdate = serde_json::from_str(json)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &EQUATION,
            EquationCommand {
                key: NodeKey::from_parts(KeyParts {
                    index: update.key,
                    generation,
                }),
                equation: update.equation,
            },
        ))));
    }
    if name == DISPLAY_NAMES.name() {
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &DISPLAY_NAMES,
            serde_json::from_str::<DisplayNames>(json)?,
        ))));
    }
    Ok(None)
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(DecoratorActions)
}

static COMMANDS: [CommandRegistration; 3] = [
    CommandRegistration {
        command: CommandKind::Extension(&DELETE),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&EQUATION),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&DISPLAY_NAMES),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
];

struct DecoratorActions;

impl Plugin for DecoratorActions {
    fn name(&self) -> &'static str {
        "group-b.decorator-actions"
    }

    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }

    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        if let Some(key) = command.payload(&DELETE) {
            if tx.view().node(*key).is_none() {
                return Ok(Handled::No);
            }
            super::structure::remove_and_restore_selection(tx, *key)?;
            return Ok(Handled::Yes);
        }
        if let Some(update) = command.payload(&EQUATION) {
            if update.equation.is_empty() || !tx.is::<EquationNode>(update.key) {
                return Ok(Handled::No);
            }
            tx.get_mut::<EquationNode>(update.key)?.equation =
                Maybe::Value(update.equation.clone());
            return Ok(Handled::Yes);
        }
        let Some(update) = command.payload(&DISPLAY_NAMES) else {
            return Ok(Handled::No);
        };
        // Source first collects attached targets, then writes in traversal order.
        let changes: Vec<_> = tx
            .descendants(NodeKey::ROOT)
            .filter_map(|(key, _)| {
                let node = tx.get::<UserMentionNode>(key)?;
                let property = match &node.user_id {
                    Maybe::Value(id) => id.as_str(),
                    Maybe::Missing => "undefined",
                    Maybe::Null => "null",
                };
                let name = update.names.get(property)?;
                (!name.is_empty() && name != &node.display_name).then(|| (key, name.clone()))
            })
            .collect();
        for (key, name) in changes {
            tx.get_mut::<UserMentionNode>(key)?.display_name = name;
        }
        tx.add_tag(UpdateTag::Historic);
        tx.add_tag(UpdateTag::SkipDomSelection);
        tx.add_tag(UpdateTag::SkipScrollIntoView);
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
mod test;
