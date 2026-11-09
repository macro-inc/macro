use super::*;

#[test]
fn same_core_admission_obeys_readiness_access_and_consumption()
-> Result<(), Box<dyn std::error::Error>> {
    for (ready, access, accepted) in [
        (false, Access::Edit, false),
        (true, Access::Read, false),
        (true, Access::Edit, true),
    ] {
        let now = Now {
            mono: Millis(0),
            wall: UnixMillis(0),
        };
        let sync = SyncConfig {
            doc: "session-test".parse().unwrap(),
            session: SessionId(uuid_value::Uuid::from_u128(2)),
            user: UserKey("fixture-user".into()),
            transport: TransportKind::None,
            persistence: Persistence::Memory,
            access,
            initial_token: Some(SyncToken::new("fixture-token".into())),
            traceparent: None,
            timeouts: Timeouts::default(),
            heartbeat: HeartbeatPolicy::default(),
            backoff: BackoffPolicy::default(),
            converge: ConvergePolicy::default(),
            wal: WalPolicy::default(),
            snapshot_interval: None,
            presence: PresencePolicy {
                timeout: WallDuration(10000),
                refresh: None,
                user: PresenceUser {
                    user_id: None,
                    color: PaletteColor::Blue,
                },
                key: PresenceKeyMode::Peer,
            },
            chatter: false,
            reset_budget: ResetBudget::default(),
        };
        let mut session = DocumentSession::<EditorSurface>::new(
            SessionConfig {
                sync,
                peer_ids: vec![20, 21, 22, 23],
                peer_range: PeerRange::User,
                surface: SurfaceConfig::Editor(EditorConfig {
                    builder: Arc::new(compat_editor_builder),
                    mode: EditorMode::ViewAttached,
                    ..EditorConfig::default()
                }),
            },
            now,
        )?;
        if ready {
            session.handle(now, SessionInput::Sync(SyncInput::Start));
            session.handle(
                now,
                SessionInput::Sync(SyncInput::Seed {
                    kind: SeedKind::Optimistic,
                    snapshot: vec![],
                }),
            );
        }
        let pending = session.suspend_compat_update();
        let (pending, edited) = session.with_compat_update(pending, |tx| -> Result<(), Error> {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("admitted text")?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.select_end(text)?;
            Ok(())
        })?;
        edited?;
        assert!(session.surface().state().is_empty_state());
        let update = CompatUpdate::new(pending);
        let version = session.version();
        let out = session.handle(now, update.input());
        assert_eq!(update.was_adopted(), accepted);
        assert_eq!(
            out.view
                .iter()
                .any(|effect| matches!(effect, ViewEffect::Error(_))),
            !accepted
        );
        assert_eq!(
            session.surface().state().root_text_content().as_ref(),
            if accepted { "admitted text" } else { "" }
        );
        if accepted {
            assert_ne!(session.version(), version);
            assert!(session.surface().state().selection().is_some());
            assert!(session.surface().history().can_undo);
            let out = session.handle(now, update.input());
            assert!(
                out.view
                    .iter()
                    .any(|effect| matches!(effect, ViewEffect::Error(_)))
            );
            assert_eq!(
                session.surface().state().root_text_content().as_ref(),
                "admitted text"
            );
            session.handle(now, SessionInput::Editor(Input::Undo));
            assert_eq!(session.surface().state().root_text_content().as_ref(), "");
            assert!(session.surface().history().can_redo);
            session.handle(now, SessionInput::Editor(Input::Redo));
            assert_eq!(
                session.surface().state().root_text_content().as_ref(),
                "admitted text"
            );
        }
    }
    Ok(())
}
