//! Application plugin composition over the reusable registry-only presets.
use crate::EditorType;
use lexical_model::{EditorBuilder, EditorMode};

/// Build surface policy; imported-list controls belong to the attached synced body.
pub fn preset_builder_with_mode(ty: EditorType, mode: EditorMode) -> EditorBuilder {
    preset_builder_with_mode_and_tokens(ty, mode, crate::plugins_group_b::CodeTokens::none())
}

/// Preset with the session's host code tokenizer, installed exactly once.
pub fn preset_builder_with_mode_and_tokens(
    ty: EditorType,
    mode: EditorMode,
    tokens: crate::plugins_group_b::CodeTokens,
) -> EditorBuilder {
    let highlighting = mode == EditorMode::ViewAttached && tokens.is_active();
    let builder = crate::preset_builder_with_mode(ty, mode).extension_state(tokens);

    // Group B: structure, lists, tables, media, paste and links.
    let builder = crate::plugins_group_b::register(builder, ty);
    // Source installs code highlighting only with a view (codePlugin). Natively it stays dormant
    // until the code-highlighting activation installs a session tokenizer; until then a view-attached
    // surface writes no default language, reports nothing and leaves code-highlight leaves alone.
    let builder = if highlighting {
        crate::plugins_group_b::register_code_highlighting(builder, ty)
    } else {
        builder
    };
    // Source installs checklist controls after code; its parser has no live controls.
    let builder = if ty == EditorType::MarkdownSync && mode == EditorMode::ViewAttached {
        crate::plugins_group_b::register_checklist_controls(builder)
    } else {
        builder
    };

    // Group A: input shortcuts and native menu policy.
    let builder = crate::plugins_group_a::register(builder, ty);

    // Group C: AI-edit operations.
    crate::plugins_group_c::register(builder)
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
        // Group B application commands.
        crate::plugins_group_b::decode_command,
        // Group A source menu insertion policy.
        |name, json, generation, _event| {
            crate::plugins_group_a::decode_command(name, json, generation)
        },
        // Group C AI-edit operations.
        |name, json, generation, _event| {
            crate::plugins_group_c::decode_command(name, json, generation)
        },
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
        // Group B host requests.
        crate::plugins_group_b::event_payload,
        crate::plugins_group_a::menu::event_payload,
        crate::plugins_group_a::menu::search::event_payload,
        // Group C AI-edit refusals.
        crate::plugins_group_c::event_payload,
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
        // Group B bulk reads.
        crate::plugins_group_b::query,
        crate::plugins_group_a::menu::action_dependencies::query,
        // Group C AI-edit reads.
        crate::plugins_group_c::query,
    ];
    for query in queries {
        if let Some(reply) = query(name, data, generation, state)? {
            return Ok(Some(reply));
        }
    }
    Ok(None)
}

/// Read application controller caches without exposing mutable editor authority.
pub fn query_editor(
    name: &str,
    data: &serde_json::Value,
    generation: u32,
    editor: &lexical_model::Editor,
) -> crate::ModelResult<Option<serde_json::Value>> {
    if let Some(reply) =
        crate::plugins_group_a::menu::search::query(name, data, generation, editor)?
    {
        return Ok(Some(reply));
    }
    query(name, data, generation, editor.state())
}

/// Resolve browser-default policy through append-only migration group registration.
pub fn key_prevents_default(name: &str) -> bool {
    if name == "group-a.search-trigger" {
        return false;
    }
    let policies: &[fn(&str) -> Option<bool>] = &[crate::plugins_group_b::key_prevents_default];
    policies
        .iter()
        .find_map(|policy| policy(name))
        .unwrap_or(true)
}
