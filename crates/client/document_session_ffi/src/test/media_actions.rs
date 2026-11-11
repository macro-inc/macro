use super::application::application_config;
use crate::*;
use serde_json::json;

#[test]
fn native_media_resize_uses_shared_class_guard_and_current_session_authority() {
    let session = NativeEditorSession::new(
        application_config(),
        None,
        FfiNow {
            mono_ms: 0,
            wall_ms: 1_000_000,
        },
    )
    .unwrap();
    session
        .handle(
            FfiNow {
                mono_ms: 0,
                wall_ms: 1_000_000,
            },
            FfiInput::Start,
        )
        .unwrap();
    session
        .handle(
            FfiNow {
                mono_ms: 1,
                wall_ms: 1_000_001,
            },
            FfiInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
        )
        .unwrap();
    session.handle(FfiNow { mono_ms: 2, wall_ms: 1_000_002 }, FfiInput::SetState {
        root: serde_json::from_value(json!({"type":"root","children":[{"type":"image","srcType":"url","url":"https://example.com/image.png","width":100,"height":50}]})).unwrap(),
    }).unwrap();
    let FfiQueryReply::Nodes { keys, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "image".into(),
        })
        .unwrap()
    else {
        panic!("image")
    };
    let key = keys[0];
    for (time, kind, access, expected) in [
        (3, "video", Access::Edit, (100.0, 50.0)),
        (5, "image", Access::Read, (100.0, 50.0)),
        (7, "image", Access::Edit, (640.0, 480.0)),
    ] {
        session
            .handle(
                FfiNow {
                    mono_ms: time,
                    wall_ms: 1_000_000 + time as i64,
                },
                FfiInput::Authorization {
                    state: AuthorizationState {
                        current: true,
                        can_write: access == Access::Edit,
                        can_comment: access == Access::Edit,
                    },
                },
            )
            .unwrap();
        assert_eq!(session.effective_access().unwrap(), access);
        let before = session.query(FfiQuery::State).unwrap();
        let output = session
            .application_command(
                FfiNow {
                    mono_ms: time + 1,
                    wall_ms: 1_000_001 + time as i64,
                },
                "group-b.media-resize".into(),
                json!({"key":key.index(),"kind":kind,"width":640,"height":480}),
                key.generation(),
                ViewSelection::KeepModel,
            )
            .unwrap();
        let FfiQueryReply::Decorators { nodes } = session
            .query(FfiQuery::Decorators { keys: vec![key] })
            .unwrap()
        else {
            panic!("decorators")
        };
        let media = nodes[0].media.as_ref().unwrap();
        assert_eq!((media.width, media.height), expected);
        if access == Access::Read {
            assert!(output.view.iter().any(|effect| matches!(effect, FfiViewEffect::Error { message } if message == "document is read-only")));
            let FfiQueryReply::State { root: old } = before else {
                panic!("before")
            };
            let FfiQueryReply::State { root: current } = session.query(FfiQuery::State).unwrap()
            else {
                panic!("current")
            };
            assert_eq!(current, old);
        } else {
            assert!(
                !output
                    .view
                    .iter()
                    .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
            );
        }
    }
}
