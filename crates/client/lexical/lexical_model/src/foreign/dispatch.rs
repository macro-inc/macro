//! Fixed runtime vtable shims, falling back through registered ancestors.
use super::projection::ForeignPayload;
use crate::*;
use std::{
    any::{Any, TypeId},
    borrow::Cow,
    sync::Arc,
};

pub(crate) fn kind_base(kind: NodeKind) -> NodeVTable {
    match kind {
        NodeKind::Element => <ElementKind as KindOf<ElementBase>>::vtable(),
        NodeKind::Text => <TextKind as KindOf<TextBase>>::vtable(),
        NodeKind::Decorator => <DecoratorKind as KindOf<DecoratorBase>>::vtable(),
        NodeKind::LineBreak => <LineBreakKind as KindOf<LineBreakBase>>::vtable(),
    }
}
fn read_hook<Value>(
    data: &dyn Any,
    node: NodeView<'_>,
    mut invoke: impl FnMut(&dyn ForeignHooks, &ForeignData, NodeView<'_>) -> Override<Value>,
    inherit: impl FnOnce(&NodeVTable, &dyn Any, NodeView<'_>) -> Value,
) -> Value {
    if let Some(payload) = data.downcast_ref::<ForeignPayload>() {
        let projection = node
            .state
            .native_projection
            .filter(|frame| frame.key == node.key);
        let projected = projection.map(|frame| frame.fields(&payload.user));
        let data = projected.as_ref().unwrap_or(&payload.user);
        let mut node = node;
        node.state.native_projection = None;
        let mut entry = node
            .state
            .state
            .registry
            .get(node.state.type_name(node.key).unwrap_or(""));
        while let Some(current) = entry {
            let Some(definition) = &current.foreign else {
                break;
            };
            if let Override::Value(value) = invoke(definition.hooks.as_ref(), data, node) {
                return value;
            }
            entry = definition
                .extends
                .and_then(|parent| node.state.state.registry.get(parent));
        }
        if let Some(frame) = projection {
            node.state.native_projection = Some(frame);
            return inherit(&payload.table, frame.data(), node);
        }
        let frame = super::projection::NativeProjection::from_payload(node.key, payload);
        node.state.native_projection = Some(&frame);
        return inherit(&payload.table, payload.native.as_any(), node);
    }
    let table = kind_base(node.state.kind(node.key).unwrap_or(NodeKind::Element));
    inherit(&table, data, node)
}

fn mutate<Value>(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    mut invoke: impl FnMut(&dyn ForeignHooks, &mut Transaction<'_>) -> Override<Result<Value, Error>>,
    inherit: impl FnOnce(&NodeVTable, &mut Transaction<'_>) -> Result<Value, Error>,
) -> Result<Value, Error> {
    let registry = tx.pending.registry.clone();
    let index = tx.type_index(key).ok_or(Error::NodeNotFound(key))?;
    let mut entry = registry.node(index);
    while let Some(current) = entry {
        let Some(definition) = &current.foreign else {
            break;
        };
        if let Override::Value(value) =
            super::projection::foreign(tx, |tx| invoke(definition.hooks.as_ref(), tx))?
        {
            return value;
        }
        entry = definition.extends.and_then(|name| registry.get(name));
    }
    super::projection::native(tx, key, inherit)
}

pub(crate) fn vtable(definition: ForeignNodeType) -> NodeVTable {
    let mut table = kind_base(definition.kind);
    table.initial_base = match definition.kind {
        NodeKind::Element => |_| Ok(BaseData::Element(ElementData::default())),
        NodeKind::Text => |_| Ok(BaseData::Text(TextData::default())),
        NodeKind::Decorator => |_| Ok(BaseData::Decorator),
        NodeKind::LineBreak => |_| Ok(BaseData::LineBreak),
    };
    table.type_name = Box::leak(definition.type_name.to_string().into_boxed_str());
    table.class_name = Box::leak(definition.class_name.to_string().into_boxed_str());
    table.marker = false;
    table.type_id = TypeId::of::<ForeignData>();
    table.ancestry = vec![];
    table.required = definition.required_state.clone();
    table.transforms = vec![crate::registry::RegisteredTransform::Plain(|tx, key| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.static_transform(tx, key),
            |parent, tx| {
                for transform in parent.transforms.clone() {
                    transform.run(tx, key)?;
                }
                Ok(())
            },
        )
    })];
    table.language = false;
    table.per_instance = true;
    table.foreign = Some(Arc::new(definition));
    table.project = |_, _| None;
    table.project_mut = |_, _| None;
    table.probe = || None;
    table.decode = |_| Err(Error::Invariant("runtime payload needs registry"));
    table.default_data = table.probe;
    table.json_version = |_| 1;
    table.update = |data, json| {
        let data = data
            .downcast_mut::<ForeignPayload>()
            .ok_or(Error::Invariant("runtime payload"))?;
        data.user.fields = json.clone();
        for key in [
            "type",
            "version",
            "children",
            "format",
            "style",
            "indent",
            "direction",
            "textFormat",
            "textStyle",
            "text",
            "mode",
            "detail",
            "$",
            "$slots",
        ] {
            data.user.fields.shift_remove(key);
        }
        *data = ForeignPayload::with_table(data.table.clone(), data.user.clone())?;
        Ok(())
    };
    table.import = |tx, json| {
        let name = json
            .get("type")
            .and_then(serde_json::Value::as_str)
            .ok_or(Error::Invariant("node type"))?;
        let registry = tx.pending.registry.clone();
        let mut entry = Some(registry.get_or_err(name)?);
        while let Some(current) = entry {
            let Some(definition) = &current.foreign else {
                break;
            };
            if let Override::Value(value) = definition.hooks.import(tx, json) {
                return value;
            }
            entry = definition.extends.and_then(|parent| registry.get(parent));
        }
        let key = tx.create_foreign(name, SerializedNode::new())?;
        tx.update_from_json(key, json)?;
        Ok(key)
    };
    table.import_exact = table.import;
    table.adjust_export_json = |data, node, json| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.adjust_export_json(node, fields, json),
            |_, _, _| Ok(()),
        )
    };
    table.is_inline = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.is_inline(node, fields),
            |parent, data, node| (parent.is_inline)(data, node),
        )
    };
    table.can_be_empty = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.can_be_empty(node, fields),
            |parent, data, node| (parent.can_be_empty)(data, node),
        )
    };
    table.can_indent = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.can_indent(node, fields),
            |parent, data, node| (parent.can_indent)(data, node),
        )
    };
    table.is_shadow_root = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.is_shadow_root(node, fields),
            |parent, data, node| (parent.is_shadow_root)(data, node),
        )
    };
    table.can_insert_text_before = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.can_insert_text_before(node, fields),
            |parent, data, node| (parent.can_insert_text_before)(data, node),
        )
    };
    table.can_insert_text_after = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.can_insert_text_after(node, fields),
            |parent, data, node| (parent.can_insert_text_after)(data, node),
        )
    };
    table.can_merge_when_empty = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.can_merge_when_empty(node, fields),
            |parent, data, node| (parent.can_merge_when_empty)(data, node),
        )
    };
    table.is_parent_required = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.is_parent_required(node, fields),
            |parent, data, node| (parent.is_parent_required)(data, node),
        )
    };
    table.is_text_entity = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.is_text_entity(node, fields),
            |parent, data, node| (parent.is_text_entity)(data, node),
        )
    };
    table.can_have_format = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.can_have_format(node, fields),
            |parent, data, node| (parent.can_have_format)(data, node),
        )
    };
    table.is_isolated = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.is_isolated(node, fields),
            |parent, data, node| (parent.is_isolated)(data, node),
        )
    };
    table.is_keyboard_selectable = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.is_keyboard_selectable(node, fields),
            |parent, data, node| (parent.is_keyboard_selectable)(data, node),
        )
    };
    table.indent = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.indent(node, fields),
            |parent, data, node| (parent.indent)(data, node),
        )
    };
    table.can_merge_with = |data, node, other| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.can_merge_with(node, fields, other),
            |parent, data, node| (parent.can_merge_with)(data, node, other),
        )
    };
    table.can_replace_with = |data, node, replacement| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.can_replace_with(node, fields, replacement),
            |parent, data, node| (parent.can_replace_with)(data, node, replacement),
        )
    };
    table.can_insert_after = |data, node, other| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.can_insert_after(node, fields, other),
            |parent, data, node| (parent.can_insert_after)(data, node, other),
        )
    };
    table.exclude_from_copy = |data, node, destination| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.exclude_from_copy(node, fields, destination),
            |parent, data, node| (parent.exclude_from_copy)(data, node, destination),
        )
    };
    table.extract_with_child = |data, node, child, selection, destination| {
        read_hook(
            data,
            node,
            |hooks, fields, node| {
                hooks.extract_with_child(node, fields, child, selection, destination)
            },
            |parent, data, node| {
                (parent.extract_with_child)(data, node, child, selection, destination)
            },
        )
    };
    table.text_content = |data, node| {
        read_hook(
            data,
            node,
            |hooks, fields, node| match hooks.text_content(node, fields) {
                Override::Inherit => Override::Inherit,
                Override::Value(value) => Override::Value(Cow::Owned(value)),
            },
            |parent, data, node| Cow::Owned((parent.text_content)(data, node).into_owned()),
        )
    };
    table.coerce_text_content = |data, node, requested| {
        read_hook(
            data,
            node,
            |hooks, fields, node| match hooks.coerce_text_content(node, fields, requested) {
                Override::Inherit => Override::Inherit,
                Override::Value(value) => Override::Value(value.map(Cow::Owned)),
            },
            |parent, data, node| (parent.coerce_text_content)(data, node, requested),
        )
    };
    table.check_splice_text = |data, node, range, insert| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.check_splice_text(node, fields, range.clone(), insert),
            |parent, data, node| (parent.check_splice_text)(data, node, range.clone(), insert),
        )
    };
    table.coerce_detail = |data, node, requested| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.coerce_detail(node, fields, requested),
            |parent, data, node| (parent.coerce_detail)(data, node, requested),
        )
    };
    table.coerce_mode = |data, node, requested| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.coerce_mode(node, fields, requested),
            |parent, data, node| (parent.coerce_mode)(data, node, requested),
        )
    };
    table.coerce_format = |data, node, requested| {
        read_hook(
            data,
            node,
            |hooks, fields, node| hooks.coerce_format(node, fields, requested),
            |parent, data, node| (parent.coerce_format)(data, node, requested),
        )
    };
    table.remove = |tx, key, preserve_empty_parent| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.remove(tx, key, preserve_empty_parent),
            |parent, tx| (parent.remove)(tx, key, preserve_empty_parent),
        )
    };
    table.replace = |tx, key, replacement, include_children| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.replace(tx, key, replacement, include_children),
            |parent, tx| (parent.replace)(tx, key, replacement, include_children),
        )
    };
    table.insert_after = |tx, key, node, restore_selection| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.insert_after(tx, key, node, restore_selection),
            |parent, tx| (parent.insert_after)(tx, key, node, restore_selection),
        )
    };
    table.insert_before = |tx, key, node, restore_selection| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.insert_before(tx, key, node, restore_selection),
            |parent, tx| (parent.insert_before)(tx, key, node, restore_selection),
        )
    };
    table.reset_on_copy = |tx, key, original| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.reset_on_copy(tx, key, original),
            |parent, tx| (parent.reset_on_copy)(tx, key, original),
        )
    };
    table.create_parent_element = |tx, key| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.create_parent_element(tx, key),
            |parent, tx| (parent.create_parent_element)(tx, key),
        )
    };
    table.splice = |tx, key, start, delete_count, nodes| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.splice(tx, key, start, delete_count, nodes),
            |parent, tx| (parent.splice)(tx, key, start, delete_count, nodes),
        )
    };
    table.append = |tx, key, nodes| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.append(tx, key, nodes),
            |parent, tx| (parent.append)(tx, key, nodes),
        )
    };
    table.set_indent = |tx, key, indent| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.set_indent(tx, key, indent),
            |parent, tx| (parent.set_indent)(tx, key, indent),
        )
    };
    table.insert_new_after = |tx, key, selection, restore_selection| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.insert_new_after(tx, key, selection, restore_selection),
            |parent, tx| (parent.insert_new_after)(tx, key, selection, restore_selection),
        )
    };
    table.collapse_at_start = |tx, key, selection| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.collapse_at_start(tx, key, selection),
            |parent, tx| (parent.collapse_at_start)(tx, key, selection),
        )
    };
    table.selection_transform = |tx, key| {
        mutate(
            tx,
            key,
            |hooks, tx| hooks.selection_transform(tx, key),
            |parent, tx| (parent.selection_transform)(tx, key),
        )
    };
    table
}

pub(crate) fn update_override(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    json: &SerializedNode,
) -> Option<Result<(), Error>> {
    let registry = tx.pending.registry.clone();
    let mut entry = tx.type_index(key).and_then(|index| registry.node(index));
    while let Some(current) = entry {
        let definition = current.foreign.as_ref()?;
        if let Override::Value(result) = definition.hooks.update_from_json(tx, key, json) {
            return Some(result);
        }
        entry = definition.extends.and_then(|parent| registry.get(parent));
    }
    None
}
