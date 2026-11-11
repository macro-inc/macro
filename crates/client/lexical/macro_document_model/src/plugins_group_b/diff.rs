//! Source diff-delete unwrapping at a collapsed block start, and the Source
//! DiffNode accept/reject actions behind its header buttons.
use super::*;
use crate::nodes::{DiffDeleteNode, DiffInsertNode, DiffNode, Maybe};

#[derive(Clone, Debug, serde::Deserialize)]
struct DiffAction {
    key: u32,
}

static ACCEPT: CommandKey<NodeKey> = CommandKey::new("group-b.diff-accept");
static REJECT: CommandKey<NodeKey> = CommandKey::new("group-b.diff-reject");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    let command = if name == ACCEPT.name() {
        &ACCEPT
    } else if name == REJECT.name() {
        &REJECT
    } else {
        return Ok(None);
    };
    let action: DiffAction = serde_json::from_str(json)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        command,
        NodeKey::from_parts(KeyParts {
            index: action.key,
            generation,
        }),
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(DiffDelete).plugin(DiffActions)
}

static ACTIONS: [CommandRegistration; 2] = [
    CommandRegistration {
        command: CommandKind::Extension(&ACCEPT),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&REJECT),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
];

struct DiffActions;
impl Plugin for DiffActions {
    fn name(&self) -> &'static str {
        "group-b.diff-actions"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &ACTIONS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        if let Some(diff) = command.payload(&ACCEPT) {
            if !tx.is::<DiffNode>(*diff) {
                return Ok(Handled::No);
            }
            accept(tx, *diff)?;
            return Ok(Handled::Yes);
        }
        let Some(diff) = command.payload(&REJECT) else {
            return Ok(Handled::No);
        };
        if !tx.is::<DiffNode>(*diff) {
            return Ok(Handled::No);
        }
        reject(tx, *diff)?;
        Ok(Handled::Yes)
    }
}

/// Source DiffNode.handleAccept.
fn accept(tx: &mut Transaction<'_>, diff: NodeKey) -> Result<(), Error> {
    let Some(insert) = tx
        .children_keys(diff)?
        .into_iter()
        .find(|child| tx.is::<DiffInsertNode>(*child))
    else {
        return Ok(());
    };
    let Maybe::Value(markdown) = tx
        .get::<DiffInsertNode>(insert)
        .ok_or(Error::NodeNotFound(insert))?
        .markdown
        .clone()
    else {
        // Source returns when getMarkdown() is undefined.
        return Ok(());
    };
    for child in tx.children_keys(diff)? {
        tx.remove(child, false)?;
    }
    super::markdown_unwrap::import_unwrap_select(tx, diff, &markdown)
}

/// Source DiffNode.handleReject.
fn reject(tx: &mut Transaction<'_>, diff: NodeKey) -> Result<(), Error> {
    let Some(deleted) = tx
        .children_keys(diff)?
        .into_iter()
        .find(|child| tx.is::<DiffDeleteNode>(*child))
    else {
        tx.remove(diff, false)?;
        return Ok(());
    };
    let mut last = None;
    for child in tx.children_keys(deleted)? {
        tx.insert_before(diff, child, true)?;
        last = Some(child);
    }
    tx.remove(diff, false)?;
    if let Some(last) = last {
        tx.select_end(last)?;
    }
    Ok(())
}
struct DiffDelete;
impl Plugin for DiffDelete {
    fn name(&self) -> &'static str {
        "group-b.diff"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[
            CommandRegistration {
                command: CommandKind::DeleteCharacter,
                priority: CommandPriority::Critical,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::DeleteWord,
                priority: CommandPriority::Critical,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::DeleteLine,
                priority: CommandPriority::Critical,
                placement: Placement::After,
            },
        ]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        let Some(range) = tx.selection().and_then(Selection::as_range) else {
            return Ok(Handled::No);
        };
        if !range.is_collapsed() || range.anchor.offset() != 0 {
            return Ok(Handled::No);
        }
        let node = range.focus.key();
        let Some(parent) = tx
            .parent(node)
            .filter(|parent| tx.first_child(*parent) == Some(node))
        else {
            return Ok(Handled::No);
        };
        let Some(deleted) =
            tx.find_matching_parent(parent, |state, key| state.is::<DiffDeleteNode>(key))
        else {
            return Ok(Handled::No);
        };
        let Some(diff) = tx
            .parent(deleted)
            .filter(|parent| tx.is::<DiffNode>(*parent))
        else {
            return Ok(Handled::No);
        };
        let children: Vec<_> = tx
            .children_keys(deleted)?
            .into_iter()
            .filter(|key| tx.is_element(*key))
            .collect();
        if let Some(previous) = tx.prev_sibling(diff) {
            for child in &children {
                tx.insert_after(previous, *child, true)?;
            }
        } else if tx.parent(diff).is_some() {
            for child in children.iter().rev() {
                tx.insert_before(diff, *child, true)?;
            }
        }
        if let Some(first) = children.first() {
            tx.select_start(*first)?;
        }
        tx.remove(diff, false)?;
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
mod test;
