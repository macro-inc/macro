use super::*;

#[test]
fn markdown_pastes_use_package_importers_in_tab_and_headless_sessions() {
    for worker in [false, true] {
        for snippet in 0..3 {
            let mut writer = OpenSpec::form("writer", "one");
            if worker {
                writer.kind = ClientKind::AiWorker;
            }
            let outcome = verify(
                SimConfig::editor(787 + u64::from(snippet)),
                &[
                    Step::Open(writer),
                    Step::Open(OpenSpec::form("reader", "two")),
                    Step::Settle,
                    Step::Edit {
                        client: ClientName("writer".into()),
                        op: AbstractOp::Editor(EditorOp::PasteMarkdown {
                            at: Pos::default(),
                            snippet,
                        }),
                    },
                    Step::Settle,
                ],
            );
            assert!(outcome.events.iter().any(|event| matches!(&event.fact,
                Fact::LocalOp { op: AbstractOp::Editor(EditorOp::PasteMarkdown { .. }), spans, .. } if !spans.is_empty())));
            let state = &outcome.finals.clients[&ClientName("reader".into())]
                .editor
                .as_ref()
                .unwrap()
                .synced_json;
            let serialized = state.to_string();
            assert!(serialized.contains(match snippet {
                0 => "Pasted heading",
                1 => "first",
                _ => "inline code",
            }));
        }
    }
}

#[test]
fn large_markdown_paste_emits_real_fragmented_updates_and_survives_hibernation() {
    assert!(sync_sim::markdown_snippet(3).len() > 1_000_000);
    let mut config = SimConfig::editor(797);
    config.net.latency = (Millis(1), Millis(1));
    config.storage.latency = (Millis(1), Millis(1));
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("writer", "one")),
            Step::Open(OpenSpec::form("reader", "two")),
            Step::Settle,
            Step::Edit {
                client: ClientName("writer".into()),
                op: AbstractOp::Editor(EditorOp::PasteMarkdown {
                    at: Pos::default(),
                    snippet: 3,
                }),
            },
            Step::Run(Millis(45)),
            Step::Server(ServerStep::Hibernate),
            Step::Settle,
        ],
    );
    assert!(
        outcome.stats.multi_frame_messages > 0,
        "actual fragmented transport, not input size"
    );
    assert!(outcome.events.iter().any(|event| matches!(&event.fact,
        Fact::PushSent { rows, own_bytes, .. } if rows.len() == 1 && *own_bytes > 900_000)));
    let payload = sync_sim::markdown_snippet(3)
        .strip_prefix("```text\n")
        .unwrap()
        .strip_suffix("\n```\n")
        .unwrap();
    let reader = outcome.finals.clients[&ClientName("reader".into())]
        .editor
        .as_ref()
        .unwrap();
    assert!(
        reader.synced_json.to_string().contains(payload),
        "complete code payload survives"
    );
    let hibernate = outcome
        .events
        .iter()
        .position(
            |event| matches!(&event.fact, Fact::Server { operation } if operation == "Hibernate"),
        )
        .unwrap();
    let fragmented = |event: &&Event| {
        matches!(&event.fact, Fact::Frame {
        direction: Direction::ToServer, kind: FrameKind::Update, fate, frames, ..
    } if fate == "Delivered" && *frames > 1)
    };
    assert_eq!(
        outcome.events[..hibernate]
            .iter()
            .filter(fragmented)
            .count(),
        1
    );
    assert!(
        outcome.events[hibernate..]
            .iter()
            .any(|event| fragmented(&event))
    );
}
