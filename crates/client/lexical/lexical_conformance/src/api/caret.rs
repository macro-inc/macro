//! Explicit upstream caret dispatch; returned values retain object identity.
use super::lexical::*;
use crate::replay::*;
use lexical_model::*;
use serde_json::{Value, json};
#[derive(Clone, Copy)]
pub(crate) enum CaretValue {
    Point(PointCaret),
    Range(CaretRange),
    Slice(TextPointCaretSlice),
}
fn direction(value: &Value) -> Result<CaretDirection> {
    match value.as_str() {
        Some("next") => Ok(CaretDirection::Next),
        Some("previous") => Ok(CaretDirection::Previous),
        _ => Err(fail("caret direction")),
    }
}
fn get(r: &Replayer, value: &Value) -> Result<CaretValue> {
    r.carets
        .get(integer(&value["$caretValue"])? as usize)
        .copied()
        .ok_or_else(|| fail("unknown caret"))
}
fn point(r: &Replayer, value: &Value) -> Result<PointCaret> {
    match get(r, value)? {
        CaretValue::Point(c) => Ok(c),
        _ => Err(fail("expected point caret")),
    }
}
fn range(r: &Replayer, value: &Value) -> Result<CaretRange> {
    match get(r, value)? {
        CaretValue::Range(c) => Ok(c),
        _ => Err(fail("expected caret range")),
    }
}
fn put(r: &mut Replayer, view: StateRef<'_>, value: CaretValue) -> Result<Value> {
    let id = r.carets.len();
    r.carets.push(value);
    Ok(match value {
        CaretValue::Point(c) => {
            json!({"$caretValue":id,"origin":r.node(view,c.origin())?,"direction":c.direction().to_string(),"type":match c { PointCaret::Child(_)=>"child",PointCaret::Sibling(_)=>"sibling",PointCaret::Text(_)=>"text" }})
        }
        CaretValue::Range(c) => {
            json!({"$caretValue":id,"$selection":{"caret":id},"kind":"range","direction":c.direction.to_string(),"type":"node-caret-range"})
        }
        CaretValue::Slice(_) => json!({"$caretValue":id,"type":"slice"}),
    })
}
pub(crate) fn call(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    receiver: &Value,
    name: &str,
    a: &[Value],
) -> Result<Value> {
    let first = || a.first().ok_or_else(|| fail("caret argument"));
    if receiver.get("$caretValue").is_some() {
        let value = get(r, receiver)?;
        match value {
            CaretValue::Range(c) => {
                return match name {
                    "get:direction" => Ok(json!(c.direction.to_string())),
                    "iter" => {
                        let carets = c
                            .node_carets(tx.view(), RootMode::Root)?
                            .iter(tx.view())
                            .collect::<std::result::Result<Vec<_>, _>>()?;
                        carets
                            .into_iter()
                            .map(|caret| put(r, tx.view(), CaretValue::Point(caret.into())))
                            .collect()
                    }
                    "isCollapsed" => Ok(json!(c.is_collapsed())),
                    "get:anchor" => put(r, tx.view(), CaretValue::Point(c.anchor)),
                    "get:focus" => put(r, tx.view(), CaretValue::Point(c.focus)),
                    "getLatest" => Ok(receiver.clone()),
                    "getTextSlices" => {
                        let (a, b) = c.text_slices(tx.view())?;
                        [a, b]
                            .into_iter()
                            .map(|s| match s {
                                Some(s) => put(r, tx.view(), CaretValue::Slice(s)),
                                None => Ok(Value::Null),
                            })
                            .collect()
                    }
                    _ => Err(fail(format!("unmapped caret range: {name}"))),
                };
            }
            CaretValue::Slice(s) => {
                return match name {
                    "getTextContent" => Ok(json!(s.text_content(tx.view())?)),
                    "getTextContentSize" => Ok(json!(s.text_content_size())),
                    "getSliceIndices" => {
                        let indices = s.slice_indices();
                        Ok(json!([indices.start.0, indices.end.0]))
                    }
                    "removeTextSlice" => {
                        let c = tx.remove_text_slice(s)?;
                        put(r, tx.view(), CaretValue::Point(c.into()))
                    }
                    _ => Err(fail(format!("unmapped caret slice: {name}"))),
                };
            }
            CaretValue::Point(c) => {
                let result = match name {
                    "get:direction" => return Ok(json!(c.direction().to_string())),
                    "get:origin" => return r.node(tx.view(), c.origin()),
                    "iter" => {
                        let node: NodeCaret = match c {
                            PointCaret::Child(c) => c.into(),
                            _ => c.sibling_caret().into(),
                        };
                        return node
                            .adjacent_nodes(tx.view())
                            .into_iter()
                            .map(|key| {
                                put(
                                    r,
                                    tx.view(),
                                    CaretValue::Point(SiblingCaret::new(key, c.direction()).into()),
                                )
                            })
                            .collect();
                    }
                    "isSamePointCaret" => {
                        return Ok(json!(c.is_same_point_caret(&point(r, first()?)?)));
                    }
                    "isSameNodeCaret" => {
                        return Ok(json!(c.is_same_node_caret(&point(r, first()?)?)));
                    }
                    "getNodeAtCaret" | "getParentAtCaret" => {
                        let key = if name == "getNodeAtCaret" {
                            c.node_at_caret(tx.view())
                        } else {
                            c.parent_at_caret(tx.view())
                        };
                        return key.map_or(Ok(Value::Null), |key| r.node(tx.view(), key));
                    }
                    "getLatest" => return Ok(receiver.clone()),
                    "getFlipped" => c.flipped(tx.view()),
                    "getSiblingCaret" => c.sibling_caret().into(),
                    "getChildCaret" => {
                        let Some(c) = c.child_caret(tx.view()) else {
                            return Ok(Value::Null);
                        };
                        c.into()
                    }
                    "getAdjacentCaret" => {
                        let Some(c) = c.adjacent_caret(tx.view()) else {
                            return Ok(Value::Null);
                        };
                        c.into()
                    }
                    "getParentCaret" => {
                        let mode = match a.first().and_then(Value::as_str) {
                            None | Some("root") => RootMode::Root,
                            Some("shadowRoot") => RootMode::ShadowRoot,
                            _ => return Err(fail("root mode")),
                        };
                        let Some(c) = c.parent_caret(tx.view(), mode) else {
                            return Ok(Value::Null);
                        };
                        c.into()
                    }
                    "insert" => {
                        tx.caret_insert(c, node_key(first()?)?)?;
                        return Ok(receiver.clone());
                    }
                    "remove" => {
                        tx.caret_remove(c)?;
                        return Ok(receiver.clone());
                    }
                    "replaceOrInsert" => {
                        tx.caret_replace_or_insert(
                            c,
                            node_key(first()?)?,
                            a.get(1).and_then(Value::as_bool).unwrap_or(false),
                        )?;
                        return Ok(receiver.clone());
                    }
                    _ => return Err(fail(format!("unmapped point caret: {name}"))),
                };
                return put(r, tx.view(), CaretValue::Point(result));
            }
        }
    }
    let result = match name {
        "$isChildCaret" | "$isSiblingCaret" | "$isTextPointCaret" => {
            let caret = get(r, first()?);
            return Ok(json!(matches!(
                (name, caret),
                ("$isChildCaret", Ok(CaretValue::Point(PointCaret::Child(_))))
                    | (
                        "$isSiblingCaret",
                        Ok(CaretValue::Point(PointCaret::Sibling(_)))
                    )
                    | (
                        "$isTextPointCaret",
                        Ok(CaretValue::Point(PointCaret::Text(_)))
                    )
            )));
        }
        "$getSiblingCaret" => {
            if first()?.is_null() {
                return Ok(Value::Null);
            };
            CaretValue::Point(
                SiblingCaret::new(
                    node_key(first()?)?,
                    direction(a.get(1).ok_or_else(|| fail("direction"))?)?,
                )
                .into(),
            )
        }
        "$getChildCaret" => {
            let Some(c) = ChildCaret::new(
                tx.view(),
                node_key(first()?)?,
                direction(a.get(1).ok_or_else(|| fail("direction"))?)?,
            ) else {
                return Ok(Value::Null);
            };
            CaretValue::Point(c.into())
        }
        "$getTextPointCaret" => {
            let spec = match a.get(2) {
                Some(Value::String(s)) if s == "next" => TextOffsetSpec::End,
                Some(Value::String(s)) if s == "previous" => TextOffsetSpec::Start,
                Some(v) => TextOffsetSpec::At(Utf16Offset(
                    u32::try_from(integer(v)?).map_err(|_| fail("offset"))?,
                )),
                None => return Err(fail("text offset")),
            };
            CaretValue::Point(
                TextPointCaret::new(
                    tx.view(),
                    node_key(first()?)?,
                    direction(a.get(1).ok_or_else(|| fail("direction"))?)?,
                    spec,
                )?
                .into(),
            )
        }
        "$getCaretRange" => CaretValue::Range(CaretRange::new(
            point(r, first()?)?,
            point(r, a.get(1).ok_or_else(|| fail("focus"))?)?,
        )?),
        "$getCollapsedCaretRange" => CaretValue::Range(CaretRange::collapsed(point(r, first()?)?)),
        "$caretRangeFromSelection" => CaretValue::Range(caret_range_from_selection(
            tx.view(),
            tx.range_at(slot_arg(r, first()?)?)?,
        )?),
        "$removeTextFromCaretRange" => {
            let range = range(r, first()?)?;
            let mode = match a.get(1).and_then(Value::as_str) {
                None | Some("removeEmptySlices") => SliceMode::RemoveEmptySlices,
                Some("preserveEmptyTextSliceCaret") => SliceMode::PreserveEmptyTextSliceCaret,
                _ => return Err(fail("slice mode")),
            };
            CaretValue::Range(tx.remove_text_from_caret_range(range, mode)?)
        }
        "$comparePointCaretNext" => {
            let cmp = compare_point_caret_next(
                tx.view(),
                point(r, first()?)?,
                point(r, a.get(1).ok_or_else(|| fail("point"))?)?,
            )?;
            return Ok(json!(match cmp {
                std::cmp::Ordering::Less => -1,
                std::cmp::Ordering::Equal => 0,
                std::cmp::Ordering::Greater => 1,
            }));
        }
        "$getCaretInDirection" => {
            let c = point(r, first()?)?;
            let d = direction(a.get(1).ok_or_else(|| fail("direction"))?)?;
            if c.direction() == d {
                return Ok(first()?.clone());
            };
            CaretValue::Point(c.in_direction(tx.view(), d))
        }
        "$getCaretRangeInDirection" => {
            let c = range(r, first()?)?;
            let d = direction(a.get(1).ok_or_else(|| fail("direction"))?)?;
            if c.direction == d {
                return Ok(first()?.clone());
            };
            CaretValue::Range(c.in_direction(tx.view(), d))
        }
        "$setSelectionFromCaretRange" => {
            if !tx.selection().is_some_and(Selection::is_range) {
                r.active_selection = None;
            }
            tx.set_selection_from_caret_range(range(r, first()?)?)?;
            return Ok(r.selection(tx));
        }
        "$normalizeCaret" => CaretValue::Point(normalize_caret(tx.view(), point(r, first()?)?)?),
        "$splitAtPointCaretNext" => {
            if a.len() != 1 {
                return Err(fail("unimplemented split caret options"));
            };
            let c = point(r, first()?)?;
            let Some(c) =
                tx.split_at_point_caret_next(c, SplitAtPointCaretNextOptions::default())?
            else {
                return Ok(Value::Null);
            };
            CaretValue::Point(c.into())
        }
        _ => return Err(fail(format!("unmapped caret API: {name}"))),
    };
    put(r, tx.view(), result)
}
