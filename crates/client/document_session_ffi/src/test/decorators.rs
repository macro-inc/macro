use super::application::application_config;
use crate::*;
use serde_json::json;

#[test]
fn read_only_media_measurements_reuse_shared_constraints_without_document_writes() {
    let session = NativeEditorSession::new(
        application_config(),
        None,
        FfiNow {
            mono_ms: 0,
            wall_ms: 1_000_000,
        },
    )
    .unwrap();
    for (step, input) in [
        FfiInput::Start,
        FfiInput::Seed { kind: SeedKind::Optimistic, snapshot: vec![] },
        FfiInput::SetState { root: serde_json::from_value(json!({"type":"root","children":[
            {"type":"image","srcType":"url","url":"https://example.com/image.png","constrainedWidth":600,"constrainedHeight":500,"scale":0.5},
            {"type":"video","srcType":"url","url":"https://example.com/video.mp4","constrainedWidth":1000,"constrainedHeight":300,"scale":2},
            {"type":"paragraph","children":[{"type":"equation","equation":"x^2","inline":true}]}
        ]})).unwrap() },
        FfiInput::Authorization { state: AuthorizationState { current: true, can_write: false, can_comment: false } },
    ].into_iter().enumerate() {
        let output = session.handle(FfiNow { mono_ms: step as u64, wall_ms: 1_000_000 + step as i64 }, input).unwrap();
        assert!(!output.view.iter().any(|effect| matches!(effect, FfiViewEffect::Error { .. })));
    }
    let FfiQueryReply::Nodes { keys: images, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "image".into(),
        })
        .unwrap()
    else {
        panic!("images")
    };
    let FfiQueryReply::Nodes { keys: videos, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "video".into(),
        })
        .unwrap()
    else {
        panic!("videos")
    };
    let FfiQueryReply::Nodes {
        keys: equations, ..
    } = session
        .query(FfiQuery::NodesOfType {
            name: "equation".into(),
        })
        .unwrap()
    else {
        panic!("equations")
    };
    let FfiQueryReply::State { root: before } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    let FfiQueryReply::Decorators { nodes } = session
        .query(FfiQuery::MediaLayouts {
            measurements: vec![
                FfiMediaMeasurement {
                    key: videos[0],
                    width: 800.0,
                    height: 600.0,
                },
                FfiMediaMeasurement {
                    key: images[0],
                    width: 1200.0,
                    height: 800.0,
                },
            ],
        })
        .unwrap()
    else {
        panic!("layouts")
    };
    assert_eq!(
        nodes.iter().map(|node| node.key).collect::<Vec<_>>(),
        vec![videos[0], images[0]]
    );
    let video = nodes[0].media.as_ref().unwrap();
    assert_eq!(
        (video.width, video.height, video.scale),
        (400.0, 300.0, 2.0)
    );
    let image = nodes[1].media.as_ref().unwrap();
    assert_eq!(
        (image.width, image.height, image.scale),
        (600.0, 400.0, 0.5)
    );
    let FfiQueryReply::Decorators { nodes: stored } = session
        .query(FfiQuery::Decorators {
            keys: vec![images[0], videos[0]],
        })
        .unwrap()
    else {
        panic!("stored facts")
    };
    assert!(stored.iter().all(|node| {
        node.media
            .as_ref()
            .is_some_and(|media| media.width.is_nan() && media.height.is_nan())
    }));
    for (width, height) in [
        (0.0, 5.0),
        (f64::NAN, 5.0),
        (5.0, f64::INFINITY),
        (-1.0, 5.0),
    ] {
        assert!(
            session
                .query(FfiQuery::MediaLayouts {
                    measurements: vec![FfiMediaMeasurement {
                        key: images[0],
                        width,
                        height
                    }]
                })
                .is_err()
        );
    }
    assert!(
        session
            .query(FfiQuery::MediaLayouts {
                measurements: vec![FfiMediaMeasurement {
                    key: equations[0],
                    width: 10.0,
                    height: 10.0
                }]
            })
            .is_err()
    );
    let stale = NodeKey::from_parts(KeyParts {
        index: images[0].index(),
        generation: images[0].generation().wrapping_add(1),
    });
    assert!(
        session
            .query(FfiQuery::MediaLayouts {
                measurements: vec![FfiMediaMeasurement {
                    key: stale,
                    width: 10.0,
                    height: 10.0
                }]
            })
            .is_err()
    );
    let FfiQueryReply::State { root: after } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    assert_eq!(before, after);
}

