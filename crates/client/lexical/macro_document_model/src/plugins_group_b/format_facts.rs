//! Source toolbar facts from the actual immutable selection graph.
use lexical_model::*;
use lexical_rich_nodes::{heading::HeadingNode, link::LinkNode, list::ListNode};
use serde::Deserialize;
use serde_json::{Value, json};

#[cfg(test)]
mod test;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {}

fn kind(view: StateRef<'_>, key: NodeKey) -> Result<String, Error> {
    match view.type_name(key)? {
        "list" => Ok(format!(
            "list-{}",
            view.get_or_err::<ListNode>(key)?
                .list_type_value()
                .as_ref()
                .map(js_string)
                .unwrap_or_else(|| "undefined".into())
        )),
        "heading" => {
            let tag = serde_json::to_value(view.get_or_err::<HeadingNode>(key)?.tag)?;
            let tag = tag.as_str().ok_or(Error::Invariant("heading tag"))?;
            Ok(format!("heading{}", &tag[1..]))
        }
        name => Ok(name.to_owned()),
    }
}

fn element_kinds(view: StateRef<'_>, range: &RangeSelection) -> Result<Vec<String>, Error> {
    let Some(anchor) = view.top_level_element(range.anchor.key())? else {
        return Ok(Vec::new());
    };
    let Some(focus) = view.top_level_element(range.focus.key())? else {
        return Ok(Vec::new());
    };
    let (start, end) = if view.index_within_parent(anchor) <= view.index_within_parent(focus) {
        (anchor, focus)
    } else {
        (focus, anchor)
    };
    let mut kinds = Vec::new();
    let mut current = Some(start);
    while let Some(key) = current {
        let value = kind(view, key)?;
        if !kinds.contains(&value) {
            kinds.push(value);
        }
        if key == end {
            break;
        }
        current = view.next_sibling(key);
    }
    Ok(kinds)
}

fn has_links(view: StateRef<'_>, range: &RangeSelection) -> Result<bool, Error> {
    if range.is_collapsed() {
        return Ok(view
            .parent(range.anchor.key())
            .is_some_and(|parent| view.is::<LinkNode>(parent)));
    }
    Ok(range.nodes(view)?.into_iter().any(|key| {
        view.is::<LinkNode>(key)
            || view
                .parent(key)
                .is_some_and(|parent| view.is::<LinkNode>(parent))
    }))
}

pub(super) fn query(
    name: &str,
    data: &Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<Value>, Error> {
    if name != "group-b.format-facts" && name != "group-b.selection-text" {
        return Ok(None);
    }
    if generation != state.max_key().generation() {
        return Err(Error::Invariant("application query generation"));
    }
    if !data.is_object() {
        return Err(Error::Invariant("format facts request must be an object"));
    }
    let _: Request = serde_json::from_value(data.clone())?;
    if name == "group-b.selection-text" {
        return Ok(Some(json!({
            "generation": generation,
            "text": state.view().selection_text_content()?,
        })));
    }
    let range = state
        .selection()
        .and_then(Selection::as_range)
        .map(|range| {
            Ok::<_, Error>(json!({
                "format": range.format.bits(),
                "hasLinks": has_links(state.view(), range)?,
                "elementsInRange": element_kinds(state.view(), range)?,
            }))
        })
        .transpose()?;
    Ok(Some(json!({"generation": generation, "range": range})))
}
