//! Shared read forwarding API.
use super::*;
/// Shared read API for snapshots, transactions, and borrowed views.
pub trait Read {
    /// Borrow the readable state.
    fn view(&self) -> StateRef<'_>;
    /// Node or err.
    fn node_or_err(&self, key: impl Into<NodeKey>) -> Result<NodeRef<'_>, Error> {
        self.view().node_or_err(key)
    }
    /// Contains.
    fn contains(&self, key: impl Into<NodeKey>) -> bool {
        self.view().contains(key)
    }
    /// Type name.
    fn type_name(&self, key: impl Into<NodeKey>) -> Result<&str, Error> {
        self.view().type_name(key)
    }
    /// Get or err.
    fn get_or_err<Node: NodeType>(&self, key: impl Into<NodeKey>) -> Result<&'_ Node, Error> {
        self.view().get_or_err::<Node>(key)
    }
    /// Element data.
    fn element_data(&self, key: impl Into<NodeKey>) -> Result<&'_ ElementData, Error> {
        self.view().element_data(key)
    }
    /// Text data.
    fn text_data(&self, key: impl Into<NodeKey>) -> Result<&'_ TextData, Error> {
        self.view().text_data(key)
    }
    /// Find matching parent.
    fn find_matching_parent(
        &self,
        start: impl Into<NodeKey>,
        predicate: impl FnMut(StateRef<'_>, NodeKey) -> bool,
    ) -> Option<NodeKey> {
        self.view().find_matching_parent(start, predicate)
    }
    /// Common ancestor.
    fn common_ancestor(
        &self,
        a: impl Into<NodeKey>,
        b: impl Into<NodeKey>,
    ) -> Option<CommonAncestor> {
        self.view().common_ancestor(a, b)
    }
    /// Common ancestor element.
    fn common_ancestor_element(
        &self,
        a: impl Into<NodeKey>,
        b: impl Into<NodeKey>,
    ) -> Option<NodeKey> {
        self.view().common_ancestor_element(a, b)
    }
    /// Nodes between.
    fn nodes_between(
        &self,
        a: impl Into<NodeKey>,
        b: impl Into<NodeKey>,
    ) -> Result<Vec<NodeKey>, Error> {
        self.view().nodes_between(a, b)
    }
    /// Adjacent node.
    fn adjacent_node(
        &self,
        focus: &Point,
        direction: EditDirection,
    ) -> Result<Option<NodeKey>, Error> {
        self.view().adjacent_node(focus, direction)
    }
    /// Is block.
    fn is_block(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_block(key)
    }
    /// Is element.
    fn is_element(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_element(key)
    }
    /// Is text.
    fn is_text(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_text(key)
    }
    /// Is decorator.
    fn is_decorator(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_decorator(key)
    }
    /// Is line break.
    fn is_line_break(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_line_break(key)
    }
    /// Character offsets of range endpoints.
    fn character_offsets(
        &self,
        selection: &Selection,
    ) -> Result<(Utf16Offset, Utf16Offset), Error> {
        self.view().character_offsets(selection)
    }
    /// Whether a node belongs to this selection or the active selection.
    fn is_selected(&self, key: impl Into<NodeKey>, selection: Option<&Selection>) -> bool {
        self.view().is_selected(key, selection)
    }
    /// Plain text of the active selection.
    fn selection_text_content(&self) -> Result<String, Error> {
        self.view().selection_text_content()
    }
    /// Root.
    fn root(&self) -> NodeKey {
        self.view().root()
    }
    /// Node.
    fn node(&self, key: impl Into<NodeKey>) -> Option<NodeRef<'_>> {
        self.view().node(key)
    }
    /// Get.
    fn get<Node: NodeType>(&self, key: impl Into<NodeKey>) -> Option<&'_ Node> {
        self.view().get::<Node>(key)
    }
    /// Cast.
    fn cast<Node: NodeType>(&self, key: impl Into<NodeKey>) -> Option<Id<Node>> {
        self.view().cast::<Node>(key)
    }
    /// Is.
    fn is<Node: NodeType>(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is::<Node>(key)
    }
    /// Kind.
    fn kind(&self, key: impl Into<NodeKey>) -> Option<NodeKind> {
        self.view().kind(key)
    }
    /// Type index.
    fn type_index(&self, key: impl Into<NodeKey>) -> Option<NodeTypeIndex> {
        self.view().type_index(key)
    }
    /// Parent.
    fn parent(&self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.view().parent(key)
    }
    /// Prev sibling.
    fn prev_sibling(&self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.view().prev_sibling(key)
    }
    /// Next sibling.
    fn next_sibling(&self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.view().next_sibling(key)
    }
    /// First child.
    fn first_child(&self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.view().first_child(key)
    }
    /// Last child.
    fn last_child(&self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.view().last_child(key)
    }
    /// Parent or err.
    fn parent_or_err(&self, key: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        self.view().parent_or_err(key)
    }
    /// First child or err.
    fn first_child_or_err(&self, key: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        self.view().first_child_or_err(key)
    }
    /// Last child or err.
    fn last_child_or_err(&self, key: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        self.view().last_child_or_err(key)
    }
    /// Children size.
    fn children_size(&self, key: impl Into<NodeKey>) -> u32 {
        self.view().children_size(key)
    }
    /// Is empty.
    fn is_empty(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_empty(key)
    }
    /// Children.
    fn children(&self, key: impl Into<NodeKey>) -> Children<'_> {
        self.view().children(key)
    }
    /// Children keys.
    fn children_keys(&self, key: impl Into<NodeKey>) -> Result<Vec<NodeKey>, Error> {
        self.view().children_keys(key)
    }
    /// Next siblings.
    fn next_siblings(&self, key: impl Into<NodeKey>) -> Siblings<'_> {
        self.view().next_siblings(key)
    }
    /// Prev siblings.
    fn prev_siblings(&self, key: impl Into<NodeKey>) -> std::vec::IntoIter<NodeKey> {
        self.view().prev_siblings(key)
    }
    /// Ancestors.
    fn ancestors(&self, key: impl Into<NodeKey>) -> Ancestors<'_> {
        self.view().ancestors(key)
    }
    /// Child at index.
    fn child_at_index(&self, key: impl Into<NodeKey>, index: ChildIndex) -> Option<NodeKey> {
        self.view().child_at_index(key, index)
    }
    /// Index within parent.
    fn index_within_parent(&self, key: impl Into<NodeKey>) -> Option<ChildIndex> {
        self.view().index_within_parent(key)
    }
    /// Is last child.
    fn is_last_child(&self, key: impl Into<NodeKey>) -> Result<bool, Error> {
        self.view().is_last_child(key)
    }
    /// Is attached.
    fn is_attached(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_attached(key)
    }
    /// Has ancestor.
    fn has_ancestor(&self, child: impl Into<NodeKey>, ancestor: impl Into<NodeKey>) -> bool {
        self.view().has_ancestor(child, ancestor)
    }
    /// Is parent of.
    fn is_parent_of(&self, a: impl Into<NodeKey>, b: impl Into<NodeKey>) -> bool {
        self.view().is_parent_of(a, b)
    }
    /// Descendants.
    fn descendants(&self, key: impl Into<NodeKey>) -> Descendants<'_> {
        self.view().descendants(key)
    }
    /// All text nodes.
    fn all_text_nodes(&self, key: impl Into<NodeKey>) -> std::vec::IntoIter<NodeKey> {
        self.view().all_text_nodes(key)
    }
    /// First descendant.
    fn first_descendant(&self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.view().first_descendant(key)
    }
    /// Last descendant.
    fn last_descendant(&self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.view().last_descendant(key)
    }
    /// Descendant by index.
    fn descendant_by_index(&self, key: impl Into<NodeKey>, index: ChildIndex) -> Option<NodeKey> {
        self.view().descendant_by_index(key, index)
    }
    /// Is before.
    fn is_before(&self, a: impl Into<NodeKey>, b: impl Into<NodeKey>) -> Result<bool, Error> {
        self.view().is_before(a, b)
    }
    /// Top level element.
    fn top_level_element(&self, key: impl Into<NodeKey>) -> Result<Option<NodeKey>, Error> {
        self.view().top_level_element(key)
    }
    /// Top level element or err.
    fn top_level_element_or_err(&self, key: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        self.view().top_level_element_or_err(key)
    }
    /// Nearest root or shadow root.
    fn nearest_root_or_shadow_root(&self, key: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        self.view().nearest_root_or_shadow_root(key)
    }
    /// Nodes of type index.
    fn nodes_of_type_index(&self, index: NodeTypeIndex) -> Vec<NodeKey> {
        self.view().nodes_of_type_index(index)
    }
    /// Nodes of type.
    fn nodes_of_type<Node: NodeType>(&self) -> Vec<Id<Node>> {
        self.view().nodes_of_type::<Node>()
    }
    /// Get dyn.
    fn get_dyn<Interface: ?Sized + 'static>(
        &self,
        key: impl Into<NodeKey>,
    ) -> Option<&'_ Interface> {
        self.view().get_dyn::<Interface>(key)
    }
    /// Has language field.
    fn has_language_field(&self, key: impl Into<NodeKey>) -> bool {
        self.view().has_language_field(key)
    }
    /// Is parent required.
    fn is_parent_required(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_parent_required(key)
    }
    /// Is inline.
    fn is_inline(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_inline(key)
    }
    /// Can be empty.
    fn can_be_empty(&self, key: impl Into<NodeKey>) -> bool {
        self.view().can_be_empty(key)
    }
    /// Can insert text before.
    fn can_insert_text_before(&self, key: impl Into<NodeKey>) -> bool {
        self.view().can_insert_text_before(key)
    }
    /// Can insert text after.
    fn can_insert_text_after(&self, key: impl Into<NodeKey>) -> bool {
        self.view().can_insert_text_after(key)
    }
    /// Is shadow root.
    fn is_shadow_root(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_shadow_root(key)
    }
    /// Can indent.
    fn can_indent(&self, key: impl Into<NodeKey>) -> bool {
        self.view().can_indent(key)
    }
    /// Can merge with.
    fn can_merge_with(&self, key: impl Into<NodeKey>, other: NodeKey) -> bool {
        self.view().can_merge_with(key, other)
    }
    /// Can merge when empty.
    fn can_merge_when_empty(&self, key: impl Into<NodeKey>) -> bool {
        self.view().can_merge_when_empty(key)
    }
    /// Can replace with.
    fn can_replace_with(&self, key: impl Into<NodeKey>, replacement: NodeKey) -> bool {
        self.view().can_replace_with(key, replacement)
    }
    /// Can insert after.
    fn can_insert_after(&self, key: impl Into<NodeKey>, other: NodeKey) -> bool {
        self.view().can_insert_after(key, other)
    }
    /// Exclude from copy.
    fn exclude_from_copy(
        &self,
        key: impl Into<NodeKey>,
        destination: Option<CopyDestination>,
    ) -> bool {
        self.view().exclude_from_copy(key, destination)
    }
    /// Extract with child.
    fn extract_with_child(
        &self,
        key: impl Into<NodeKey>,
        child: NodeKey,
        selection: Option<&Selection>,
        destination: CopyDestination,
    ) -> bool {
        self.view()
            .extract_with_child(key, child, selection, destination)
    }
    /// Indent.
    fn indent(&self, key: impl Into<NodeKey>) -> u32 {
        self.view().indent(key)
    }
    /// Can have format.
    fn can_have_format(&self, key: impl Into<NodeKey>) -> bool {
        self.view().can_have_format(key)
    }
    /// Is text entity.
    fn is_text_entity(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_text_entity(key)
    }
    /// Is isolated.
    fn is_isolated(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_isolated(key)
    }
    /// Is keyboard selectable.
    fn is_keyboard_selectable(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_keyboard_selectable(key)
    }
    /// Is root or shadow root.
    fn is_root_or_shadow_root(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_root_or_shadow_root(key)
    }
    /// Is simple text.
    fn is_simple_text(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_simple_text(key)
    }
    /// Is composing.
    fn is_composing(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_composing(key)
    }
    /// Is leaf.
    fn is_leaf(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_leaf(key)
    }
    /// Is block element.
    fn is_block_element(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_block_element(key)
    }
    /// Is inline element or decorator.
    fn is_inline_element_or_decorator(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_inline_element_or_decorator(key)
    }
    /// Is token or tab.
    fn is_token_or_tab(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_token_or_tab(key)
    }
    /// Is token or segmented.
    fn is_token_or_segmented(&self, key: impl Into<NodeKey>) -> bool {
        self.view().is_token_or_segmented(key)
    }
    /// Text content.
    fn text_content(&self, key: impl Into<NodeKey>) -> Cow<'_, str> {
        self.view().text_content(key)
    }
    /// Text content size.
    fn text_content_size(&self, key: impl Into<NodeKey>) -> Utf16Offset {
        self.view().text_content_size(key)
    }
    /// Selection.
    fn selection(&self) -> Option<&'_ Selection> {
        self.view().selection()
    }
    /// Previous selection.
    fn previous_selection(&self) -> Option<&'_ Selection> {
        self.view().previous_selection()
    }
    /// Get state.
    fn get_state<ValueType: StateValue>(
        &self,
        key: impl Into<NodeKey>,
        state_key: &'static StateKey<ValueType>,
    ) -> Result<ValueType, Error> {
        self.view().get_state::<ValueType>(key, state_key)
    }
    /// State change.
    fn state_change<ValueType: StateValue>(
        &self,
        previous: StateRef<'_>,
        key: impl Into<NodeKey>,
        state_key: &'static StateKey<ValueType>,
    ) -> Result<Option<(ValueType, ValueType)>, Error> {
        self.view()
            .state_change::<ValueType>(previous, key, state_key)
    }
    /// Export json.
    fn export_json(&self, key: impl Into<NodeKey>) -> Result<SerializedNode, Error> {
        self.view().export_json(key)
    }
    /// Model insertion prevention policy with host DOM facts.
    fn should_prevent_default_and_insert_text(
        &self,
        selection: &RangeSelection,
        text: &str,
        facts: InsertTextFacts,
    ) -> Result<bool, Error> {
        self.view()
            .should_prevent_default_and_insert_text(selection, text, facts)
    }
    /// Whether deletion may cross the two text boundaries.
    fn can_remove_text(&self, anchor: impl Into<NodeKey>, focus: impl Into<NodeKey>) -> bool {
        self.view().can_remove_text(anchor, focus)
    }
    /// Export node.
    fn export_node(&self, key: impl Into<NodeKey>) -> Result<SerializedNode, Error> {
        self.view().export_node(key)
    }
}
impl Read for StateRef<'_> {
    fn view(&self) -> StateRef<'_> {
        *self
    }
}