#[test]
fn native_media_facts_reuse_constraints_without_mutating_serialized_payloads() {
    let session = NativeEditorSession::new(
        application_config(),
        None,
        FfiNow {
            mono_ms: 0,
            wall_ms: 1_000_000,
        },
    )
    .unwrap();
    for (step, input) in [
        FfiInput::Start,
        FfiInput::Seed { kind: SeedKind::Optimistic, snapshot: vec![] },
        FfiInput::SetState { root: serde_json::from_value(json!({"type":"root","children":[
            {"type":"image","srcType":"url","url":"https://example.com/image.png","width":1200,"height":800,"constrainedWidth":600,"constrainedHeight":500,"scale":0.5,"alt":"fixture"},
            {"type":"video","srcType":"url","url":"https://example.com/video.mp4","width":800,"height":600,"constrainedWidth":1000,"constrainedHeight":300,"scale":2},
            {"type":"image","srcType":"url","url":"https://example.com/unmeasured.png","scale":1},
            {"type":"paragraph","children":[{"type":"equation","equation":"x^2","inline":true}]}
        ]})).unwrap() },
    ].into_iter().enumerate() {
        let output = session.handle(FfiNow { mono_ms:step as u64, wall_ms:1_000_000+step as i64 }, input).unwrap();
        assert!(!output.view.iter().any(|effect| matches!(effect,FfiViewEffect::Error{..})));
    }
    let FfiQueryReply::State { root: before } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    let FfiQueryReply::Nodes { keys: images, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "image".into(),
        })
        .unwrap()
    else {
        panic!("images")
    };
    let FfiQueryReply::Nodes { keys: videos, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "video".into(),
        })
        .unwrap()
    else {
        panic!("videos")
    };
    let FfiQueryReply::Nodes {
        keys: equations, ..
    } = session
        .query(FfiQuery::NodesOfType {
            name: "equation".into(),
        })
        .unwrap()
    else {
        panic!("equations")
    };
    let keys = vec![videos[0], images[0], equations[0], images[1]];
    let FfiQueryReply::Decorators { nodes } = session
        .query(FfiQuery::Decorators { keys: keys.clone() })
        .unwrap()
    else {
        panic!("decorators")
    };
    assert_eq!(nodes.iter().map(|node| node.key).collect::<Vec<_>>(), keys);
    let video = nodes[0].media.as_ref().unwrap();
    assert_eq!(
        (video.width, video.height, video.scale),
        (400.0, 300.0, 2.0)
    );
    let image = nodes[1].media.as_ref().unwrap();
    assert_eq!(
        (image.width, image.height, image.scale),
        (600.0, 400.0, 0.5)
    );
    assert!(nodes[2].media.is_none());
    assert_eq!(nodes[2].text, "x^2");
    assert!(nodes[2].is_inline);
    let unmeasured = nodes[3].media.as_ref().unwrap();
    assert!(unmeasured.width.is_nan());
    assert!(unmeasured.height.is_nan());
    assert_eq!(unmeasured.scale, 1.0);
    let FfiQueryReply::State { root: after } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    assert_eq!(before, after);
    session
        .handle(
            FfiNow {
                mono_ms: 4,
                wall_ms: 1_000_004,
            },
            FfiInput::SetState {
                root: serde_json::from_value(
                    json!({"type":"root","children":[{"type":"paragraph","children":[]}]}),
                )
                .unwrap(),
            },
        )
        .unwrap();
    assert!(session.query(FfiQuery::Decorators { keys }).is_err());
}
