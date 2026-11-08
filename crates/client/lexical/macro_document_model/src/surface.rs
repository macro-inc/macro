//! Application plugin composition over the reusable registry-only presets.
use crate::EditorType;
use lexical_model::{EditorBuilder, EditorMode};

/// Build a live surface or its headless permission fork with the same policy.
pub fn preset_builder_with_mode(ty: EditorType, mode: EditorMode) -> EditorBuilder {
    let builder = crate::preset_builder_with_mode(ty, mode);

    // WP-58 Group B: structure, lists, tables, media, paste and links.
    crate::plugins_group_b::register(builder, ty)
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

/// Encode application host-event payloads through append-only group registration.
pub fn event_payload(
    event: &lexical_model::PluginEvent,
) -> crate::ModelResult<Option<serde_json::Value>> {
    type Encoder = fn(&lexical_model::PluginEvent) -> crate::ModelResult<Option<serde_json::Value>>;
    let encoders: &[Encoder] = &[
        // WP-58 Group B host requests.
        crate::plugins_group_b::event_payload,
    ];
    for encode in encoders {
        if let Some(payload) = encode(event)? {
            return Ok(Some(payload));
        }
    }
    Ok(None)
}

/// Dispatch application bulk queries through append-only migration groups.
pub fn query(
    name: &str,
    data: &serde_json::Value,
    generation: u32,
    state: &lexical_model::EditorState,
) -> crate::ModelResult<Option<serde_json::Value>> {
    type Query = fn(
        &str,
        &serde_json::Value,
        u32,
        &lexical_model::EditorState,
    ) -> crate::ModelResult<Option<serde_json::Value>>;
    let queries: &[Query] = &[
        // WP-58 Group B bulk reads.
        crate::plugins_group_b::query,
    ];
    for query in queries {
        if let Some(reply) = query(name, data, generation, state)? {
            return Ok(Some(reply));
        }
    }
    Ok(None)
}
