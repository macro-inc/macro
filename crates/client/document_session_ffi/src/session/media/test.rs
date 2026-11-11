use super::*;
use crate::test::application::application_config;
use serde_json::json;

#[test]
fn decoded_image_size_is_local_under_read_and_comment_and_normalizes_only_under_edit() {
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
    session.handle(FfiNow { mono_ms: 2, wall_ms: 1_000_002 }, FfiInput::SetState { root: serde_json::from_value(json!({"type":"root","children":[{"type":"image","srcType":"url","url":"https://example.com/image.png","constrainedWidth":600,"constrainedHeight":500,"scale":0.5}]})).unwrap() }).unwrap();
    let FfiQueryReply::Nodes { keys, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "image".into(),
        })
        .unwrap()
    else {
        panic!("image key")
    };
    let key = keys[0];
    let lease = session.begin_decorator_view().unwrap();
    let batch = session.stage_decorators(lease, vec![key], vec![]).unwrap();
    assert!(
        session
            .normalize_image_size(
                FfiNow {
                    mono_ms: 3,
                    wall_ms: 1_000_003
                },
                lease,
                key,
                0,
                1200.0,
                800.0
            )
            .is_err()
    );
    session.finish_decorators(lease, batch.token, true).unwrap();
    for (time, can_comment) in [(4, false), (5, true)] {
        session
            .handle(
                FfiNow {
                    mono_ms: time,
                    wall_ms: 1_000_000 + time as i64,
                },
                FfiInput::Authorization {
                    state: AuthorizationState {
                        current: true,
                        can_write: false,
                        can_comment,
                    },
                },
            )
            .unwrap();
        let before = {
            let host = lock(&session.inner).unwrap();
            (
                host.session.surface().state().to_json().unwrap(),
                host.session.version(),
                host.last_mono,
                host.session.last_output().io.len(),
            )
        };
        let local = media_display_dimensions(1200.0, 800.0, Some(600.0), Some(500.0));
        assert_eq!((local.width, local.height), (600.0, 400.0));
        assert!(
            session
                .normalize_image_size(
                    FfiNow {
                        mono_ms: 50,
                        wall_ms: 1_000_050
                    },
                    lease,
                    key,
                    0,
                    1200.0,
                    800.0
                )
                .unwrap()
                .is_none()
        );
        assert!(
            session
                .resolve_image_url(
                    FfiNow {
                        mono_ms: 50,
                        wall_ms: 1_000_050
                    },
                    lease,
                    key,
                    0,
                    "https://storage.example.com/presigned".into()
                )
                .unwrap()
                .is_none()
        );
        let host = lock(&session.inner).unwrap();
        assert_eq!(
            (
                host.session.surface().state().to_json().unwrap(),
                host.session.version(),
                host.last_mono,
                host.session.last_output().io.len()
            ),
            before
        );
    }
    session
        .handle(
            FfiNow {
                mono_ms: 6,
                wall_ms: 1_000_006,
            },
            FfiInput::Authorization {
                state: AuthorizationState {
                    current: true,
                    can_write: true,
                    can_comment: true,
                },
            },
        )
        .unwrap();
    let output = session
        .normalize_image_size(
            FfiNow {
                mono_ms: 7,
                wall_ms: 1_000_007,
            },
            lease,
            key,
            0,
            1200.0,
            800.0,
        )
        .unwrap()
        .unwrap();
    assert!(
        output
            .view
            .iter()
            .all(|effect| !matches!(effect, FfiViewEffect::Error { .. }))
    );
    let FfiQueryReply::Nodes { nodes, .. } = session.query(FfiQuery::Node { key }).unwrap() else {
        panic!("image facts")
    };
    let node = &nodes[0];
    assert_eq!(node["width"], json!(1200));
    assert_eq!(node["height"], json!(800));
    assert_eq!(node["scale"], json!(0.5));
    assert_eq!(node["constrainedWidth"], json!(600));
    let bump = session
        .application_command(
            FfiNow {
                mono_ms: 8,
                wall_ms: 1_000_008,
            },
            "group-b.media-set-property".into(),
            json!({"key":key.index(),"kind":"image","property":"width","value":1200}),
            key.generation(),
            ViewSelection::KeepModel,
        )
        .unwrap();
    assert!(
        bump.view
            .iter()
            .all(|effect| !matches!(effect, FfiViewEffect::Error { .. }))
    );
    assert!(
        session
            .normalize_image_size(
                FfiNow {
                    mono_ms: 9,
                    wall_ms: 1_000_009
                },
                lease,
                key,
                0,
                640.0,
                480.0
            )
            .is_err()
    );
    let batch = session.stage_decorators(lease, vec![key], vec![]).unwrap();
    session.finish_decorators(lease, batch.token, true).unwrap();
    let output = session
        .image_edit(
            FfiNow {
                mono_ms: 9,
                wall_ms: 1_000_009,
            },
            lease,
            key,
            1,
            FfiImageEdit::Scale { value: 0.75 },
        )
        .unwrap();
    assert!(
        output
            .view
            .iter()
            .all(|effect| !matches!(effect, FfiViewEffect::Error { .. }))
    );
    let FfiQueryReply::Nodes { nodes, .. } = session.query(FfiQuery::Node { key }).unwrap() else {
        panic!("image facts")
    };
    let node = &nodes[0];
    assert_eq!(node["scale"], json!(0.75));
    let replacement = session.begin_decorator_view().unwrap();
    assert!(!session.retire_decorator_view(lease).unwrap());
    assert!(
        session
            .image_edit(
                FfiNow {
                    mono_ms: 10,
                    wall_ms: 1_000_010
                },
                lease,
                key,
                1,
                FfiImageEdit::Delete
            )
            .is_err()
    );
    assert!(session.retire_decorator_view(replacement).unwrap());
}
