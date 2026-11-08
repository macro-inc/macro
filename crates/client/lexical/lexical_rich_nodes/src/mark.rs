//! Inline annotations with ordered identifiers and structural selection helpers.
use lexical_model::*;
use serde::{Deserialize, Serialize};
mod ops;
pub use ops::*;
/// An inline annotation; identifier order and imported duplicates are preserved.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MarkNode {
    /// Annotation identifiers.
    #[serde(default)]
    pub ids: Vec<String>,
}
impl MarkNode {
    /// Stored identifiers in their original order.
    pub fn ids(&self) -> &[String] {
        &self.ids
    }
    /// Whether an identifier is present.
    pub fn has_id(&self, id: &str) -> bool {
        self.ids.iter().any(|value| value == id)
    }
    /// Replace identifiers without deduplication.
    pub fn set_ids(&mut self, ids: Vec<String>) {
        self.ids = ids;
    }
    /// Append an identifier only when absent.
    pub fn add_id(&mut self, id: &str) {
        if !self.has_id(id) {
            self.ids.push(id.to_owned());
        }
    }
    /// Remove the first matching identifier.
    pub fn delete_id(&mut self, id: &str) {
        if let Some(index) = self.ids.iter().position(|value| value == id) {
            self.ids.remove(index);
        }
    }
}
impl NodeType for MarkNode {
    const TYPE: &'static str = "mark";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for MarkNode {
    element_node_base!();
    fn is_inline(&self, _: ElementView<'_>) -> bool {
        true
    }
    fn can_be_empty(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn can_insert_text_before(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn can_insert_text_after(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn exclude_from_copy(&self, _: ElementView<'_>, destination: Option<CopyDestination>) -> bool {
        hooks::exclude_from_copy(destination)
    }
    fn extract_with_child(
        &self,
        node: ElementView<'_>,
        child: NodeKey,
        selection: Option<&Selection>,
        destination: CopyDestination,
    ) -> bool {
        hooks::extract_with_child(node.state, node.key, child, selection, destination)
    }
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        _: SelectionSlot,
        restore_selection: bool,
    ) -> Result<Option<NodeKey>, Error> {
        hooks::insert_new_after(tx, this.key(), restore_selection)
    }
}
/// Create an annotation through configured node replacement.
pub fn create_mark_node(tx: &mut Transaction<'_>, ids: Vec<String>) -> Result<NodeKey, Error> {
    Ok(tx.create(MarkNode { ids })?.key())
}
/// Test mark ancestry, including application annotation subclasses.
pub fn is_mark_node(state: &impl Read, key: NodeKey) -> bool {
    state.is::<MarkNode>(key)
}
/// Shared virtual hook bodies for annotation subclasses.
pub mod hooks {
    use super::*;
    /// Marks survive internal clones only.
    pub fn exclude_from_copy(destination: Option<CopyDestination>) -> bool {
        destination != Some(CopyDestination::Clone)
    }
    /// Preserve a fully selected annotation during an internal clone.
    pub fn extract_with_child(
        state: StateRef<'_>,
        mark: NodeKey,
        _child: NodeKey,
        selection: Option<&Selection>,
        destination: CopyDestination,
    ) -> bool {
        let Some(Selection::Range(range)) = selection else {
            return false;
        };
        if destination == CopyDestination::Html {
            return false;
        }
        let Ok(backward) = range.is_backward(state) else {
            return false;
        };
        let (start, end) = if backward {
            (range.focus, range.anchor)
        } else {
            (range.anchor, range.focus)
        };
        end.offset().checked_sub(start.offset()).is_some_and(|len| {
            state.is_parent_of(mark, start.key())
                && state.is_parent_of(mark, end.key())
                && state.text_content_size(mark).get() == len
        })
    }
    /// Insert a plain mark with the same identifiers, through replacement.
    pub fn insert_new_after(
        tx: &mut Transaction<'_>,
        mark: NodeKey,
        restore_selection: bool,
    ) -> Result<Option<NodeKey>, Error> {
        let ids = tx.get_or_err::<MarkNode>(mark)?.ids.clone();
        let next = create_mark_node(tx, ids)?;
        tx.insert_after(mark, next, restore_selection)?;
        Ok(Some(next))
    }
}
#[cfg(test)]
mod test;
