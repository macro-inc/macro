//! Attached checklist controls upgrade imported lists through the Source transform.
use super::*;
use crate::nodes::TaskListNode;
use lexical_rich_nodes::list::ListNode;

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.transform::<ListNode>(upgrade)
}

fn upgrade(tx: &mut Transaction<'_>, list: Id<ListNode>) -> Result<(), Error> {
    if tx.is::<TaskListNode>(list.key()) {
        return Ok(());
    }
    let payload = tx
        .get::<ListNode>(list.key())
        .ok_or(Error::NodeTypeMismatch(list.key()))?
        .clone();
    let json = tx.export_json(list.key())?;
    // Source invokes the concrete constructor, not $applyNodeReplacement.
    let replacement = tx.create_exact(TaskListNode::from(payload))?;
    tx.update_from_json(replacement, &json)?;
    tx.replace(list, replacement, true)?;
    Ok(())
}
