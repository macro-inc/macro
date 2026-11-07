use super::lexical::*;
use crate::replay::*;
use lexical_model::*;
use serde_json::{Value, json};
pub(crate) fn call(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    receiver: &Value,
    method: &str,
    a: &[Value],
) -> Result<Value> {
    let key = node_key(receiver)?;
    if let Some(value) = super::macro_edit::call(r, tx, key, method, a)? {
        return Ok(value);
    }

    // These public accessors call getLatest() in upstream. Raw get:__fields
    // resolve the receiver's captured version in properties.rs instead.
    let snapshot = r.read_state.clone().or_else(|| {
        (!r.in_callback || !tx.view().contains(key))
            .then(|| r.captured_state(receiver))
            .flatten()
    });
    let view = snapshot
        .as_ref()
        .map(EditorState::view)
        .unwrap_or(tx.view());
    if view.is::<lexical_rich_nodes::link::LinkNode>(key)
        && let Some(result) = super::rich::link_method(view, key, method, a)?
    {
        return Ok(result);
    }
    if let Some(value) = super::macro_model::node_method(view, key, method)? {
        return Ok(value);
    }
    match method {
        "getLanguage" => {
            return Ok(view
                .get::<lexical_rich_nodes::code::CodeNode>(key)
                .and_then(|code| code.language.as_deref())
                .map(|language| json!(language))
                .unwrap_or_else(undefined));
        }
        "getTheme" => {
            return Ok(view
                .get::<lexical_rich_nodes::code::CodeNode>(key)
                .and_then(|code| code.theme.as_deref())
                .map(|theme| json!(theme))
                .unwrap_or_else(undefined));
        }
        "getIDs" => {
            return Ok(json!(
                view.get_or_err::<lexical_rich_nodes::mark::MarkNode>(key)?
                    .ids
            ));
        }
        "hasID" => {
            return Ok(json!(
                view.get_or_err::<lexical_rich_nodes::mark::MarkNode>(key)?
                    .has_id(str_arg(a, 0)?)
            ));
        }

        "getFirstDescendant" | "getLastDescendant" => {
            let descendant = if method == "getFirstDescendant" {
                view.first_descendant(key)
            } else {
                view.last_descendant(key)
            };
            return descendant
                .map(|key| r.node(view, key))
                .unwrap_or(Ok(Value::Null));
        }
        "getTag" => {
            return Ok(serde_json::to_value(
                view.get::<lexical_rich_nodes::heading::HeadingNode>(key)
                    .ok_or_else(|| fail("heading"))?
                    .tag,
            )?);
        }
        "getType" => return Ok(json!(view.type_name(key)?)),
        "getKey" => return Ok(json!({"$nodeKey":key_wire(key)})),
        "getTextContent" => return Ok(json!(view.text_content(key))),
        "getTextContentSize" => return Ok(json!(view.text_content_size(key).get())),
        "isAttached" => return Ok(json!(view.is_attached(key))),
        "getLatest" => return r.node(view, key),
        "getChildrenSize" => return Ok(json!(view.children_size(key))),
        "getIndexWithinParent" => {
            return Ok(json!(
                view.index_within_parent(key).map_or(-1, |i| i.0 as i64)
            ));
        }
        "isEmpty" => return Ok(json!(view.is_empty(key))),
        "isInline" => return Ok(json!(view.is_inline(key))),
        "canBeEmpty" => return Ok(json!(view.can_be_empty(key))),
        "getParent"
        | "getParentOrThrow"
        | "getFirstChildOrThrow"
        | "getLastChildOrThrow"
        | "getFirstChild"
        | "getLastChild"
        | "getNextSibling"
        | "getPreviousSibling"
        | "getChildAtIndex" => {
            let node = match method {
                "getParent" => view.parent(key),
                "getParentOrThrow" => Some(view.parent_or_err(key)?),
                "getFirstChildOrThrow" => Some(view.first_child_or_err(key)?),
                "getLastChildOrThrow" => Some(view.last_child_or_err(key)?),
                "getFirstChild" => view.first_child(key),
                "getLastChild" => view.last_child(key),
                "getNextSibling" => view.next_sibling(key),
                "getPreviousSibling" => view.prev_sibling(key),
                _ => view.child_at_index(key, ChildIndex(u32_arg(a, 0, 0)?)),
            };
            return node.map(|key| r.node(view, key)).unwrap_or(Ok(Value::Null));
        }
        "getChildren" | "getAllTextNodes" => {
            let nodes = if method == "getChildren" {
                view.children_keys(key)?
            } else {
                view.all_text_nodes(key).collect()
            };
            return nodes.into_iter().map(|key| r.node(view, key)).collect();
        }
        "exportJSON" => {
            let mut json = view.export_json(key)?;
            // JS object returns retain undefined; JSON snapshots omit the property.
            if view.is::<lexical_rich_nodes::list::ListItemNode>(key)
                && !json.contains_key("checked")
            {
                let value = json.remove("value");
                json.insert("checked".into(), undefined());
                if let Some(value) = value {
                    json.insert("value".into(), value);
                }
            }
            if view.is::<lexical_rich_nodes::code::CodeNode>(key) {
                for field in ["language", "theme"] {
                    if !json.contains_key(field) {
                        json.insert(field.into(), undefined());
                    }
                }
            }
            return Ok(super::wire::exported_object(Value::Object(json)));
        }
        "hasFormat" => {
            return Ok(json!(
                view.text_data(key)?
                    .has_format(str_arg(a, 0)?.parse().map_err(|_| fail("format"))?)
            ));
        }
        "getFormat" => return Ok(json!(view.text_data(key)?.format.bits())),
        "getStyle" => return Ok(json!(view.text_data(key)?.style)),
        _ => {}
    }
    match method {
        "setURL" => {
            tx.get_mut::<lexical_rich_nodes::link::LinkNode>(key)?.url = str_arg(a, 0)?.into();
        }
        "setRel" | "setTarget" | "setTitle" => {
            let value = if a.first().is_none_or(Value::is_null) {
                None
            } else {
                Some(str_arg(a, 0)?.into())
            };
            let mut link = tx.get_mut::<lexical_rich_nodes::link::LinkNode>(key)?;
            match method {
                "setRel" => link.rel = value,
                "setTarget" => link.target = value,
                _ => link.title = value,
            };
        }
        "setTag" => {
            let tag = serde_json::from_value(a.first().cloned().ok_or_else(|| fail("tag"))?)?;
            lexical_rich_nodes::heading::set_tag(
                tx,
                tx.view()
                    .cast::<lexical_rich_nodes::heading::HeadingNode>(key)
                    .ok_or_else(|| fail("heading"))?,
                tag,
            )?;
        }
        "collapseAtStart" => {
            let slot = a
                .first()
                .map(|v| slot_arg(r, v))
                .transpose()?
                .unwrap_or(SelectionSlot::Active);
            return Ok(json!(tx.collapse_at_start(key, slot)?));
        }
        "append" => {
            let nodes = a.iter().map(node_key).collect::<Result<Vec<_>>>()?;
            tx.append(key, &nodes)?;
        }
        "clear" => {
            tx.clear(key)?;
        }
        "remove" => {
            tx.remove(key, a.first().and_then(Value::as_bool).unwrap_or(false))?;
            return Ok(undefined());
        }
        "replace" => {
            if let Some(id) = r.active_selection.take()
                && let Some(selection) = tx.selection().cloned()
            {
                r.selections[id] = tx.detach_selection(selection);
            }
            let node = node_key(a.first().ok_or_else(|| fail("replacement"))?)?;
            let node = tx.replace(
                key,
                node,
                a.get(1).and_then(Value::as_bool).unwrap_or(false),
            )?;
            return r.node(tx.view(), node);
        }
        "insertAfter" | "insertBefore" => {
            let node = node_key(a.first().ok_or_else(|| fail("node"))?)?;
            let restore = a.get(1).and_then(Value::as_bool).unwrap_or(true);
            let node = if method == "insertAfter" {
                tx.insert_after(key, node, restore)?
            } else {
                tx.insert_before(key, node, restore)?
            };
            return r.node(tx.view(), node);
        }
        "select" => {
            let anchor = a
                .first()
                .filter(|v| v.get("$undef").is_none())
                .map(|_| u32_arg(a, 0, 0))
                .transpose()?;
            let focus = a
                .get(1)
                .filter(|v| v.get("$undef").is_none())
                .map(|_| u32_arg(a, 1, 0))
                .transpose()?;
            if tx.is_text(key) {
                tx.text(key)?
                    .select(anchor.map(Utf16Offset), focus.map(Utf16Offset))?;
            } else {
                tx.element(key)?
                    .select(anchor.map(ChildIndex), focus.map(ChildIndex))?;
            }
            return Ok(r.selection(tx));
        }
        "selectStart" | "selectEnd" => {
            if method == "selectStart" {
                tx.select_start(key)?;
            } else {
                tx.select_end(key)?;
            }
            return Ok(r.selection(tx));
        }
        "setTextContent" => {
            tx.text(key)?.set_text_content(str_arg(a, 0)?)?;
        }
        "setStyle" => {
            tx.text(key)?.set_style(str_arg(a, 0)?)?;
        }
        "setMode" => {
            tx.text(key)?
                .set_mode(str_arg(a, 0)?.parse().map_err(|_| fail("mode"))?)?;
        }
        "setFormat" => {
            if tx.is_text(key) {
                if a.first().is_some_and(Value::is_string) {
                    tx.text(key)?
                        .set_format_type(str_arg(a, 0)?.parse().map_err(|_| fail("format"))?)?;
                } else {
                    tx.text(key)?
                        .set_format(TextFormat::from_bits_retain(u32_arg(a, 0, 0)?))?;
                }
            } else {
                tx.element(key)?
                    .set_format(str_arg(a, 0)?.parse().map_err(|_| fail("format"))?)?;
            }
        }
        "toggleFormat" => {
            tx.text(key)?
                .toggle_format(str_arg(a, 0)?.parse().map_err(|_| fail("format"))?)?;
        }
        "toggleUnmergeable" => {
            tx.text(key)?.toggle_unmergeable()?;
        }
        "toggleDirectionless" => {
            tx.text(key)?.toggle_directionless()?;
        }
        "setDirection" => {
            let direction = if a.first().is_none_or(Value::is_null) {
                None
            } else {
                Some(str_arg(a, 0)?.parse().map_err(|_| fail("direction"))?)
            };
            tx.element(key)?.set_direction(direction)?;
        }
        "setIndent" => {
            tx.set_indent(key, u32_arg(a, 0, 0)?)?;
        }
        "splitText" => {
            let offsets = a
                .iter()
                .map(|v| integer(v).map(|n| Utf16Offset(n as u32)))
                .collect::<Result<Vec<_>>>()?;
            return tx
                .text(key)?
                .split_text(&offsets)?
                .into_iter()
                .map(|key| r.node(tx.view(), key))
                .collect();
        }
        _ => return Err(fail(format!("unmapped API: Node.{method}"))),
    }
    r.node(tx.view(), key)
}
