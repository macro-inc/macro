//! Application registry composition; clocks and entropy enter through session inputs.
use crate::{EditorConfig, with_session_plugins_with_id_state};
use macro_document_model::{NodeClock, NodeHost, NodeRandom};
use rand_chacha::{
    ChaCha20Rng,
    rand_core::{RngCore, SeedableRng},
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicI64, Ordering},
};

/// Compose the application registry, synchronization policy and constructor inputs.
/// The supplied wall clock is refreshed by the host before every admission; peer
/// entropy streams continue across cold repaints and same-peer rebuilds.
pub fn application_editor_config(
    mut config: EditorConfig,
    clock: Arc<AtomicI64>,
    editor_type: macro_document_model::EditorType,
) -> EditorConfig {
    config.policy = &macro_document_model::sync::MACRO_SYNC_POLICY;
    config.comment_node = |tx, ids| {
        Ok(macro_document_model::nodes::create_comment_node(
            tx,
            ids,
            Default::default(),
            Some(false),
        )?
        .key())
    };
    // Rebuilds and cold repaint editors must not restart a live peer's ID stream.
    let streams = Mutex::new(std::collections::BTreeMap::new());
    config.builder = Arc::new(move |mode, peer| {
        let entropy = streams
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .entry(peer)
            .or_insert_with(|| {
                let mut seed = [0; 32];
                for chunk in seed.chunks_exact_mut(8) {
                    chunk.copy_from_slice(&peer.to_le_bytes());
                }
                Arc::new(Mutex::new(ChaCha20Rng::from_seed(seed)))
            })
            .clone();
        let clock = clock.clone();
        let builder = macro_document_model::surface::preset_builder_with_mode(editor_type, mode)
            .extension_state(NodeClock(Arc::new(move || {
                u64::try_from(clock.load(Ordering::Relaxed)).unwrap_or(0)
            })))
            .extension_state(NodeRandom(Arc::new(move |length| {
                let mut bytes = vec![0; length];
                entropy
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner())
                    .fill_bytes(&mut bytes);
                bytes
            })))
            .extension_state(NodeHost::default());
        with_session_plugins_with_id_state(builder, peer, &macro_document_model::node_ids::ID_STATE)
    });
    config
}

/// Export application Markdown with the same transformer catalog on every host.
pub fn export_application_markdown(
    state: &lexical_model::EditorState,
    external: bool,
    selected: bool,
    hostname: Option<&str>,
) -> Result<String, crate::QueryError> {
    let callbacks = macro_document_model::transformers::transformers(
        if external { "external" } else { "internal" },
        &macro_document_model::transformers::MacroMarkdownOptions {
            app_hostname: hostname.map(Into::into),
        },
    )?;
    let options = lexical_markdown::MarkdownOptions {
        list_indent: 2,
        ..Default::default()
    };
    if selected {
        Ok(lexical_markdown::convert_selection_to_markdown_string(
            state,
            &callbacks,
            state.selection(),
            &options,
        )?)
    } else {
        Ok(lexical_markdown::convert_to_markdown_string(
            state, &callbacks, None, &options,
        )?)
    }
}

/// Export application HTML for explicit model endpoints through the shared registry.
pub fn export_application_html_for_selection(
    state: &lexical_model::EditorState,
    selection: Option<&lexical_model::Selection>,
) -> Result<String, crate::QueryError> {
    Ok(lexical_html::HtmlExporter::new(
        macro_document_model::html::macro_export_registry(),
        lexical_html::EditorTheme::default(),
    )
    .generate_html_from_nodes(state, selection)?)
}
