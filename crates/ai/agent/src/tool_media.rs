//! Explicit native media presentation at the agent adapter boundary.
use rig_agent::tool::{ToolExecutionError, ToolOutput};
use rig_core::{
    OneOrMany,
    message::{DocumentSourceKind, Image, ImageMediaType, ToolResultContent},
};
use serde_json::Value;

/// Only an explicit, top-level tool media contract is promoted. Nested scene or
/// retrieved content never becomes model media and URLs are never fetched here.
pub(crate) fn model_output(mut value: Value) -> Result<ToolOutput, ToolExecutionError> {
    let Some(media) = value
        .as_object_mut()
        .and_then(|map| map.remove("modelMedia"))
    else {
        return Ok(ToolOutput::json(value));
    };
    let images = media
        .as_array()
        .ok_or_else(|| ToolExecutionError::other("Invalid model media result"))?;
    if images.len() > 2 {
        return Err(ToolExecutionError::other("Too many tool images"));
    }
    let mut content = vec![ToolResultContent::json(value)];
    for image in images {
        let data = image
            .get("data")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolExecutionError::other("Missing tool image data"))?;
        if image["type"] != "image"
            || image["mediaType"] != "image/png"
            || data.len() > 4_000_000
            || !data.starts_with("iVBORw0KGgo")
        {
            return Err(ToolExecutionError::other("Invalid bounded PNG tool result"));
        }
        content.push(ToolResultContent::Image(Image {
            data: DocumentSourceKind::Base64(data.to_owned()),
            media_type: Some(ImageMediaType::PNG),
            ..Default::default()
        }));
    }
    Ok(ToolOutput::content(OneOrMany::many(content).map_err(
        |error| ToolExecutionError::other(error.to_string()),
    )?))
}

/// Keep the public JSON contract in the existing result stream/history. Native
/// model content is reconstructed explicitly by the same adapter on replay.
pub(crate) fn result_json(presentation: &ToolOutput) -> Option<Value> {
    let mut json = presentation
        .as_content()
        .iter()
        .find_map(|part| part.as_json())
        .cloned()
        .or_else(|| {
            presentation
                .as_text()
                .and_then(|text| serde_json::from_str(text).ok())
        })?;
    let media: Vec<_> = presentation
        .as_content()
        .iter()
        .filter_map(|part| match part {
            ToolResultContent::Image(Image {
                data: DocumentSourceKind::Base64(data),
                media_type: Some(ImageMediaType::PNG),
                ..
            }) => {
                Some(serde_json::json!({ "type": "image", "mediaType": "image/png", "data": data }))
            }
            _ => None,
        })
        .collect();
    if !media.is_empty() {
        json.as_object_mut()?
            .insert("modelMedia".to_owned(), Value::Array(media));
    }
    Some(json)
}

#[cfg(test)]
mod test;
