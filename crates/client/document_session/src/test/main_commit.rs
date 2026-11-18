use super::*;
use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::sync::Arc;

thread_local! {
    static FAIL_EXPORT: Cell<bool> = const { Cell::new(false) };
    static MAIN_COMMIT: Cell<Option<CommitId>> = const { Cell::new(None) };
}
#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct FailingExport {}
impl NodeType for FailingExport {
    const TYPE: &'static str = "main-outcome-export";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for FailingExport {
    element_node_base!();
    fn adjust_export_json(&self, _: NodeView<'_>, _: &mut SerializedNode) -> Result<(), Error> {
        if FAIL_EXPORT.with(Cell::get) {
            Err(Error::Invariant("post-main export failure"))
        } else {
            Ok(())
        }
    }
}
static INSERT: CommandKey<()> = CommandKey::new("main-outcome-insert");
static INSERT_REGISTRATION: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&INSERT),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];
struct InsertAndArmExport;
impl Plugin for InsertAndArmExport {
    fn name(&self) -> &'static str {
        "main-outcome-export"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &INSERT_REGISTRATION
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        let node = tx.create(FailingExport {})?;
        tx.append(NodeKey::ROOT, &[node.key()])?;
        Ok(Handled::Yes)
    }
    fn after_commit(&self, _: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        if commit.changes.mutations.iter().any(|(key, mutation)| {
            *mutation == Mutation::Created
                && commit
                    .next
                    .view()
                    .type_name(*key)
                    .is_ok_and(|name| name == FailingExport::TYPE)
        }) {
            MAIN_COMMIT.with(|id| id.set(Some(commit.id)));
            FAIL_EXPORT.with(|flag| flag.set(true));
        }
        Ok(())
    }
}
#[test]
fn actual_export_failure_after_main_commit_preserves_outcome_through_session_recovery() {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            FAIL_EXPORT.with(|flag| flag.set(false));
            MAIN_COMMIT.with(|id| id.set(None));
        }
    }
    let _reset = Reset;
    FAIL_EXPORT.with(|flag| flag.set(false));
    MAIN_COMMIT.with(|id| id.set(None));
    let (_, snapshot) = editor_seed();
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![50, 51, 52],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig {
                builder: Arc::new(|mode, peer| {
                    default_editor_builder(mode, peer)
                        .node::<FailingExport>()
                        .plugin(InsertAndArmExport)
                }),
                ..EditorConfig::default()
            }),
        },
        time(0),
    )
    .expect("session");
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    );
    let mut outcome = MainCommitOutcome::NotPublished;
    let output = session.handle_editor_with_main_commit(
        time(1),
        Input::Command {
            command: Command::Extension(ExtensionCommand::new(&INSERT, ())),
            selection: ViewSelection::KeepModel,
        },
        &mut outcome,
    );
    assert!(
        FAIL_EXPORT.with(Cell::get),
        "actual post-commit callback armed the failing exporter"
    );
    assert!(
        output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_))),
        "actual export/projection path reports its error"
    );
    assert_eq!(
        outcome,
        MainCommitOutcome::Published {
            commit_id: MAIN_COMMIT
                .with(Cell::get)
                .expect("exact actual main after_commit capture"),
            handled: Handled::Yes,
        }
    );
}
#[test]
fn session_access_refusal_resets_caller_outcome_before_any_main_transaction() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::Read, TransportKind::None, snapshot);
    let mut outcome = MainCommitOutcome::Published {
        commit_id: CommitId(99),
        handled: Handled::Yes,
    };
    let output = session.handle_editor_with_main_commit(
        time(1),
        Input::Command {
            command: Command::InsertText("denied".into()),
            selection: ViewSelection::KeepModel,
        },
        &mut outcome,
    );
    assert!(
        output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(SessionError::ReadOnly)))
    );
    assert_eq!(outcome, MainCommitOutcome::NotPublished);
}
