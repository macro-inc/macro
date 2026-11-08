//! Application plugin composition over the reusable registry-only presets.
use crate::EditorType;
use lexical_model::{EditorBuilder, EditorMode};

/// Build a live surface or its headless permission fork with the same policy.
pub fn preset_builder_with_mode(ty: EditorType, mode: EditorMode) -> EditorBuilder {
    let builder = crate::preset_builder_with_mode(ty, mode);

    // WP-58 Group B: structure, lists, tables, media, paste and links.
    let builder = crate::plugins_group_b::register(builder, ty);

    builder
}
