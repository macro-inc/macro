//! Source MarkdownPopup selection snippet: persistent location, text and end point.
use super::*;
use serde_json::{Value, json};

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {}

/// Answer `group-b.selection-snippet` from the committed model selection.
///
/// Source `$getSelectionLocation` needs a non-collapsed range whose anchor and
/// focus nodes both carry durable ids; otherwise the reply is `null`. Text is
/// `RangeSelection.getTextContent()`, and the end is the backward anchor or the
/// forward focus, as `handleCreateTask` reads it.
pub(super) fn query(
    name: &str,
    data: &Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<Value>, Error> {
    if name != "group-b.selection-snippet" {
        return Ok(None);
    }
    if generation != state.max_key().generation() {
        return Err(Error::Invariant("application query generation"));
    }
    if !data.is_object() {
        return Err(Error::Invariant(
            "selection snippet request must be an object",
        ));
    }
    let _: Request = serde_json::from_value(data.clone())?;
    let view = state.view();
    let Some(range) = state.selection().and_then(Selection::as_range) else {
        return Ok(Some(Value::Null));
    };
    if range.is_collapsed() {
        return Ok(Some(Value::Null));
    }
    let id = |point: Point| crate::node_ids::get_id(view, point.key());
    let (Some(anchor), Some(focus)) = (id(range.anchor)?, id(range.focus)?) else {
        return Ok(Some(Value::Null));
    };
    let end = if range.is_backward(view)? {
        range.anchor
    } else {
        range.focus
    };
    Ok(Some(json!({
        "location": {
            "anchor": { "id": anchor.as_str(), "offset": range.anchor.offset() },
            "focus": { "id": focus.as_str(), "offset": range.focus.offset() },
        },
        "text": range.text_content(view)?,
        "end": {
            "key": end.key().parts().index,
            "offset": end.offset(),
            "type": match end.point_type() {
                PointType::Text => "text",
                PointType::Element => "element",
            },
        },
    })))
}

#[cfg(test)]
mod test;
