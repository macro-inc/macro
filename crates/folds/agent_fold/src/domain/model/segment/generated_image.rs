//! Images the GenerateImage tool stored, read off its result so a reply
//! posted to a conversation can carry them as attachments.

use serde::{Deserialize, Serialize};

use super::{MessagePart, ToolDetail, ToolStatus};

/// An image a tool call in the reply generated and stored as a static file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImage {
    /// The static file the image is stored as.
    pub static_file_id: String,
    /// Intrinsic pixel width; absent only in historical tool results.
    pub width: Option<u32>,
    /// Intrinsic pixel height; absent only in historical tool results.
    pub height: Option<u32>,
}

// Read only the fields an attachment needs from image_generation's
// GenerateImageResponse; the wasm fold cannot depend on that crate.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    static_file_id: String,
    width: Option<u32>,
    height: Option<u32>,
}

pub(super) fn images(parts: &[MessagePart]) -> Vec<GeneratedImage> {
    parts
        .iter()
        .filter_map(|part| match part {
            MessagePart::ToolUse {
                name,
                status: ToolStatus::Completed,
                detail,
                ..
            } if name.display() == "GenerateImage" => match detail {
                ToolDetail::Macro { output, .. } => output.as_ref(),
                ToolDetail::Other { result, .. } => result.as_ref(),
                _ => None,
            },
            _ => None,
        })
        .filter_map(|output| serde_json::from_value::<Output>(output.clone()).ok())
        .map(|output| GeneratedImage {
            static_file_id: output.static_file_id,
            width: output.width,
            height: output.height,
        })
        .collect()
}
