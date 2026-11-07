//! Element registration dispatch.
use super::*;
fn project_element<Node: ElementNode>(data: &dyn Any, target: TypeId) -> Option<&dyn Any> {
    if Node::IS_MARKER {
        return None;
    }
    let node = data.downcast_ref::<Node>()?;
    if TypeId::of::<Node>() == target {
        return Some(node);
    }
    if Node::IS_MARKER {
        return None;
    }
    project_element::<<Node as ElementNode>::Parent>(node.as_parent(), target)
}
fn project_element_mut<Node: ElementNode>(
    data: &mut dyn Any,
    target: TypeId,
) -> Option<&mut dyn Any> {
    if Node::IS_MARKER {
        return None;
    }
    let node = data.downcast_mut::<Node>()?;
    if TypeId::of::<Node>() == target {
        return Some(node);
    }
    if Node::IS_MARKER {
        return None;
    }
    project_element_mut::<<Node as ElementNode>::Parent>(node.as_parent_mut()?, target)
}
pub(in crate::node) fn element<Node: ElementNode>() -> NodeVTable {
    let mut ancestry = vec![];
    let mut required = vec![];
    let mut transforms = vec![];
    let mut language = Node::HAS_LANGUAGE_FIELD;
    let mut per_instance = Node::FLAGS_PER_INSTANCE;
    if !Node::IS_MARKER {
        let parent = element::<<Node as ElementNode>::Parent>();
        ancestry.push(TypeId::of::<Node>());
        ancestry.extend(parent.ancestry);
        required.extend_from_slice(Node::REQUIRED_STATE);
        required.extend(parent.required);
        if let Some(transform) = Node::static_transform() {
            let _ = transform;
            transforms.push(
                (|tx, key| {
                    Node::static_transform().ok_or(Error::Invariant("missing static transform"))?(
                        tx,
                        Id::new_unchecked(key),
                    )
                }) as fn(&mut Transaction<'_>, NodeKey) -> Result<(), Error>,
            );
        }
        transforms.extend(parent.transforms);
        language |= parent.language;
        per_instance |= parent.per_instance;
    }
    NodeVTable {
        type_name: Node::TYPE,
        class_name: Node::class_name(),
        kind: NodeKind::Element,
        type_id: TypeId::of::<Node>(),
        marker: Node::IS_MARKER,
        ancestry,
        required,
        transforms,
        language,
        per_instance,
        project: project_element::<Node>,
        project_mut: project_element_mut::<Node>,
        probe: || Node::flag_probe().map(|n| Arc::new(n) as Arc<dyn AnyNodeData>),
        default_data: || Node::default_node().map(|n| Arc::new(n) as Arc<dyn AnyNodeData>),
        import: Node::import,
        update: |data, json| {
            data.downcast_mut::<Node>()
                .ok_or(Error::Invariant("payload type mismatch"))?
                .update_from_json(json)
        },
        initial_base: |data| {
            let _ = data;
            Ok(BaseData::Element(ElementData::default()))
        },
        json_version: |data| match data.downcast_ref::<Node>() {
            Some(payload) => payload.json_version(),
            None => 0,
        },
        adjust_export_json: |data, node, json| match data.downcast_ref::<Node>() {
            Some(payload) => payload.adjust_export_json(node, json),
            None => Err(Error::Invariant("payload type mismatch")),
        },
        is_parent_required: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.is_parent_required(ElementView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        reset_on_copy: |tx, this, original| {
            <Node as ElementNode>::reset_on_copy(tx, Id::new_unchecked(this), original)
        },
        remove: |tx, this, preserve_empty_parent| {
            <Node as ElementNode>::remove(tx, Id::new_unchecked(this), preserve_empty_parent)
        },
        replace: |tx, this, replacement, include_children| {
            <Node as ElementNode>::replace(
                tx,
                Id::new_unchecked(this),
                replacement,
                include_children,
            )
        },
        insert_after: |tx, this, node, restore_selection| {
            <Node as ElementNode>::insert_after(
                tx,
                Id::new_unchecked(this),
                node,
                restore_selection,
            )
        },
        insert_before: |tx, this, node, restore_selection| {
            <Node as ElementNode>::insert_before(
                tx,
                Id::new_unchecked(this),
                node,
                restore_selection,
            )
        },
        create_parent_element: |tx, this| {
            <Node as ElementNode>::create_parent_element(tx, Id::new_unchecked(this))
        },
        is_inline: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.is_inline(ElementView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        can_be_empty: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.can_be_empty(ElementView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        can_insert_text_before: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.can_insert_text_before(ElementView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        can_insert_text_after: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.can_insert_text_after(ElementView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        is_shadow_root: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.is_shadow_root(ElementView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        can_indent: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.can_indent(ElementView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        can_merge_with: |data, node, other| match data.downcast_ref::<Node>() {
            Some(payload) => payload.can_merge_with(
                ElementView {
                    key: node.key,
                    state: node.state,
                },
                other,
            ),
            None => false,
        },
        can_merge_when_empty: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.can_merge_when_empty(ElementView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        can_replace_with: |data, node, replacement| match data.downcast_ref::<Node>() {
            Some(payload) => payload.can_replace_with(
                ElementView {
                    key: node.key,
                    state: node.state,
                },
                replacement,
            ),
            None => false,
        },
        can_insert_after: |data, node, other| match data.downcast_ref::<Node>() {
            Some(payload) => payload.can_insert_after(
                ElementView {
                    key: node.key,
                    state: node.state,
                },
                other,
            ),
            None => false,
        },
        exclude_from_copy: |data, node, destination| match data.downcast_ref::<Node>() {
            Some(payload) => payload.exclude_from_copy(
                ElementView {
                    key: node.key,
                    state: node.state,
                },
                destination,
            ),
            None => false,
        },
        extract_with_child: |data, node, child, selection, destination| match data
            .downcast_ref::<Node>()
        {
            Some(payload) => payload.extract_with_child(
                ElementView {
                    key: node.key,
                    state: node.state,
                },
                child,
                selection,
                destination,
            ),
            None => false,
        },
        indent: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.indent(ElementView {
                key: node.key,
                state: node.state,
            }),
            None => 0,
        },
        splice: |tx, this, start, delete_count, nodes| {
            <Node as ElementNode>::splice(tx, Id::new_unchecked(this), start, delete_count, nodes)
        },
        append: |tx, this, nodes| <Node as ElementNode>::append(tx, Id::new_unchecked(this), nodes),
        set_indent: |tx, this, indent| {
            <Node as ElementNode>::set_indent(tx, Id::new_unchecked(this), indent)
        },
        insert_new_after: |tx, this, selection, restore_selection| {
            <Node as ElementNode>::insert_new_after(
                tx,
                Id::new_unchecked(this),
                selection,
                restore_selection,
            )
        },
        collapse_at_start: |tx, this, selection| {
            <Node as ElementNode>::collapse_at_start(tx, Id::new_unchecked(this), selection)
        },
        can_have_format: |data, node| {
            let _ = (data, node);
            false
        },
        is_text_entity: |data, node| {
            let _ = (data, node);
            false
        },

        coerce_text_content: |data, node, requested| {
            let _ = (data, node, requested);
            Err(Error::NotAText(node.key))
        },
        check_splice_text: |data, node, range, insert| {
            let _ = (data, node, range, insert);
            Err(Error::NotAText(node.key))
        },
        coerce_detail: |data, node, requested| {
            let _ = (data, node, requested);
            Err(Error::NotAText(node.key))
        },
        coerce_mode: |data, node, requested| {
            let _ = (data, node, requested);
            Err(Error::NotAText(node.key))
        },
        coerce_format: |data, node, requested| {
            let _ = (data, node, requested);
            Err(Error::NotAText(node.key))
        },

        is_isolated: |data, node| {
            let _ = (data, node);
            false
        },
        is_keyboard_selectable: |data, node| {
            let _ = (data, node);
            false
        },
        text_content: |data, node| {
            let _ = (data, node);
            Cow::Borrowed("")
        },
    }
}
