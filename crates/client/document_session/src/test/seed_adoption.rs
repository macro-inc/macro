use super::*;

#[test]
fn wal_only_editor_initializes_after_delayed_adoption_replays_durable_content() {
    for early in [false, true] {
        let (_, bytes) = editor_seed();
        let mut sync = sync_config(Access::Read, TransportKind::None);
        sync.persistence = Persistence::Durable;
        let user = sync.user.clone();
        let mut session = DocumentSession::<EditorSurface>::new(
            SessionConfig {
                sync,
                peer_ids: vec![50, 51, 52],
                peer_range: PeerRange::User,
                surface: SurfaceConfig::Editor(EditorConfig::default()),
            },
            time(0),
        )
        .unwrap();
        let out = session.handle(time(0), SessionInput::Sync(SyncInput::Start));
        let load = out
            .io
            .iter()
            .find_map(|io| match io {
                IoEffect::Storage {
                    id,
                    op: StorageOp::Load { .. },
                } => Some(*id),
                _ => None,
            })
            .unwrap();
        if early {
            let out = session.handle(
                time(1),
                SessionInput::Sync(SyncInput::Seed {
                    kind: SeedKind::Optimistic,
                    snapshot: vec![],
                }),
            );
            assert!(
                !out.view
                    .iter()
                    .any(|v| matches!(v, ViewEffect::Initialize(_)))
            );
        }
        let out = session.handle(
            time(2),
            SessionInput::Sync(SyncInput::Storage(StorageEvent::Loaded {
                id: load,
                result: Ok(LocalState {
                    snapshot: None,
                    assist: vec![],
                    orphans: vec![OrphanWal {
                        owner: WalOwner::Legacy,
                        records: vec![StoredWalRecord {
                            record: WalRecord {
                                seq: WalSeq(1),
                                created_at: UnixMillis(0),
                                user,
                                foreign: false,
                                quarantined: false,
                                bytes,
                            },
                            delivered: false,
                        }],
                    }],
                }),
            })),
        );
        let adopt = out
            .io
            .iter()
            .find_map(|io| match io {
                IoEffect::Storage {
                    id,
                    op: StorageOp::WalAdopt { .. },
                } => Some(*id),
                _ => None,
            })
            .unwrap();
        assert!(
            !out.view
                .iter()
                .any(|v| matches!(v, ViewEffect::Initialize(_)))
        );
        if !early {
            let out = session.handle(
                time(3),
                SessionInput::Sync(SyncInput::Seed {
                    kind: SeedKind::Optimistic,
                    snapshot: vec![],
                }),
            );
            assert!(
                !out.view
                    .iter()
                    .any(|v| matches!(v, ViewEffect::Initialize(_)))
            );
        }
        let out = session.handle(
            time(4),
            SessionInput::Sync(SyncInput::Storage(StorageEvent::Adopted {
                id: adopt,
                result: Ok(1),
            })),
        );
        assert!(
            out.view
                .iter()
                .any(|v| matches!(v, ViewEffect::Initialize(_)))
        );
        assert!(!out.view.iter().any(|v| matches!(v, ViewEffect::Error(_))));
        let key = text_key(&session);
        assert_eq!(
            session
                .surface()
                .state()
                .view()
                .text(key)
                .unwrap()
                .text
                .as_str(),
            "a😀b"
        );
    }
}
