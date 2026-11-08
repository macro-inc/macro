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

/// Decode application command names through the registered migration groups.
/// The WASM adapter retains envelope and generation validation.
pub fn decode_command(
    name: &str,
    json: &str,
    generation: u32,
    event: Option<&lexical_model::KeyEvent>,
) -> crate::ModelResult<Option<lexical_model::Command>> {
    type Decoder = fn(
        &str,
        &str,
        u32,
        Option<&lexical_model::KeyEvent>,
    ) -> crate::ModelResult<Option<lexical_model::Command>>;
    let decoders: &[Decoder] = &[
        // WP-58 Group B application commands.
        crate::plugins_group_b::decode_command,
    ];
    for decode in decoders {
        if let Some(command) = decode(name, json, generation, event)? {
            return Ok(Some(command));
        }
    }
    Ok(None)
}
