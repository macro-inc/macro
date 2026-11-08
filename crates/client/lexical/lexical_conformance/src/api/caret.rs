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
    if let CaretValue::Range(range) = value {
        let anchor = put(r, view, CaretValue::Point(range.anchor))?;
        let focus = put(r, view, CaretValue::Point(range.focus))?;
        r.caret_endpoints.insert(id, (anchor, focus));
    }
    if let CaretValue::Point(point) = value {
        let origin = r.node(view, point.origin())?;
        r.caret_origins.insert(id, origin);
    }
    Ok(match value {
        CaretValue::Point(c) => {
            json!({"$caretValue":id,"origin":r.node(view,c.origin())?,"direction":c.direction().to_string(),"type":match c { PointCaret::Child(_)=>"child",PointCaret::Sibling(_)=>"sibling",PointCaret::Text(_)=>"text" }})
        }
        CaretValue::Range(c) => {
            json!({"$caretValue":id,"$selection":{"caret":id},"kind":"range","direction":c.direction.to_string(),"type":"node-caret-range"})
        }
        CaretValue::Slice(slice) => {
            let caret = put(r, view, CaretValue::Point(slice.caret.into()))?;
            json!({"$caretValue":id,"type":"slice","caret":caret,"distance":slice.distance})
        }
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
    if let Some(id) = receiver.get("$iteratorValue") {
        if name != "iter" {
            return Err(fail("unsupported iterator method"));
        }
        let id = integer(id)? as usize;
        if let Some(values) = r.value_iterators.remove(&id) {
            return Ok(json!(values));
        }
        let Some((cursor, first_origin)) = r
            .iterators
            .get_mut(id)
            .ok_or_else(|| fail("iterator handle"))?
            .take()
        else {
            return Ok(json!([]));
        };
        let carets = cursor
            .iter(tx.view())
            .collect::<std::result::Result<Vec<_>, _>>()?;
        return carets
            .into_iter()
            .enumerate()
            .map(|(index, caret)| {
                let id = r.carets.len();
                let mut value = put(r, tx.view(), CaretValue::Point(caret.into()))?;
                if index == 0
                    && let Some(origin) = &first_origin
                {
                    r.caret_origins.insert(id, origin.clone());
                    value["origin"] = origin.clone();
                }
                Ok(value)
            })
            .collect();
    }
    if receiver.get("$caretValue").is_some() {
        let value = get(r, receiver)?;
        match value {
            CaretValue::Range(c) => {
                return match name {
                    "get:direction" => Ok(json!(c.direction.to_string())),
                    "iterNodeCarets" => {
                        let mode = match a.first() {
                            None => RootMode::Root,
                            Some(Value::String(s)) if s == "shadowRoot" => RootMode::ShadowRoot,
                            Some(v) if v.get("$nodeKey") == Some(&json!(0)) => RootMode::Root,
                            _ => return Err(fail("caret root mode")),
                        };
                        let id = r.iterators.len();
                        let cursor = c.node_carets(tx.view(), mode)?;
                        let mut probe = cursor;
                        let first_origin = probe
                            .next(tx.view())?
                            .map(|caret| r.node(tx.view(), caret.origin()))
                            .transpose()?;
                        r.iterators.push(Some((cursor, first_origin)));
                        Ok(json!({"$iteratorValue":id}))
                    }
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
                    "get:anchor" | "get:focus" => {
                        let id = integer(&receiver["$caretValue"])? as usize;
                        if let Some((anchor, focus)) = r.caret_endpoints.get(&id) {
                            Ok(if name == "get:anchor" {
                                anchor.clone()
                            } else {
                                focus.clone()
                            })
                        } else {
                            put(
                                r,
                                tx.view(),
                                CaretValue::Point(if name == "get:anchor" {
                                    c.anchor
                                } else {
                                    c.focus
                                }),
                            )
                        }
                    }
                    "getLatest" => {
                        let id = integer(&receiver["$caretValue"])? as usize;
                        let (anchor, focus) = r
                            .caret_endpoints
                            .get(&id)
                            .cloned()
                            .ok_or_else(|| fail("range endpoints"))?;
                        let latest_anchor = call(r, tx, &anchor, "getLatest", &[])?;
                        let latest_focus = call(r, tx, &focus, "getLatest", &[])?;
                        if anchor == latest_anchor && focus == latest_focus {
                            Ok(receiver.clone())
                        } else {
                            let id = r.carets.len();
                            let value = put(r, tx.view(), CaretValue::Range(c))?;
                            r.caret_endpoints.insert(id, (latest_anchor, latest_focus));
                            Ok(value)
                        }
                    }
                    "getTextSlices" => {
                        let (a, b) = c.text_slices(tx.view())?;
                        let id = integer(&receiver["$caretValue"])? as usize;
                        let (anchor, focus) = r
                            .caret_endpoints
                            .get(&id)
                            .cloned()
                            .ok_or_else(|| fail("range endpoints"))?;
                        [(a, anchor), (b, focus)]
                            .into_iter()
                            .map(|(slice, endpoint)| match slice {
                                Some(slice) => {
                                    let caret = call(r, tx, &endpoint, "getLatest", &[])?;
                                    let mut value = put(r, tx.view(), CaretValue::Slice(slice))?;
                                    value["caret"] = caret;
                                    Ok(value)
                                }
                                None => Ok(Value::Null),
                            })
                            .collect()
                    }
                    _ => Err(fail(format!("unmapped caret range: {name}"))),
                };
            }
            CaretValue::Slice(s) => {
                return match name {
                    "get:distance" => Ok(json!(s.distance)),
                    "get:caret" => Ok(receiver["caret"].clone()),
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
                    "get:offset" => {
                        return match c {
                            PointCaret::Text(c) => Ok(json!(c.offset.0)),
                            _ => Err(fail("offset on non-text caret")),
                        };
                    }
                    "get:direction" => return Ok(json!(c.direction().to_string())),
                    "get:origin" => {
                        return r
                            .caret_origins
                            .get(&(integer(&receiver["$caretValue"])? as usize))
                            .cloned()
                            .ok_or_else(|| fail("caret origin"));
                    }
                    "iter" | "iterNodeCarets" => {
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
                    "getLatest" => {
                        let current = r.node(tx.view(), c.origin())?;
                        if r.caret_origins
                            .get(&(integer(&receiver["$caretValue"])? as usize))
                            == Some(&current)
                        {
                            return Ok(receiver.clone());
                        }
                        c
                    }
                    "getFlipped" => c.flipped(tx.view()),
                    "getSiblingCaret" => {
                        if matches!(c, PointCaret::Sibling(_)) {
                            return Ok(receiver.clone());
                        }
                        c.sibling_caret().into()
                    }
                    "getChildCaret" => {
                        if matches!(c, PointCaret::Child(_)) {
                            return Ok(receiver.clone());
                        }
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
                let id = r.carets.len();
                let mut output = put(r, tx.view(), CaretValue::Point(result))?;
                if name != "getLatest"
                    && result.origin() == c.origin()
                    && let Some(origin) = r
                        .caret_origins
                        .get(&(integer(&receiver["$caretValue"])? as usize))
                        .cloned()
                {
                    r.caret_origins.insert(id, origin.clone());
                    output["origin"] = origin;
                }
                return Ok(output);
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
        "$getCommonAncestor" => {
            let Some(common) = tx.view().common_ancestor(
                node_key(first()?)?,
                node_key(a.get(1).ok_or_else(|| fail("other"))?)?,
            ) else {
                return Ok(Value::Null);
            };
            let (kind, ancestor) = match common {
                CommonAncestor::Same { ancestor } => ("same", ancestor),
                CommonAncestor::Ancestor { ancestor } => ("ancestor", ancestor),
                CommonAncestor::Descendant { ancestor } => ("descendant", ancestor),
                CommonAncestor::Branch { ancestor, .. } => ("branch", ancestor),
            };
            let mut value = json!({"type":kind,"commonAncestor":r.node(tx.view(),ancestor)?});
            if let CommonAncestor::Branch { a, b, .. } = common {
                value["a"] = r.node(tx.view(), a)?;
                value["b"] = r.node(tx.view(), b)?;
            }
            return Ok(value);
        }
        "$getCommonAncestorResultBranchOrder" => {
            let value = first()?;
            return Ok(json!(if tx
                .view()
                .is_before(node_key(&value["a"])?, node_key(&value["b"])?)?
            {
                -1
            } else {
                1
            }));
        }
        "$rewindSiblingCaret" => {
            let PointCaret::Sibling(c) = point(r, first()?)? else {
                return Err(fail("expected sibling caret"));
            };
            CaretValue::Point(c.rewind(tx.view())?.into())
        }
        "$setPointFromCaret" => {
            let target = first()?;
            let id = integer(&target["$point"]["selection"])? as usize;
            let slot = *r
                .selections
                .get(id)
                .ok_or_else(|| fail("selection handle"))?;
            let role = match target["$point"]["role"].as_str() {
                Some("anchor") => PointRole::Anchor,
                Some("focus") => PointRole::Focus,
                _ => return Err(fail("point role")),
            };
            let caret = point(r, a.get(1).ok_or_else(|| fail("caret"))?)?;
            let point = point_from_caret(tx.view(), &caret)?;
            tx.set_point_at(slot, role, point)?;
            return Ok(undefined());
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
        "$getCaretRange" | "$getCollapsedCaretRange" => {
            let anchor = first()?.clone();
            let focus = if name == "$getCollapsedCaretRange" {
                anchor.clone()
            } else {
                a.get(1).ok_or_else(|| fail("focus"))?.clone()
            };
            let range = CaretRange::new(point(r, &anchor)?, point(r, &focus)?)?;
            let id = r.carets.len();
            let result = put(r, tx.view(), CaretValue::Range(range))?;
            r.caret_endpoints.insert(id, (anchor, focus));
            return Ok(result);
        }
        "$caretRangeFromSelection" => CaretValue::Range(caret_range_from_selection(
            tx.view(),
            tx.range_at(slot_arg(r, first()?)?)?,
        )?),
        "$removeTextFromCaretRange" => {
            let input = first()?.clone();
            let range = range(r, &input)?;
            let mode = match a.get(1).and_then(Value::as_str) {
                None | Some("removeEmptySlices") => SliceMode::RemoveEmptySlices,
                Some("preserveEmptyTextSliceCaret") => SliceMode::PreserveEmptyTextSliceCaret,
                _ => return Err(fail("slice mode")),
            };
            let result = tx.remove_text_from_caret_range(range, mode)?;
            if range.is_collapsed() {
                return Ok(input);
            }
            let old_id = integer(&input["$caretValue"])? as usize;
            let endpoints = r.caret_endpoints.get(&old_id).cloned();
            let id = r.carets.len();
            let value = put(r, tx.view(), CaretValue::Range(result))?;
            if let Some((anchor, _focus)) = endpoints {
                let old_origin = r
                    .caret_origins
                    .get(&(integer(&anchor["$caretValue"])? as usize))
                    .cloned();
                let current_origin = r.node(tx.view(), result.anchor.origin())?;
                let anchor = if range.direction == CaretDirection::Next
                    && result.anchor == range.anchor
                    && old_origin.as_ref() == Some(&current_origin)
                {
                    anchor
                } else {
                    put(r, tx.view(), CaretValue::Point(result.anchor))?
                };
                let focus = if result.focus == result.anchor {
                    anchor.clone()
                } else {
                    put(r, tx.view(), CaretValue::Point(result.focus))?
                };
                r.caret_endpoints.insert(id, (anchor, focus));
            }
            return Ok(value);
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
    let id = r.carets.len();
    let mut output = put(r, tx.view(), result)?;
    if matches!(
        name,
        "$getSiblingCaret" | "$getChildCaret" | "$getTextPointCaret"
    ) {
        let origin = first()?.clone();
        r.caret_origins.insert(id, origin.clone());
        output["origin"] = origin;
    }
    Ok(output)
}

#[cfg(test)]
mod test;
