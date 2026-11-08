//! Text registration dispatch.
use super::*;
fn project_text<Node: TextNode>(data: &dyn Any, target: TypeId) -> Option<&dyn Any> {
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
    project_text::<<Node as TextNode>::Parent>(node.as_parent(), target)
}
fn project_text_mut<Node: TextNode>(data: &mut dyn Any, target: TypeId) -> Option<&mut dyn Any> {
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
    project_text_mut::<<Node as TextNode>::Parent>(node.as_parent_mut()?, target)
}
pub(in crate::node) fn text<Node: TextNode>() -> NodeVTable {
    let mut ancestry = vec![];
    let mut required = vec![];
    let mut transforms = vec![];
    let mut language = Node::HAS_LANGUAGE_FIELD;
    let mut per_instance = Node::FLAGS_PER_INSTANCE;
    if !Node::IS_MARKER {
        let parent = text::<<Node as TextNode>::Parent>();
        ancestry.push(TypeId::of::<Node>());
        ancestry.extend(parent.ancestry);
        required.extend_from_slice(Node::REQUIRED_STATE);
        required.extend(parent.required);
        if let Some(transform) = Node::static_transform() {
            let _ = transform;
            transforms.push(crate::registry::RegisteredTransform::Plain(
                (|tx, key| {
                    Node::static_transform().ok_or(Error::Invariant("missing static transform"))?(
                        tx,
                        Id::new_unchecked(key),
                    )
                }) as fn(&mut Transaction<'_>, NodeKey) -> Result<(), Error>,
            ));
        }
        transforms.extend(parent.transforms);
        language |= parent.language;
        per_instance |= parent.per_instance;
    }
    NodeVTable {
        #[cfg(feature = "foreign-nodes")]
        foreign: None,
        type_name: Node::TYPE,
        class_name: Node::class_name(),
        kind: NodeKind::Text,
        type_id: TypeId::of::<Node>(),
        marker: Node::IS_MARKER,
        ancestry,
        required,
        transforms,
        language,
        per_instance,
        project: project_text::<Node>,
        project_mut: project_text_mut::<Node>,
        probe: || Node::flag_probe().map(|n| Arc::new(n) as Arc<dyn AnyNodeData>),
        #[cfg(feature = "foreign-nodes")]
        default_data: || Node::default_node().map(|n| Arc::new(n) as Arc<dyn AnyNodeData>),
        default_create: Node::create_default,
        #[cfg(feature = "foreign-nodes")]
        decode: |json| Ok(Arc::new(Node::import_json(json)?)),
        import_exact: |tx, json| tx.create_exact(Node::import_json(json)?).map(|id| id.key()),
        import: Node::import,
        update: |data, json| {
            data.downcast_mut::<Node>()
                .ok_or(Error::Invariant("payload type mismatch"))?
                .update_from_json(json)
        },
        initial_base: |data| {
            let _ = data;
            Ok(BaseData::Text(
                data.downcast_ref::<Node>()
                    .ok_or(Error::Invariant("payload type mismatch"))?
                    .initial_text_data(),
            ))
        },
        json_version: |data| match data.downcast_ref::<Node>() {
            Some(payload) => payload.json_version(),
            None => 0,
        },
        adjust_export_json: |data, node, json| match data.downcast_ref::<Node>() {
            Some(payload) => payload.adjust_export_json(node, json),
            None => Err(Error::Invariant("payload type mismatch")),
        },
        selection_transform: |tx, key| {
            <Node as TextNode>::selection_transform(tx, Id::new_unchecked(key))
        },
        is_parent_required: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.is_parent_required(TextView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        reset_on_copy: |tx, this, original| {
            <Node as TextNode>::reset_on_copy(tx, Id::new_unchecked(this), original)
        },
        remove: |tx, this, preserve_empty_parent| {
            <Node as TextNode>::remove(tx, Id::new_unchecked(this), preserve_empty_parent)
        },
        replace: |tx, this, replacement, include_children| {
            <Node as TextNode>::replace(tx, Id::new_unchecked(this), replacement, include_children)
        },
        insert_after: |tx, this, node, restore_selection| {
            <Node as TextNode>::insert_after(tx, Id::new_unchecked(this), node, restore_selection)
        },
        insert_before: |tx, this, node, restore_selection| {
            <Node as TextNode>::insert_before(tx, Id::new_unchecked(this), node, restore_selection)
        },
        create_parent_element: |tx, this| {
            <Node as TextNode>::create_parent_element(tx, Id::new_unchecked(this))
        },
        is_inline: |data, node| {
            let _ = (data, node);
            true
        },
        can_be_empty: |data, node| {
            let _ = (data, node);
            false
        },
        can_insert_text_before: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.can_insert_text_before(TextView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        can_insert_text_after: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.can_insert_text_after(TextView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        is_shadow_root: |data, node| {
            let _ = (data, node);
            false
        },
        can_indent: |data, node| {
            let _ = (data, node);
            false
        },
        can_merge_with: |data, node, other| {
            let _ = (data, node, other);
            false
        },
        can_merge_when_empty: |data, node| {
            let _ = (data, node);
            false
        },
        can_replace_with: |data, node, replacement| {
            let _ = (data, node, replacement);
            false
        },
        can_insert_after: |data, node, other| {
            let _ = (data, node, other);
            false
        },
        exclude_from_copy: |data, node, destination| {
            let _ = (data, node, destination);
            false
        },
        extract_with_child: |data, node, child, selection, destination| {
            let _ = (data, node, child, selection, destination);
            false
        },
        indent: |data, node| {
            let _ = (data, node);
            0
        },
        splice: |tx, this, start, delete_count, nodes| {
            let _ = (tx, this, start, delete_count, nodes);
            Err(Error::NotAnElement(this))
        },
        append: |tx, this, nodes| {
            let _ = (tx, this, nodes);
            Err(Error::NotAnElement(this))
        },
        set_indent: |tx, this, indent| {
            let _ = (tx, this, indent);
            Err(Error::NotAnElement(this))
        },
        insert_new_after: |tx, this, selection, restore_selection| {
            let _ = (tx, this, selection, restore_selection);
            Err(Error::NotAnElement(this))
        },
        collapse_at_start: |tx, this, selection| {
            let _ = (tx, this, selection);
            Err(Error::NotAnElement(this))
        },
        can_have_format: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.can_have_format(TextView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },
        is_text_entity: |data, node| match data.downcast_ref::<Node>() {
            Some(payload) => payload.is_text_entity(TextView {
                key: node.key,
                state: node.state,
            }),
            None => false,
        },

        coerce_text_content: |data, node, requested| match data.downcast_ref::<Node>() {
            Some(payload) => payload.coerce_text_content(
                TextView {
                    key: node.key,
                    state: node.state,
                },
                requested,
            ),
            None => Err(Error::Invariant("payload type mismatch")),
        },
        check_splice_text: |data, node, range, insert| match data.downcast_ref::<Node>() {
            Some(payload) => payload.check_splice_text(
                TextView {
                    key: node.key,
                    state: node.state,
                },
                range,
                insert,
            ),
            None => Err(Error::Invariant("payload type mismatch")),
        },
        coerce_detail: |data, node, requested| match data.downcast_ref::<Node>() {
            Some(payload) => payload.coerce_detail(
                TextView {
                    key: node.key,
                    state: node.state,
                },
                requested,
            ),
            None => Err(Error::Invariant("payload type mismatch")),
        },
        coerce_mode: |data, node, requested| match data.downcast_ref::<Node>() {
            Some(payload) => payload.coerce_mode(
                TextView {
                    key: node.key,
                    state: node.state,
                },
                requested,
            ),
            None => Err(Error::Invariant("payload type mismatch")),
        },
        coerce_format: |data, node, requested| match data.downcast_ref::<Node>() {
            Some(payload) => payload.coerce_format(
                TextView {
                    key: node.key,
                    state: node.state,
                },
                requested,
            ),
            None => Err(Error::Invariant("payload type mismatch")),
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
