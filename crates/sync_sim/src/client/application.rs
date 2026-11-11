//! Application editor composition with explicit deterministic constructor capabilities.
use crate::Failure;
use document_session::{
    DocumentSession, EditorConfig, EditorSurface, SessionConfig, SurfaceConfig,
};
use lexical_model::*;
use macro_document_model::{NodeClock, NodeHost, NodeRandom};
use rand::{RngCore, SeedableRng};
use std::{
    ops::{Deref, DerefMut},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

pub(crate) struct EditorRuntime {
    session: DocumentSession<EditorSurface>,
    wall: Arc<AtomicU64>,
}
impl EditorRuntime {
    pub fn new(
        sync: doc_sync_core::SyncConfig,
        peers: Vec<u64>,
        range: doc_sync_core::PeerRange,
        now: doc_sync_core::Now,
        mode: EditorMode,
    ) -> Result<Self, Failure> {
        let wall = Arc::new(AtomicU64::new(clock_value(now)?));
        let clock = wall.clone();
        // Rebuilds retain the peer but must not restart a retired ID stream.
        let creation = AtomicU64::new(0);
        let id_length = (mode == EditorMode::ViewAttached).then_some(8);
        let session = DocumentSession::new(
            SessionConfig {
                sync,
                peer_ids: peers,
                peer_range: range,
                surface: SurfaceConfig::Editor(EditorConfig {
                    mode,
                    builder: Arc::new(move |mode, peer| {
                        builder(
                            mode,
                            peer,
                            clock.clone(),
                            creation.fetch_add(1, Ordering::Relaxed),
                            id_length,
                        )
                    }),
                    comment_node: |tx, ids| {
                        Ok(macro_document_model::nodes::create_comment_node(
                            tx,
                            ids,
                            Default::default(),
                            Some(false),
                        )?
                        .key())
                    },
                    policy: &macro_document_model::sync::MACRO_SYNC_POLICY,
                    local_commands: super::commands::LOCAL_COMMANDS,
                    ..EditorConfig::default()
                }),
            },
            now,
        )
        .map_err(|error| Failure::new("editor_configuration", error))?;
        Ok(Self { session, wall })
    }
    pub fn set_clock(&self, now: doc_sync_core::Now) -> Result<(), Failure> {
        self.wall.store(clock_value(now)?, Ordering::Relaxed);
        Ok(())
    }
}
impl Deref for EditorRuntime {
    type Target = DocumentSession<EditorSurface>;
    fn deref(&self) -> &Self::Target {
        &self.session
    }
}
impl DerefMut for EditorRuntime {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.session
    }
}
fn clock_value(now: doc_sync_core::Now) -> Result<u64, Failure> {
    u64::try_from(now.wall.0).map_err(|error| Failure::new("editor_constructor_clock", error))
}

pub(crate) fn builder(
    mode: EditorMode,
    peer: u64,
    wall: Arc<AtomicU64>,
    creation: u64,
    id_length: Option<usize>,
) -> EditorBuilder {
    let registry = match mode {
        EditorMode::Headless => macro_document_model::headless_builder(),
        EditorMode::ViewAttached => {
            macro_document_model::preset_builder(macro_document_model::EditorType::MarkdownSync)
        }
    };
    let mut seed = [0; 32];
    seed[..8].copy_from_slice(&peer.to_le_bytes());
    seed[9..17].copy_from_slice(&creation.to_le_bytes());
    seed[8] = 0x43;
    let entropy = Mutex::new(rand_chacha::ChaCha8Rng::from_seed(seed));
    let registry = registry
        .extension_state(NodeClock(Arc::new(move || wall.load(Ordering::Relaxed))))
        .extension_state(NodeRandom(Arc::new(move |length| {
            let mut bytes = vec![0; length];
            entropy
                .lock()
                .expect("single-threaded constructor entropy")
                .fill_bytes(&mut bytes);
            bytes
        })))
        .extension_state(NodeHost::default());
    let registry = lexical_rich_nodes::list::register_list(registry, Default::default());
    let registry =
        lexical_rich_nodes::table::register_table_behavior(registry, &Default::default());
    let registry = document_session::register_editor_commands(registry);
    static CLASSES: std::sync::LazyLock<Vec<&'static str>> = std::sync::LazyLock::new(|| {
        ["paragraph", "text", "linebreak", "tab"]
            .into_iter()
            .chain(macro_document_model::supported_node_types())
            .collect()
    });
    seed[8] = 0x49;
    let registry =
        macro_document_model::node_ids::NodeIdPlugin::register(registry, &CLASSES, id_length, seed);
    let registry = super::commands::register(registry).plugin(super::rich_commands::RichEdits);
    if mode == EditorMode::ViewAttached {
        registry.plugin(super::shortcuts::Shortcuts)
    } else {
        registry
    }
}
