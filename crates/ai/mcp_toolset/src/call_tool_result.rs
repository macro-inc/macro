//! Convenience behavior for MCP tool-call results.

use rmcp::model::{CallToolResult, ResourceContents};

#[cfg(test)]
mod test;

/// Conversion helpers implemented directly on [`CallToolResult`] through an
/// extension trait.
pub trait CallToolResultExt {
    /// Concatenate text-bearing content blocks while preserving block boundaries.
    fn text_content(&self) -> String;

    /// Convert a successful result into the JSON value exposed to Macro tools.
    ///
    /// Structured content is preserved as JSON. Results without structured
    /// content fall back to their text-bearing content blocks.
    fn into_value(self) -> serde_json::Value;

    /// Produce a useful error description from text or structured content.
    fn error_description(&self) -> String;
}

impl CallToolResultExt for CallToolResult {
    fn text_content(&self) -> String {
        self.content
            .iter()
            .filter_map(|content| {
                content
                    .raw
                    .as_text()
                    .map(|text| text.text.clone())
                    .or_else(|| {
                        let resource = content.raw.as_resource()?;
                        match &resource.resource {
                            ResourceContents::TextResourceContents { text, .. }
                                if !text.is_empty() =>
                            {
                                Some(text.clone())
                            }
                            _ => None,
                        }
                    })
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn into_value(self) -> serde_json::Value {
        let text = self.text_content();
        self.structured_content
            .unwrap_or(serde_json::Value::String(text))
    }

    fn error_description(&self) -> String {
        let text = self.text_content();
        if text.is_empty() {
            self.structured_content
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_else(|| "MCP tool returned an error".to_string())
        } else {
            text
        }
    }
}
