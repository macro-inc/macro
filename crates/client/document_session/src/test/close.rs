use super::*;

#[test]
fn revoked_durable_direct_editor_acknowledges_close_before_or_after_start() {
    for started in [false, true] {
        let mut sync = sync_config(Access::Edit, TransportKind::Direct);
        sync.persistence = Persistence::Durable;
        sync.chatter = true;
        sync.initial_token = None;
        let mut session = DocumentSession::<EditorSurface>::new(
            SessionConfig {
                sync,
                peer_ids: vec![7, 8, 9],
                peer_range: PeerRange::User,
                surface: SurfaceConfig::Editor(EditorConfig {
                    mode: EditorMode::ViewAttached,
                    ..Default::default()
                }),
            },
            time(0),
        )
        .unwrap();
        if started {
            session.handle(time(1), SessionInput::Sync(SyncInput::Start));
        }
        let out = session.handle(
            time(2),
            SessionInput::Sync(SyncInput::Authorization(AuthorizationState {
                current: false,
                can_write: false,
                can_comment: false,
            })),
        );
        assert!(
            out.view
                .iter()
                .all(|effect| !matches!(effect, ViewEffect::Error(_)))
        );
        if !started {
            let out = session.handle(time(3), SessionInput::Sync(SyncInput::Start));
            assert!(out.io.is_empty());
        }
        for tick in [4, 5] {
            let out = session.handle(
                time(tick),
                SessionInput::Sync(SyncInput::Stop(RequestId(u32::MAX))),
            );
            assert!(out.view.iter().any(|effect| matches!(
                effect,
                ViewEffect::Reply {
                    request: RequestId(u32::MAX),
                    reply: Reply::Stopped
                }
            )));
            assert!(
                out.view
                    .iter()
                    .all(|effect| !matches!(effect, ViewEffect::Error(_)))
            );
            assert!(out.io.is_empty());
        }
    }
}

#[test]
fn unstarted_editor_cancellation_acknowledges_close_without_start() {
    let mut sync = sync_config(Access::Edit, TransportKind::Direct);
    sync.persistence = Persistence::Durable;
    sync.chatter = true;
    sync.initial_token = None;
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync,
            peer_ids: vec![7, 8, 9],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig {
                mode: EditorMode::ViewAttached,
                ..Default::default()
            }),
        },
        time(0),
    )
    .unwrap();
    for tick in [1, 2] {
        let out = session.handle(
            time(tick),
            SessionInput::Sync(SyncInput::Stop(RequestId(u32::MAX))),
        );
        assert!(out.view.iter().any(|effect| matches!(
            effect,
            ViewEffect::Reply {
                request: RequestId(u32::MAX),
                reply: Reply::Stopped
            }
        )));
        assert!(
            out.view
                .iter()
                .all(|effect| !matches!(effect, ViewEffect::Error(_)))
        );
    }
}
