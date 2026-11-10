use super::*;
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct RevisionOnly {
    #[serde(skip)]
    revision: u64,
}
impl PartialEq for RevisionOnly {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}
impl NodeType for RevisionOnly {
    const TYPE: &'static str = "revision-only-fixture";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for RevisionOnly {
    decorator_node_base!();
    fn render_revision(&self) -> Option<u64> {
        Some(self.revision)
    }
}
#[test]
fn metadata_only_decorator_admission_reaches_session_view_output() {
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![50, 51, 52, 53, 54],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig {
                builder: std::sync::Arc::new(|mode, peer| {
                    default_editor_builder(mode, peer).node::<RevisionOnly>()
                }),
                ..EditorConfig::default()
            }),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    let seed = session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        }),
    );
    assert!(
        !seed
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    let pending = session.suspend_staged_update();
    let (pending, created) = session
        .with_staged_update(pending, |tx| {
            let key = tx.create(RevisionOnly::default())?.key();
            tx.append(NodeKey::ROOT, &[key])?;
            Ok::<_, Error>(key)
        })
        .unwrap();
    let key = created.unwrap();
    let update = StagedUpdate::new(pending);
    let out = session.handle(time(1), update.input());
    assert!(update.was_adopted());
    assert!(
        !out.view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    let before = session.surface().state().to_json().unwrap();
    let pending = session.suspend_staged_update();
    let (pending, changed) = session
        .with_staged_update(pending, |tx| {
            tx.update_node::<RevisionOnly>(key, |node| node.revision = 1)
        })
        .unwrap();
    changed.unwrap();
    let update = StagedUpdate::new(pending);
    let out = session.handle(time(2), update.input());
    assert!(update.was_adopted());
    assert!(
        !out.view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    let diffs: Vec<_> = out
        .view
        .iter()
        .filter_map(|effect| {
            if let ViewEffect::Diff(diff) = effect {
                Some(diff)
            } else {
                None
            }
        })
        .collect();
    assert!(
        diffs.iter().any(|diff| diff.ops.is_empty()
            && diff.decorator_renders.iter().any(|change| {
                change.key == key && change.policy == Some(DecoratorRenderPolicy::Eager(1))
            })),
        "metadata-only admission must reach the native view adapter"
    );
    assert_eq!(before, session.surface().state().to_json().unwrap());
}
