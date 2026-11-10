use super::*;

#[test]
fn actual_browser_history_packet_orders_the_clear_and_focused_restore() -> Result<(), BoundaryError>
{
    for focused in [true, false] {
        let config = wire::SessionConfigMsg {
            doc: "history-awareness".into(),
            session: "00000000-0000-0000-0000-000000000001".into(),
            user: "fixture-user".into(),
            peers: vec![71, 72, 73],
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
                snapshot: lexical_loro::golden::MARKDOWN_GOLDEN.to_vec(),
            },
            1.0,
            None,
        )?;
        machine.editor(
            Input::SetState {
                state: serde_json::from_value(
                    serde_json::json!({"root":{"type":"root","children":[
                        {"type":"paragraph","children":[{"type":"text","text":"abc"}]}
                    ]}}),
                )?,
                tags: TagSet::default(),
            },
            2.0,
        )?;
        machine.editor(
            Input::Command {
                command: Command::ClearHistory,
                selection: ViewSelection::KeepModel,
            },
            3.0,
        )?;
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor");
        };
        let text = session
            .surface()
            .state()
            .view()
            .all_text_nodes(NodeKey::ROOT)
            .next()
            .expect("text");
        let point = Point::text(text, Utf16Offset(2));
        machine.editor(
            Input::Command {
                command: Command::InsertText("X".into()),
                selection: ViewSelection::Range {
                    anchor: point,
                    focus: point,
                    resolution_dirty: false,
                },
            },
            500.0,
        )?;
        machine.call(SessionInput::Focus(focused), 501.0, None)?;
        machine.editor(Input::Undo, 502.0)?;

        let packet = &machine.output;
        let u32_at = |at| u32::from_le_bytes(packet[at..at + 4].try_into().expect("word"));
        let mut offset = (24 + u32_at(12) as usize * 4 + u32_at(16) as usize + 3) & !3;
        let mut observations = Vec::new();
        for _ in 0..u32_at(20) {
            let start = offset + 16;
            let end = start + u32_at(offset + 12) as usize;
            if u32_at(offset) == 16 {
                let effect = wire::ViewEffectMsg::deserialize(&packet[start..end])?;
                if effect.kind == 11 || (effect.kind == 6 && effect.code == 0) {
                    observations.push(effect);
                }
            }
            offset = (end + 3) & !3;
        }
        assert_eq!(observations.len(), 4);
        let [content, clear, awareness, restore] = observations.as_slice() else {
            unreachable!("four ordered effects");
        };
        assert_eq!(content.kind, 11);
        assert!(content.keys.iter().any(|tag| tag == "skip-dom-selection"));
        assert_eq!(
            (clear.kind, clear.code, clear.selection.kind, clear.flag),
            (6, 0, 1, false)
        );
        assert_eq!(awareness.kind, 11);
        assert!(awareness.keys.iter().any(|tag| tag == "collab-selection"));
        assert_eq!(
            awareness.keys.iter().any(|tag| tag == "skip-dom-selection"),
            !focused
        );
        assert_eq!(
            (
                restore.kind,
                restore.code,
                restore.selection.kind,
                restore.flag
            ),
            (6, 0, 2, focused)
        );
        assert_eq!({ restore.selection.anchor.key }, text.index());
        assert_eq!({ restore.selection.anchor.offset }, 2);
        assert_eq!({ restore.selection.focus.offset }, 2);
    }
    Ok(())
}
