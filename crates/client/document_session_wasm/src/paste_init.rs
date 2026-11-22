//! Cold paste preparation runs once during the host's boot idle work.
use macro_document_model::links::{find_auto_link_matches, AutoLinkMode};
use std::sync::OnceLock;
use wasm_bindgen::prelude::*;

static PREPARED: OnceLock<()> = OnceLock::new();

/// Prepare the MarkdownSync linkifier before editors accept their first paste.
/// The host schedules this after paint while preparing the shared editor engine.
#[wasm_bindgen(js_name = prepareMacroPaste)]
pub fn prepare_macro_paste() -> Result<(), JsError> {
    if PREPARED.get().is_some() {
        return Ok(());
    }
    #[cfg(target_arch = "wasm32")]
    {
        // Grow through the allocator so the reserved pages remain usable by
        // dlmalloc. A raw memory.grow would bypass its arena bookkeeping.
        let mut reserve = Vec::<u8>::new();
        reserve
            .try_reserve_exact(16 * 1024 * 1024)
            .map_err(|_| JsError::new("unable to reserve editor paste heap"))?;
        std::hint::black_box(reserve.as_mut_ptr());
        drop(reserve);
    }
    let _ = find_auto_link_matches("", AutoLinkMode::CommonTlds);
    let _ = PREPARED.set(());
    Ok(())
}
