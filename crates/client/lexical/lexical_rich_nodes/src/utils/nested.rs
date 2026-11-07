//! Intrinsic resolution of directly nested elements of one registered type.
use lexical_model::*;
/// Clone and overlap policy for nested-element resolution.
pub trait NestedElementResolver: ElementNode + Sized {
    /// Create a fresh unattached wrapper based on the outer node.
    fn clone_for_split(tx: &mut Transaction<'_>, from: NodeKey) -> Result<NodeKey, Error>;
    /// Apply overlap metadata before lifting the inner node.
    fn handle_overlap(tx: &mut Transaction<'_>, from: NodeKey, to: NodeKey) -> Result<(), Error>;
}
/// Transform nested wrappers; deep indirect nesting remains unchanged, as upstream does.
pub fn resolve_nested_element<N: NestedElementResolver>(
    tx: &mut Transaction<'_>,
    node: Id<N>,
) -> Result<(), Error> {
    if tx
        .children_keys(node)?
        .iter()
        .any(|child| tx.is::<N>(*child))
    {
        return Ok(());
    }
    let mut child = node.key();
    let mut cursor = tx.parent(child);
    while let Some(parent) = cursor {
        if tx.is::<N>(parent) {
            if child != node.key() {
                return Ok(());
            }
            N::handle_overlap(tx, parent, node.key())?;
            let mut next = tx.next_sibling(child);
            let mut siblings = Vec::new();
            while let Some(sibling) = next {
                siblings.push(sibling);
                next = tx.next_sibling(sibling);
            }
            tx.insert_after(parent, child, true)?;
            if !siblings.is_empty() {
                let clone = N::clone_for_split(tx, parent)?;
                tx.insert_after(child, clone, true)?;
                tx.append(clone, &siblings)?;
            }
            if !tx.can_be_empty(parent) && tx.children_size(parent) == 0 {
                tx.remove(parent, false)?;
            }
            return Ok(());
        }
        child = parent;
        cursor = tx.parent(parent);
    }
    Ok(())
}
#[cfg(test)]
mod test;
