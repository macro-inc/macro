//! Source diff-delete unwrapping at a collapsed block start.
use super::*;
use crate::nodes::{DiffDeleteNode, DiffNode};

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(DiffDelete)
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
