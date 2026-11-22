//! Application registry composition; clocks and entropy enter through session inputs.
use crate::{EditorConfig, with_session_plugins_excluding_root};
use lexical_model::{Error, NodeKey, NodeType, SerializedNode, StateRef};
use macro_document_model::{
    NodeClock, NodeHost, NodeRandom,
    nodes::AwaitNode,
    peer::{PeerIdPlugin, PeerIdState},
};
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
    config: EditorConfig,
    clock: Arc<AtomicI64>,
    editor_type: macro_document_model::EditorType,
) -> EditorConfig {
    application_editor_config_with_tokens(
        config,
        clock,
        editor_type,
        macro_document_model::plugins_group_b::CodeTokens::none(),
    )
}

/// Same composition with the session's host code tokenizer, installed once per built editor.
pub fn application_editor_config_with_tokens(
    mut config: EditorConfig,
    clock: Arc<AtomicI64>,
    editor_type: macro_document_model::EditorType,
    tokens: macro_document_model::plugins_group_b::CodeTokens,
) -> EditorConfig {
    if editor_type == macro_document_model::EditorType::MarkdownSync {
        config.namespace = "block-md-main".into();
        config.max_document_version = Some(macro_document_model::plugins_group_b::DOCUMENT_VERSION);
        config.diff.selected_state = Some(await_view_state);
        config.browser_history_awareness = config.mode == lexical_model::EditorMode::ViewAttached
            && config.view_host.engine != lexical_model::ViewEngine::Native;
    }
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
        let builder = macro_document_model::surface::preset_builder_with_mode_and_tokens(
            editor_type,
            mode,
            tokens.clone(),
        )
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
        let builder = if editor_type == macro_document_model::EditorType::MarkdownSync {
            PeerIdPlugin::register(
                builder,
                &[AwaitNode::TYPE],
                PeerIdState {
                    peer_id: Some(peer.to_string()),
                },
            )
        } else {
            builder
        };
        // Source wrapper nodeIdPlugin idLength (LexicalWrapperContext.tsx).
        with_session_plugins_excluding_root(
            builder,
            peer,
            &macro_document_model::node_ids::ID_STATE,
            8,
        )
    });
    config
}

// Await imports omit local; the initial Created hook derives it for this peer.
// Only the resulting local bit belongs in the native view, never all NodeState.
fn await_view_state(view: StateRef<'_>, key: NodeKey) -> Result<Option<SerializedNode>, Error> {
    if !view.is::<AwaitNode>(key) {
        return Ok(None);
    }
    Ok(macro_document_model::peer::get_local(view, key)?
        .map(|local| SerializedNode::from_iter([("local".into(), serde_json::Value::Bool(local))])))
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

impl crate::EditorSurface {
    /// Read an application snapshot or its committed mutation-controller cache.
    pub fn application_query(
        &self,
        name: &str,
        data: &serde_json::Value,
        generation: u32,
    ) -> Result<Option<serde_json::Value>, lexical_model::Error> {
        macro_document_model::surface::query_editor(name, data, generation, self.core.editor())
    }
}

#[cfg(test)]
mod await_ownership_test;
mod checklist;

/// Copy Database authority from only the admitted command's own main transaction.
/// Model admission and output/error processing retain their existing policy.
impl crate::DocumentSession<crate::EditorSurface> {
    /// Observe id-only publication and its separately typed Database result.
    pub fn handle_editor_with_database_commit(
        &mut self,
        now: crate::Now,
        input: lexical_model::Input,
        main_commit: &mut lexical_model::MainCommitOutcome,
        database_result: &mut Option<
            macro_document_model::plugins_group_b::DatabaseMainCommitResult,
        >,
    ) -> &crate::SessionOutput {
        *database_result = None;
        let mut capture = macro_document_model::plugins_group_b::DatabaseCommitCapture::new(&input);
        let output =
            self.handle_editor_with_main_commit_receipts(now, input, main_commit, &mut capture);
        *database_result = capture.into_result();
        output
    }
}
