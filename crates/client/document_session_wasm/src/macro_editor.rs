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
        let builder = macro_document_model::surface::preset_builder_with_mode(
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
    #[test]
    fn production_macro_factory_turns_typed_heading_marker_into_an_h1(
    ) -> Result<(), crate::BoundaryError> {
        use crate::{bytes, generated, machine, wire};
        use doc_sync_core::*;
        use document_session::*;
        let config = wire::SessionConfigMsg {
            doc: "macro-shortcuts-session".into(),
            session: "00000000-0000-0000-0000-000000000001".into(),
            user: "fixture-user".into(),
            peers: vec![7, 8, 9],
            access: wire::Access::Edit,
            transport: wire::Transport::None,
            durable: false,
            chatter: false,
            headless: false,
            view_engine: 1,
            view_os: 0,
            token: String::new(),
            traceparent: String::new(),
            coalesce: 25,
            snapshot_interval: 0,
            observed: vec![],
        };
        let mut machine =
            machine::Machine::create_macro(generated::ABI_MAJOR, &bytes(&config)?, 0.0, 0.0)?;
        machine.sync(SyncInput::Start, 0.0, None)?;
        machine.sync(
            SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
            1.0,
            None,
        )?;
        machine.editor(Input::SetState {
            state: serde_json::from_value(serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[]}]}}))?,
            tags: TagSet::default(),
        }, 1.5)?;
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor");
        };
        assert!(session.surface().registry().get("custom-code").is_some());
        assert!(session.surface().registry().get("user-mention").is_some());
        let paragraph = session
            .surface()
            .state()
            .view()
            .first_child(NodeKey::ROOT)
            .expect("initial paragraph");
        let mut selection = ViewSelection::Range {
            anchor: Point::element(paragraph, ChildIndex(0)),
            focus: Point::element(paragraph, ChildIndex(0)),
            resolution_dirty: false,
        };
        for (index, ch) in "# a".chars().enumerate() {
            machine.editor(
                Input::Command {
                    command: Command::InsertText(ch.to_string()),
                    selection,
                },
                index as f64 + 2.0,
            )?;
            selection = ViewSelection::KeepModel;
        }
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor");
        };
        let state = session.surface().state();
        let first = state.view().first_child(NodeKey::ROOT).expect("heading");
        let heading = state
            .view()
            .get::<lexical_rich_nodes::heading::HeadingNode>(first)
            .expect("h1 node");
        assert_eq!(heading.tag, lexical_rich_nodes::heading::HeadingTagType::H1);
        assert_eq!(state.view().text_content(first), "a");
        assert!(!session
            .last_output()
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_))));
        Ok(())
    }
}
