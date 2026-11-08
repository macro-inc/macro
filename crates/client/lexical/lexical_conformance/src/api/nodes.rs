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
    // These public accessors call getLatest() in upstream. Raw get:__fields
    // resolve the receiver's captured version in properties.rs instead.
    let selection_arg = match method {
        "isSelected" => a.first(),
        "extractWithChild" => a.get(1),
        _ => None,
    };
    let selection = selection_arg
        .filter(|value| !value.is_null() && value.get("$undef").is_none())
        .map(|value| -> Result<_> {
            let slot = slot_arg(r, tx, value)?;
            Ok(tx
                .selection_at(slot)?
                .map(Selection::snapshot_for_foreign_read))
        })
        .transpose()?
        .flatten();
    let snapshot = r.read_state.clone();
    let view = snapshot
        .as_ref()
        .map(EditorState::view)
        .unwrap_or(tx.view());
    if view
        .get::<lexical_rich_nodes::link::LinkNode>(key)
        .is_some()
        && let Some(result) = super::rich::link_method(view, key, method, a)?
    {
        return Ok(result);
    }
    match method {
        "selectionTransform" => {
            tx.selection_transform(key)?;
            return Ok(undefined());
        }
        "getListType" => {
            return Ok(serde_json::to_value(
                view.get_or_err::<lexical_rich_nodes::list::ListNode>(key)?
                    .list_type(),
            )?);
        }

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
        "getFormatFlags" => {
            let kind: TextFormatType = str_arg(a, 0)?.parse().map_err(|_| fail("format kind"))?;
            let align = match a.get(1) {
                Some(Value::Null) => None,
                None => Some(TextFormat::empty()),
                Some(value) if value.get("$undef").is_some() => Some(TextFormat::empty()),
                Some(value) => Some(TextFormat::from_bits_retain(integer(value)? as u32)),
            };
            let format = if view.is_text(key) {
                view.text_data(key)?.format
            } else {
                view.element_data(key)?.text_format
            };
            return Ok(json!(format.toggled(kind, align).bits()));
        }
        "is" => {
            if a.first()
                .is_none_or(|value| value.is_null() || value.get("$undef").is_some())
            {
                return Ok(json!(false));
            }
            return Ok(json!(
                key == node_key(a.first().ok_or_else(|| fail("other node"))?)?
            ));
        }
        "splice" => {
            let nodes = a
                .get(2)
                .and_then(Value::as_array)
                .ok_or_else(|| fail("splice nodes"))?
                .iter()
                .map(node_key)
                .collect::<Result<Vec<_>>>()?;
            tx.splice(
                key,
                ChildIndex(u32_arg(a, 0, 0)?),
                u32_arg(a, 1, 0)?,
                &nodes,
            )?;
            return r.node(tx.view(), key);
        }
        "getType" => return super::properties::get(r, tx, receiver, "__type"),
        "getKey" => return Ok(key_value(key)),
        "getTextContent" => return Ok(json!(view.text_content(key))),
        "getTextContentSize" => return Ok(json!(view.text_content_size(key).get())),
        "isBefore" => {
            return Ok(json!(view.is_before(
                key,
                node_key(a.first().ok_or_else(|| fail("isBefore target"))?)?
            )?));
        }
        "isParentOf" => {
            return Ok(json!(view.is_parent_of(
                key,
                node_key(a.first().ok_or_else(|| fail("isParentOf target"))?)?
            )));
        }
        "isSelected" => {
            return Ok(json!(view.is_selected(key, selection.as_ref())));
        }
        "excludeFromCopy" => {
            let destination = a
                .first()
                .filter(|value| value.get("$undef").is_none())
                .map(copy_destination)
                .transpose()?;
            return Ok(json!(view.exclude_from_copy(key, destination)));
        }
        "extractWithChild" => {
            let child = node_key(a.first().ok_or_else(|| fail("child"))?)?;
            let destination = copy_destination(a.get(2).ok_or_else(|| fail("copy destination"))?)?;
            return Ok(json!(view.extract_with_child(
                key,
                child,
                selection.as_ref(),
                destination
            )));
        }
        "isAttached" => return Ok(json!(view.is_attached(key))),
        "isLastChild" => return Ok(json!(view.is_last_child(key)?)),
        "isDirty" => {
            return Ok(json!(if view.is_element(key) {
                tx.is_dirty_element(key)
            } else {
                tx.is_dirty_leaf(key)
            }));
        }
        "isComposing" => return Ok(json!(view.is_composing(key))),
        "isShadowRoot" => return Ok(json!(view.is_shadow_root(key))),
        "isParentRequired" => return Ok(json!(view.is_parent_required(key))),
        "isTextEntity" => return Ok(json!(view.is_text_entity(key))),
        "isIsolated" => return Ok(json!(view.is_isolated(key))),
        "isKeyboardSelectable" => return Ok(json!(view.is_keyboard_selectable(key))),
        "canIndent" => return Ok(json!(view.can_indent(key))),
        "canMergeWhenEmpty" => return Ok(json!(view.can_merge_when_empty(key))),
        "canHaveFormat" => return Ok(json!(view.can_have_format(key))),
        "canInsertTextBefore" => return Ok(json!(view.can_insert_text_before(key))),
        "canInsertTextAfter" => return Ok(json!(view.can_insert_text_after(key))),
        "canMergeWith" | "canReplaceWith" | "canInsertAfter" => {
            let other = node_key(a.first().ok_or_else(|| fail("other node"))?)?;
            return Ok(json!(match method {
                "canMergeWith" => view.can_merge_with(key, other),
                "canReplaceWith" => view.can_replace_with(key, other),
                _ => view.can_insert_after(key, other),
            }));
        }
        "getLatest" => return r.node(view, key),
        "getWritable" => {
            tx.mark_dirty(key)?;
            return r.node(tx.view(), key);
        }
        "getChildrenSize" => return Ok(json!(view.children_size(key))),
        "getIndexWithinParent" => {
            return Ok(json!(
                view.index_within_parent(key).map_or(-1, |i| i.0 as i64)
            ));
        }
        "markDirty" => {
            tx.mark_dirty(key)?;
            return Ok(undefined());
        }
        "isSimpleText" => return Ok(json!(view.is_simple_text(key))),
        "mergeWithSibling" => {
            let other = node_key(a.first().ok_or_else(|| fail("sibling"))?)?;
            let key = tx.text(key)?.merge_with_sibling(other)?;
            return r.node(tx.view(), key);
        }
        "selectPrevious" | "selectNext" => {
            let offset = |i: usize| {
                a.get(i)
                    .filter(|v| !v.is_null() && v.get("$undef").is_none())
                    .map(|v| integer(v).map(|n| Utf16Offset(n as u32)))
                    .transpose()
            };
            if method == "selectPrevious" {
                tx.select_previous(key, offset(0)?, offset(1)?)?;
            } else {
                tx.select_next(key, offset(0)?, offset(1)?)?;
            }
            return r.selection(tx);
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
        | "getDescendantByIndex"
        | "getTopLevelElement"
        | "getTopLevelElementOrThrow"
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
                "getDescendantByIndex" => {
                    view.descendant_by_index(key, ChildIndex(u32_arg(a, 0, 0)?))
                }
                "getTopLevelElement" => view.top_level_element(key)?,
                "getTopLevelElementOrThrow" => Some(view.top_level_element_or_err(key)?),
                _ => view.child_at_index(key, ChildIndex(u32_arg(a, 0, 0)?)),
            };
            return node.map(|key| r.node(view, key)).unwrap_or(Ok(Value::Null));
        }
        "getCommonAncestor" => {
            let other = node_key(a.first().ok_or_else(|| fail("other node"))?)?;
            let a = if view.is_element(key) {
                Some(key)
            } else {
                view.parent(key)
            };
            let b = if view.is_element(other) {
                Some(other)
            } else {
                view.parent(other)
            };
            let ancestor = a
                .zip(b)
                .and_then(|(a, b)| view.common_ancestor(a, b))
                .map(CommonAncestor::ancestor);
            return ancestor
                .map(|key| r.node(view, key))
                .unwrap_or(Ok(Value::Null));
        }
        "getChildrenKeys" => {
            return Ok(view
                .children_keys(key)?
                .into_iter()
                .map(key_value)
                .collect());
        }
        "getParents" | "getNextSiblings" | "getPreviousSiblings" | "getNodesBetween" => {
            let nodes: Vec<_> = match method {
                "getParents" => view.ancestors(key).collect(),
                "getNextSiblings" => view.next_siblings(key).collect(),
                "getPreviousSiblings" => view.prev_siblings(key).collect(),
                _ => view
                    .nodes_between(key, node_key(a.first().ok_or_else(|| fail("other node"))?)?)?,
            };
            return nodes.into_iter().map(|key| r.node(view, key)).collect();
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
            return Ok(Value::Object(json));
        }
        "hasFormat" => {
            if view.is_element(key) {
                let format = str_arg(a, 0)?.parse().map_err(|_| fail("element format"))?;
                return Ok(json!(view.element_data(key)?.format.has_format(format)));
            }
            return Ok(json!(
                view.text_data(key)?
                    .has_format(str_arg(a, 0)?.parse().map_err(|_| fail("format"))?)
            ));
        }
        "getFormat" => {
            return Ok(json!(if view.is_text(key) {
                view.text_data(key)?.format.bits()
            } else {
                view.element_data(key)?.format.bits()
            }));
        }
        "getStyle" => {
            return Ok(json!(if view.is_text(key) {
                &view.text_data(key)?.style
            } else {
                &view.element_data(key)?.style
            }));
        }
        "getTextFormat" => return Ok(json!(view.element_data(key)?.text_format.bits())),
        "getFormatType" => return Ok(json!(view.element_data(key)?.format)),
        "getIndent" => return Ok(json!(view.indent(key))),
        "getDirection" => return Ok(json!(view.element_data(key)?.direction)),
        "getDetail" => return Ok(json!(view.text_data(key)?.detail.bits())),
        "getMode" => return Ok(json!(view.text_data(key)?.mode)),
        "isToken" => return Ok(json!(view.text_data(key)?.mode == TextMode::Token)),
        "isSegmented" => return Ok(json!(view.text_data(key)?.mode == TextMode::Segmented)),
        "isDirectionless" => {
            return Ok(json!(
                view.text_data(key)?
                    .detail
                    .contains(TextDetail::DIRECTIONLESS)
            ));
        }
        "isUnmergeable" => {
            return Ok(json!(
                view.text_data(key)?
                    .detail
                    .contains(TextDetail::UNMERGEABLE)
            ));
        }
        "hasTextFormat" => {
            let format = str_arg(a, 0)?.parse().map_err(|_| fail("text format"))?;
            return Ok(json!(view.element_data(key)?.text_format.has(format)));
        }
        "getTextStyle" => return Ok(json!(view.element_data(key)?.text_style)),
        "getParentKeys" => {
            let mut keys = Vec::new();
            let mut parent = view.parent(key);
            while let Some(key) = parent {
                keys.push(key_value(key));
                parent = view.parent(key);
            }
            return Ok(json!(keys));
        }
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
                .map(|v| slot_arg(r, tx, v))
                .transpose()?
                .unwrap_or(SelectionSlot::Active);
            return Ok(json!(tx.collapse_at_start(key, slot)?));
        }
        "createParentElementNode" => {
            let parent = tx.create_parent_element(key)?;
            return r.node(tx.view(), parent);
        }
        "insertNewAfter" => {
            let selection = slot_arg(r, tx, a.first().ok_or_else(|| fail("selection"))?)?;
            let restore = a.get(1).and_then(Value::as_bool).unwrap_or(true);
            return tx
                .insert_new_after(key, selection, restore)?
                .map(|node| r.node(tx.view(), node))
                .unwrap_or(Ok(Value::Null));
        }
        "resetOnCopyNodeFrom" => {
            let original = node_key(a.first().ok_or_else(|| fail("original node"))?)?;
            tx.reset_on_copy(key, original)?;
            return Ok(undefined());
        }
        "updateFromJSON" => {
            let json = a
                .first()
                .and_then(Value::as_object)
                .ok_or_else(|| fail("serialized node"))?;
            tx.update_from_json(key, json)?;
        }
        "spliceText" => {
            let start = u32_arg(a, 0, 0)?;
            let end = start.saturating_add(u32_arg(a, 1, 0)?);
            let insert = str_arg(a, 2)?;
            let move_selection = a.get(3).and_then(Value::as_bool).unwrap_or(false);
            tx.text(key)?.splice_text(
                Utf16Offset(start)..Utf16Offset(end),
                insert,
                move_selection,
            )?;
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
            return r.selection(tx);
        }
        "selectStart" | "selectEnd" => {
            if method == "selectStart" {
                tx.select_start(key)?;
            } else {
                tx.select_end(key)?;
            }
            return r.selection(tx);
        }
        "setTextStyle" => {
            tx.element(key)?.set_text_style(str_arg(a, 0)?)?;
        }
        "setTextContent" => {
            tx.text(key)?.set_text_content(str_arg(a, 0)?)?;
        }
        "setStyle" => {
            if tx.is_text(key) {
                tx.text(key)?.set_style(str_arg(a, 0)?)?;
            } else {
                tx.element(key)?.set_style(str_arg(a, 0)?)?;
            }
        }
        "setTextFormat" => {
            tx.element(key)?
                .set_text_format(TextFormat::from_bits_retain(u32_arg(a, 0, 0)?))?;
        }
        "setDetail" => {
            let detail = if a.first().is_some_and(Value::is_string) {
                match str_arg(a, 0)? {
                    "directionless" => TextDetail::DIRECTIONLESS,
                    "unmergeable" => TextDetail::UNMERGEABLE,
                    _ => return Err(fail("text detail")),
                }
            } else {
                TextDetail::from_bits_retain(u32_arg(a, 0, 0)?)
            };
            tx.text(key)?.set_detail(detail)?;
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

fn copy_destination(value: &Value) -> Result<CopyDestination> {
    match value.as_str() {
        Some("clone") => Ok(CopyDestination::Clone),
        Some("html") => Ok(CopyDestination::Html),
        _ => Err(fail("copy destination")),
    }
}

#[cfg(test)]
mod test;
