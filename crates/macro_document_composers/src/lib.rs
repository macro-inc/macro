//! Server-side typed prompt and announcement composition with portable wire replay.
#![deny(missing_docs)]
use macro_document_model::{
    DocumentContext, Error, ModelResult, Result, markdown, nanoid, nodes, parsers, transformers,
    xml,
};
mod context_wire;
mod image;
mod replies;
#[cfg(not(target_arch = "wasm32"))]
/// Typed source endpoint shapes preserving string IDs and timestamps.
pub mod wire_trigger;
pub use replies::*;
#[cfg(not(target_arch = "wasm32"))]
mod context;
/// Request/response parsing and exact source-function replay entry points.
pub mod wire;
#[cfg(not(target_arch = "wasm32"))]
pub use context::*;
/// Validated generated image for a message body.
#[derive(Clone, Debug)]
pub struct ImageMarkdownInput {
    /// Verbatim RFC 9562 static-file identifier.
    pub static_file_id: String,
    /// Original, untrimmed source URL.
    pub url: String,
    /// Positive pixel width.
    pub width: std::num::NonZeroU32,
    /// Positive pixel height.
    pub height: std::num::NonZeroU32,
}
/// Compose generated-image Markdown from positive dimensions and source metadata.
pub fn compose_image_markdown(
    image: &ImageMarkdownInput,
    context: &macro_document_model::DocumentContext,
) -> macro_document_model::Result<String> {
    image::compose_source_image(
        &image::WireImageInput {
            static_file_id: image.static_file_id.clone(),
            url: image.url.clone(),
            width: f64::from(image.width.get()),
            height: f64::from(image.height.get()),
        },
        context,
    )
}
/// Escape reserved context tags before the authored Markdown import transaction.
pub fn escape_agent_context_tags(markdown: &str) -> String {
    markdown
        .replace('&', "&amp;")
        .replace("<m-agent-context>", "&amp;lt;m-agent-context>")
        .replace("</m-agent-context>", "&amp;lt;/m-agent-context>")
}
