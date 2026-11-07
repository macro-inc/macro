//! List container payload and structural splice override.
use super::*;
use serde::{Deserialize, Serialize};
/// List numbering and marker behavior.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ListType {
    /// Ordered list.
    #[default]
    Number,
    /// Unordered list.
    Bullet,
    /// Checklist.
    Check,
}
/// Serialized HTML tag derived from list type.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ListNodeTagType {
    /// Unordered list tag.
    Ul,
    /// Ordered list tag.
    Ol,
}
impl ListType {
    /// Derive the HTML tag.
    pub fn tag(self) -> ListNodeTagType {
        if self == Self::Number {
            ListNodeTagType::Ol
        } else {
            ListNodeTagType::Ul
        }
    }
}
/// Upstream ListNode; tree links and element properties belong to the model.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNode {
    list_type: ListType,
    start: i32,
}
impl Default for ListNode {
    fn default() -> Self {
        Self::new(ListType::Number, 1)
    }
}
impl ListNode {
    /// Create a list payload.
    pub fn new(list_type: ListType, start: i32) -> Self {
        Self { list_type, start }
    }
    /// Marker type.
    pub fn list_type(&self) -> ListType {
        self.list_type
    }
    /// Derived tag; imported tag fields are ignored.
    pub fn tag(&self) -> ListNodeTagType {
        self.list_type.tag()
    }
    /// First numbered value.
    pub fn start(&self) -> i32 {
        self.start
    }
    /// Change marker type.
    pub fn set_list_type(&mut self, list_type: ListType) {
        self.list_type = list_type;
    }
    /// Change starting value.
    pub fn set_start(&mut self, start: i32) {
        self.start = start;
    }
}
impl NodeType for ListNode {
    const TYPE: &'static str = "list";
    type Kind = ElementKind;
    impl_default_node!();
    fn static_transform() -> Option<TransformFn<Self>> {
        Some(list_node_transform)
    }
}
impl ElementNode for ListNode {
    element_node_base!();
    fn can_be_empty(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn can_indent(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn splice(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        start: ChildIndex,
        delete_count: u32,
        nodes: &[NodeKey],
    ) -> Result<()> {
        list_splice(tx, this, start, delete_count, nodes)
    }
    fn extract_with_child(
        &self,
        node: ElementView<'_>,
        child: NodeKey,
        _: Option<&Selection>,
        _: CopyDestination,
    ) -> bool {
        node.state.is::<ListItemNode>(child)
    }
    fn adjust_export_json(&self, _: NodeView<'_>, json: &mut SerializedNode) -> Result<()> {
        json.insert("tag".into(), serde_json::to_value(self.tag())?);
        Ok(())
    }
}
/// Wrap inserted non-items, flattening block elements to their text content.
pub fn list_splice(
    tx: &mut Transaction<'_>,
    this: Id<ListNode>,
    start: ChildIndex,
    delete_count: u32,
    nodes: &[NodeKey],
) -> Result<()> {
    let mut items = Vec::with_capacity(nodes.len());
    for &node in nodes {
        if tx.is::<ListItemNode>(node) {
            items.push(node);
        } else {
            let item = create_list_item_node_for(tx, this)?;
            let child = if tx.is_element(node) && !tx.is::<ListNode>(node) && !tx.is_inline(node) {
                {
                    let content = tx.text_content(node).into_owned();
                    tx.create_text(&content)?.key()
                }
            } else {
                node
            };
            tx.append(item, &[child])?;
            items.push(item.key());
        }
    }
    tx.default_splice(this.key(), start, delete_count, &items)
}
/// Default list-item factory.
pub fn create_list_item_node_for(
    tx: &mut Transaction<'_>,
    _: Id<ListNode>,
) -> Result<Id<ListItemNode>> {
    create_list_item_node(tx, None)
}
/// Merge adjacent lists and reconcile child numbering.
pub fn list_node_transform(tx: &mut Transaction<'_>, list: Id<ListNode>) -> Result<()> {
    super::format::merge_next_sibling_list_if_same_type(tx, list)?;
    super::format::update_children_list_item_value(tx, list)
}
/// Create an unattached list through registered replacements.
pub fn create_list_node(
    tx: &mut Transaction<'_>,
    list_type: ListType,
    start: i32,
) -> Result<Id<ListNode>> {
    tx.create(ListNode::new(list_type, start))
}
/// Test list ancestry, including application subclasses.
pub fn is_list_node(st: &impl Read, k: NodeKey) -> bool {
    st.is::<ListNode>(k)
}

#[cfg(test)]
mod test;
