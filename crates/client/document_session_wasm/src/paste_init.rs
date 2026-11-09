//! Cold paste preparation runs once during the host's boot idle work.
use macro_document_model::links::{find_auto_link_matches, AutoLinkMode};
use wasm_bindgen::prelude::*;

/// Prepare the MarkdownSync linkifier before editors accept their first paste.
/// The host schedules this after paint while preparing the shared editor engine.
#[wasm_bindgen(js_name = prepareMacroPaste)]
pub fn prepare_macro_paste() {
    let _ = find_auto_link_matches("", AutoLinkMode::CommonTlds);
}
