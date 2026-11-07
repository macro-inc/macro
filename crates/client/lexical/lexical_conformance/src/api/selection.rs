use super::lexical::*;
use crate::replay::*;
use lexical_model::*;
use serde_json::{Value, json};
pub(crate) fn activate(r: &mut Replayer, tx: &mut Transaction<'_>, value: &Value) -> Result<()> {
    if let Some(old) = r.active_selection.take()
        && let Some(selection) = tx.selection().cloned()
    {
        r.selections[old] = tx.detach_selection(selection);
    }
    if value.is_null() {
        tx.set_selection(None)?;
        return Ok(());
    }
    let id = integer(&value["$selection"])? as usize;
    let selection = tx.selection_at(r.selections[id])?.cloned();
    tx.set_selection(selection)?;
    r.selections[id] = SelectionSlot::Active;
    r.active_selection = Some(id);
    Ok(())
}
pub(crate) fn call(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    receiver: &Value,
    method: &str,
    a: &[Value],
) -> Result<Value> {
    if let Some(point) = receiver.get("$point") {
        let id = integer(&point["selection"])? as usize;
        let slot = r.selections[id];
        let role = if point["role"] == "anchor" {
            PointRole::Anchor
        } else {
            PointRole::Focus
        };
        let point_value = if role == PointRole::Anchor {
            tx.anchor_at(slot)?
        } else {
            tx.focus_at(slot)?
        };
        return match method {
            "set" => {
                let key = key_arg(r, a.first().ok_or_else(|| fail("point key"))?)?;
                let kind: PointType = str_arg(a, 2)?.parse().map_err(|_| fail("point type"))?;
                tx.set_point_at(slot, role, Point::new(key, u32_arg(a, 1, 0)?, kind))?;
                Ok(undefined())
            }
            "getNode" => r.node(tx.view(), point_value.node(tx.view())?),
            "isBefore" | "is" => {
                let other = a.first().ok_or_else(|| fail("point"))?;
                let other_id = integer(&other["$point"]["selection"])? as usize;
                let other_slot = r.selections[other_id];
                let other = if other["$point"]["role"] == "anchor" {
                    tx.anchor_at(other_slot)?
                } else {
                    tx.focus_at(other_slot)?
                };
                Ok(json!(if method == "is" {
                    point_value == other
                } else {
                    point_value.is_before(tx.view(), &other)?
                }))
            }
            _ => Err(fail(format!("unmapped API: Point.{method}"))),
        };
    }
    let id = integer(&receiver["$selection"])? as usize;
    let slot = r.selections[id];
    let selection = tx
        .selection_at(slot)?
        .cloned()
        .ok_or_else(|| fail("empty selection handle"))?;
    match method {
        "isCollapsed" => Ok(json!(selection.is_collapsed())),
        "isBackward" => Ok(json!(selection.is_backward(tx.view())?)),
        "getTextContent" => Ok(json!(selection.text_content(tx.view())?)),
        "getNodes" | "extract" => {
            let nodes = if method == "extract" {
                tx.extract_at(slot)?
            } else {
                selection.nodes(tx.view())?
            };
            nodes
                .into_iter()
                .map(|key| r.node(tx.view(), key))
                .collect()
        }
        "deleteCharacter" => {
            let direction = if a.first().and_then(Value::as_bool).unwrap_or(false) {
                EditDirection::Backward
            } else {
                EditDirection::Forward
            };
            tx.delete_character_at(slot, direction, ModifyTarget::NoView)?;
            Ok(undefined())
        }
        "removeText" => {
            tx.remove_text_at(slot)?;
            Ok(undefined())
        }
        "insertText" => {
            tx.insert_text_at(slot, str_arg(a, 0)?)?;
            Ok(undefined())
        }
        "insertRawText" => {
            tx.insert_raw_text_at(slot, str_arg(a, 0)?)?;
            Ok(undefined())
        }
        "insertNodes" => {
            tx.insert_nodes_at(slot, &node_args(a.first().ok_or_else(|| fail("nodes"))?)?)?;
            r.active_selection = None;
            Ok(undefined())
        }
        "insertParagraph" => {
            let node = tx.insert_paragraph_at(slot)?;
            r.active_selection = None;
            node.map(|key| r.node(tx.view(), key))
                .unwrap_or(Ok(Value::Null))
        }
        "insertLineBreak" => {
            tx.insert_line_break_at(slot, a.first().and_then(Value::as_bool).unwrap_or(false))?;
            r.active_selection = None;
            Ok(undefined())
        }
        "formatText" => {
            tx.format_text_at(
                slot,
                str_arg(a, 0)?.parse().map_err(|_| fail("format"))?,
                None,
            )?;
            Ok(undefined())
        }
        "setFormat" => {
            tx.set_selection_format_at(slot, TextFormat::from_bits_retain(u32_arg(a, 0, 0)?))?;
            Ok(undefined())
        }
        "setStyle" => {
            tx.set_selection_style_at(slot, str_arg(a, 0)?)?;
            Ok(undefined())
        }
        "toggleFormat" => {
            tx.toggle_selection_format_at(
                slot,
                str_arg(a, 0)?.parse().map_err(|_| fail("format"))?,
            )?;
            Ok(undefined())
        }
        "hasFormat" => Ok(json!(
            selection
                .as_range()
                .ok_or_else(|| fail("range"))?
                .has_format(str_arg(a, 0)?.parse().map_err(|_| fail("format"))?)
        )),
        "clone" => {
            let new_id = r.selections.len();
            let kind = if selection.is_range() {
                "range"
            } else {
                "node"
            };
            r.selections.push(tx.detach_selection(selection));
            r.selection_values.push(None);
            Ok(json!({"$selection":new_id,"kind":kind}))
        }
        _ => Err(fail(format!("unmapped API: RangeSelection.{method}"))),
    }
}
