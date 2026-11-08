//! Application registry composition; clocks and entropy enter through session inputs.
use document_session::{with_session_plugins, EditorConfig};
use macro_document_model::{NodeClock, NodeHost, NodeRandom};
use rand_chacha::{
    rand_core::{RngCore, SeedableRng},
    ChaCha20Rng,
};
use std::sync::{
    atomic::{AtomicI64, Ordering},
    Arc, Mutex,
};

pub(crate) fn config(mut config: EditorConfig, clock: Arc<AtomicI64>) -> EditorConfig {
    config.policy = &macro_document_model::sync::MACRO_SYNC_POLICY;
    // Rebuilds and cold repaint editors must not restart a live peer's ID stream.
    let streams = Mutex::new(std::collections::BTreeMap::new());
    config.builder = Arc::new(move |mode, peer| {
        let random = streams
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
        let builder = macro_document_model::preset_builder_with_mode(
            macro_document_model::EditorType::MarkdownSync,
            mode,
        )
        .extension_state(NodeClock(Arc::new(move || {
            u64::try_from(clock.load(Ordering::Relaxed)).unwrap_or(0)
        })))
        .extension_state(NodeRandom(Arc::new(move |length| {
            let mut bytes = vec![0; length];
            random
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .fill_bytes(&mut bytes);
            bytes
        })))
        .extension_state(NodeHost::default());
        with_session_plugins(builder, peer)
    });
    config
}

#[cfg(test)]
mod tests {
    use super::*;
    use lexical_model::*;
    use macro_document_model::nodes::{create_await_node, AwaitNode};

    #[test]
    fn same_peer_rebuild_keeps_constructor_entropy_and_observes_current_clock() {
        let clock = Arc::new(AtomicI64::new(1000));
        let config = config(EditorConfig::default(), clock.clone());
        let mut editor = (config.builder)(EditorMode::ViewAttached, 7)
            .build()
            .unwrap();
        let (first, _) = editor
            .update(|tx| {
                let p = tx.create(Paragraph::default())?;
                let node = create_await_node(tx, None, None, true)?;
                tx.append(p, &[node.key()])?;
                tx.append(NodeKey::ROOT, &[p.key()])?;
                Ok(tx.get_or_err::<AwaitNode>(node)?.await_id.clone())
            })
            .unwrap();
        let persisted = editor.state().to_json().unwrap();
        clock.store(2000, Ordering::Relaxed);
        let mut rebuilt = (config.builder)(EditorMode::ViewAttached, 7)
            .initial_state(persisted)
            .build()
            .unwrap();
        let (next, _) = rebuilt
            .update(|tx| {
                assert_eq!(macro_document_model::now_ms(tx)?, 2000);
                let node = create_await_node(tx, None, None, true)?;
                let p = tx.children_keys(NodeKey::ROOT)?[0];
                tx.append(p, &[node.key()])?;
                Ok(tx.get_or_err::<AwaitNode>(node)?.await_id.clone())
            })
            .unwrap();
        assert_ne!(first, next);
    }
}
