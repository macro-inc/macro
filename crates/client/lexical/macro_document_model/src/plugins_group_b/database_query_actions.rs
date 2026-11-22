//! Source DatabaseQuery insertion and save/discard behind the database answer editor.
use super::*;
use crate::nodes::{DatabaseQueryData, DatabaseQueryDisplayMode, DatabaseQueryNode};

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct InsertInput {}

#[derive(Clone, Debug, serde::Deserialize)]
struct SaveInput {
    key: u32,
    data: serde_json::Value,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct DiscardInput {
    key: u32,
}

#[derive(Clone, Debug)]
struct SaveCommand {
    key: NodeKey,
    data: DatabaseQueryData,
}

static INSERT: CommandKey<u32> = CommandKey::new("group-b.database-query-insert");
static SAVE: CommandKey<SaveCommand> = CommandKey::new("group-b.database-query-save");
static DISCARD: CommandKey<NodeKey> = CommandKey::new("group-b.database-query-discard");

fn key(index: u32, generation: u32) -> NodeKey {
    NodeKey::from_parts(KeyParts { index, generation })
}

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name == INSERT.name() {
        let object: serde_json::Map<String, serde_json::Value> = serde_json::from_str(json)?;
        let _: InsertInput = serde_json::from_value(serde_json::Value::Object(object))?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &INSERT, generation,
        ))));
    }
    if name == SAVE.name() {
        let input: SaveInput = serde_json::from_str(json)?;
        let data = crate::nodes::parse_database_query_data(&input.data)
            .ok_or(Error::Invariant("database query save data"))?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &SAVE,
            SaveCommand {
                key: key(input.key, generation),
                data,
            },
        ))));
    }
    if name == DISCARD.name() {
        let input: DiscardInput = serde_json::from_str(json)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &DISCARD,
            key(input.key, generation),
        ))));
    }
    Ok(None)
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(DatabaseQueryActions)
}

static COMMANDS: [CommandRegistration; 3] = [
    CommandRegistration {
        command: CommandKind::Extension(&INSERT),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&SAVE),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&DISCARD),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
];

struct DatabaseQueryActions;
impl Plugin for DatabaseQueryActions {
    fn name(&self) -> &'static str {
        "group-b.database-query-actions"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        if let Some(generation) = command.payload(&INSERT) {
            if *generation != tx.committed_state().max_key().generation() {
                return Ok(Handled::No);
            }
            let node = tx.create(DatabaseQueryNode {
                data: DatabaseQueryData {
                    query_id: String::new(),
                    prompt: String::new(),
                    display_mode: DatabaseQueryDisplayMode::Scalar,
                    ..Default::default()
                },
            })?;
            tx.insert_nodes_at_selection(&[node.key()])?;
            return Ok(Handled::Yes);
        }
        if let Some(save) = command.payload(&SAVE) {
            if !tx.is::<DatabaseQueryNode>(save.key) {
                return Ok(Handled::No);
            }
            self::save(tx, save.key, &save.data)?;
            return Ok(Handled::Yes);
        }
        let Some(node) = command.payload(&DISCARD) else {
            return Ok(Handled::No);
        };
        if !tx.is::<DatabaseQueryNode>(*node) {
            return Ok(Handled::No);
        }
        // The caret goes back to where the block was inserted.
        tx.select_previous(*node, None, None)?;
        tx.remove(*node, false)?;
        Ok(Handled::Yes)
    }
}

fn is_scalar(data: &DatabaseQueryData) -> bool {
    data.display_mode == DatabaseQueryDisplayMode::Scalar
}

/// Source DatabaseQuery `save`.
fn save(tx: &mut Transaction<'_>, node: NodeKey, data: &DatabaseQueryData) -> Result<(), Error> {
    let inline = tx
        .get::<DatabaseQueryNode>(node)
        .is_some_and(|current| is_scalar(&current.data));
    let create = |tx: &mut Transaction<'_>| -> Result<NodeKey, Error> {
        Ok(tx.create(DatabaseQueryNode { data: data.clone() })?.key())
    };
    if inline && !is_scalar(data) {
        let parent = tx.parent(node);
        if let Some(parent) =
            parent.filter(|parent| tx.is::<Paragraph>(*parent) && tx.children_size(*parent) == 1)
        {
            let replacement = create(tx)?;
            tx.replace(parent, replacement, false)?;
        } else {
            let top = tx.top_level_element_or_err(node)?;
            let replacement = create(tx)?;
            tx.insert_after(top, replacement, true)?;
            tx.remove(node, false)?;
        }
    } else if !inline && is_scalar(data) {
        let paragraph = tx.create(Paragraph {})?.key();
        let replacement = create(tx)?;
        tx.append(paragraph, &[replacement])?;
        tx.replace(node, paragraph, false)?;
    } else {
        tx.get_mut::<DatabaseQueryNode>(node)?.data = data.clone();
    }
    Ok(())
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod insert_test;
