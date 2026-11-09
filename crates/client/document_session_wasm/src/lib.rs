//! Portable document sessions exposed through a versioned Bebop and flat-diff ABI.
#![deny(missing_docs)]
#[rustfmt::skip]
#[expect(missing_docs, reason = "Bebop owns generated wire declarations")]
pub mod generated;
#[rustfmt::skip]
#[expect(missing_docs, reason = "Bebop owns generated foreign host declarations")]
pub mod foreign_host_generated;
mod application_exports;
mod codec;
mod document;
mod editor;
mod editor_input;
mod generic;
mod machine;
mod macro_editor;
mod output;
mod query;
mod router;
mod storage;
mod telemetry;
use bebop::Record;
pub use document::DocSession;
pub use editor::EditorSession;
use generated::owned as wire;
pub use router::SyncRouter;
use wasm_bindgen::prelude::*;
const _: () = assert!(lexical_model::DIFF_FORMAT_VERSION == generated::DIFF_FORMAT_VERSION);
#[derive(Debug, thiserror::Error)]
enum BoundaryError {
    #[error("AbiMismatch")]
    AbiMismatch,
    #[error("invalid boundary value: {0}")]
    Invalid(&'static str),
    #[error(transparent)]
    Session(#[from] document_session::SessionError),
    #[error(transparent)]
    Markdown(#[from] lexical_markdown::Error),
    #[error(transparent)]
    Macro(#[from] macro_document_model::Error),
    #[error(transparent)]
    Html(#[from] lexical_html::Error),
    #[error(transparent)]
    Model(#[from] lexical_model::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Decode(#[from] bebop::DeserializeError),
    #[error(transparent)]
    Encode(#[from] bebop::SerializeError),
}
fn js(error: BoundaryError) -> JsError {
    JsError::new(&error.to_string())
}
fn bytes<'a, T: Record<'a>>(value: &T) -> Result<Vec<u8>, BoundaryError> {
    let mut out = vec![];
    value.serialize(&mut out)?;
    Ok(out)
}
#[cfg(test)]
mod test;
