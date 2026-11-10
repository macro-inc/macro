use super::application::application_config;
use crate::*;
use serde_json::json;

#[test]
fn effective_access_tracks_authorization_without_granting_later_editor_admission() {
    let now = FfiNow {
        mono_ms: 0,
        wall_ms: 1_000_000,
    };
    let editor = NativeEditorSession::new(application_config(), None, now.clone()).unwrap();
    let mut generic_config = application_config();
    generic_config.application = None;
    let generic = NativeDocSession::new(generic_config, None, now.clone()).unwrap();
    assert_eq!(editor.effective_access().unwrap(), Access::Edit);
    assert_eq!(generic.effective_access().unwrap(), Access::Edit);
    editor.handle(now.clone(), FfiInput::Start).unwrap();
    generic.handle(now, FfiInput::Start).unwrap();
    let now = FfiNow {
        mono_ms: 1,
        wall_ms: 1_000_001,
    };
    editor
        .handle(
            now.clone(),
            FfiInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
        )
        .unwrap();
    generic
        .handle(
            now.clone(),
            FfiInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
        )
        .unwrap();
    editor.handle(FfiNow { mono_ms: 2, wall_ms: 1_000_002 }, FfiInput::SetState {
        root: serde_json::from_value(json!({"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"original"}]}]})).unwrap(),
    }).unwrap();
    let initial = editor.query(FfiQuery::State).unwrap();
    let FfiQueryReply::Nodes { keys, .. } = editor
        .query(FfiQuery::NodesOfType {
            name: "text".into(),
        })
        .unwrap()
    else {
        panic!("text")
    };
    let key = keys[0];
    for (step, can_write, can_comment, expected) in [
        (3, false, true, Access::CommentOnly),
        (5, false, false, Access::Read),
        (7, true, true, Access::Edit),
    ] {
        let now = FfiNow {
            mono_ms: step,
            wall_ms: 1_000_000 + step as i64,
        };
        let state = AuthorizationState {
            current: true,
            can_write,
            can_comment,
        };
        editor
            .handle(now.clone(), FfiInput::Authorization { state })
            .unwrap();
        generic
            .handle(now, FfiInput::Authorization { state })
            .unwrap();
        assert_eq!(editor.effective_access().unwrap(), expected);
        assert_eq!(generic.effective_access().unwrap(), expected);
        assert_eq!(editor.effective_access().unwrap(), expected);
        let output = editor
            .handle(
                FfiNow {
                    mono_ms: step + 1,
                    wall_ms: 1_000_001 + step as i64,
                },
                FfiInput::Command {
                    command: FfiCommand::InsertText { text: "!".into() },
                    selection: ViewSelection::Range {
                        anchor: Point::text(key, Utf16Offset(8)),
                        focus: Point::text(key, Utf16Offset(8)),
                        resolution_dirty: false,
                    },
                },
            )
            .unwrap();
        if expected != Access::Edit {
            assert!(output.view.iter().any(|effect| matches!(effect, FfiViewEffect::Error { message } if message == "document is read-only")));
            let FfiQueryReply::State { root } = editor.query(FfiQuery::State).unwrap() else {
                panic!("state")
            };
            let FfiQueryReply::State { root: original } = &initial else {
                panic!("initial")
            };
            assert_eq!(&root, original);
            assert!(output.io.is_empty());
        } else {
            assert!(
                !output
                    .view
                    .iter()
                    .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
            );
            assert_eq!(editor.text_content().unwrap(), "original!");
        }
    }
}
