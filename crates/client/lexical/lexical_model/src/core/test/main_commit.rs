use super::*;

fn core(editor: Editor) -> EditorCore {
    EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    )
}

#[test]
fn missing_listener_noop_output_carrier_does_not_publish_main_transaction() {
    let mut core = core(
        Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor"),
    );
    let publisher_before = core.editor.suspend_version;
    let mut outcome = MainCommitOutcome::Published {
        commit_id: CommitId(99),
        handled: Handled::Yes,
    };
    let output = core
        .apply_with_main_commit(
            Input::Command {
                command: Command::ClearEditor,
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(1),
            &mut outcome,
        )
        .expect("early output");
    assert_eq!(output.handled, Handled::No);
    // build_output filters the early noop carrier out of the public commit list.
    assert!(output.commits.is_empty());
    assert_eq!(core.editor.suspend_version, publisher_before);
    assert_eq!(outcome, MainCommitOutcome::NotPublished);
}

struct EmptyMain(Handled);
impl Plugin for EmptyMain {
    fn name(&self) -> &'static str {
        "empty-main"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::ClearEditor,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(self.0)
    }
}
#[test]
fn real_empty_handled_and_unhandled_transaction_commits_are_published() {
    for handled in [Handled::No, Handled::Yes] {
        let mut core = core(
            Editor::builder(EditorMode::Headless)
                .plugin(EmptyMain(handled))
                .build()
                .expect("editor"),
        );
        let publisher_before = core.editor.suspend_version;
        let mut outcome = MainCommitOutcome::NotPublished;
        let output = core
            .apply_with_main_commit(
                Input::Command {
                    command: Command::ClearEditor,
                    selection: ViewSelection::KeepModel,
                },
                HistoryTime(1),
                &mut outcome,
            )
            .expect("main commit");
        // The real transaction publisher records its exact ID, even though
        // build_output filters this empty commit from Output.commits.
        assert!(output.commits.is_empty());
        assert_eq!(output.handled, handled);
        assert!(core.editor.suspend_version > publisher_before);
        assert_eq!(
            outcome,
            MainCommitOutcome::Published {
                commit_id: core.editor.suspend_version,
                handled,
            }
        );
    }
}
#[test]
fn published_prefix_does_not_claim_the_failed_main_transaction() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(PublishThenError)
        .build()
        .expect("editor");
    editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("before")?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])
        })
        .expect("seed");
    let mut core = core(editor);
    let mut outcome = MainCommitOutcome::NotPublished;
    let error = core
        .apply_with_main_commit(
            Input::Command {
                command: Command::ClearEditor,
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(1),
            &mut outcome,
        )
        .expect_err("main fails");
    assert!(!error.committed.is_empty());
    assert_eq!(&*core.state().root_text_content(), "early publication");
    assert_eq!(outcome, MainCommitOutcome::NotPublished);
}

static FOLLOWING: EventKey<()> = EventKey::new("observed-following");
struct Following {
    fail: bool,
}
impl Plugin for Following {
    fn name(&self) -> &'static str {
        "observed-following"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        if commit
            .events
            .iter()
            .any(|event| event.name() == "notification")
        {
            if self.fail {
                return Err(Error::Invariant("observed followup failure"));
            }
            tx.emit(&FOLLOWING, ());
        }
        Ok(())
    }
}
#[test]
fn following_commit_and_followup_error_preserve_the_exact_main_identity() {
    for fail in [false, true] {
        let mut core = core(
            Editor::builder(EditorMode::Headless)
                .plugin(EmitOnly)
                .plugin(Following { fail })
                .build()
                .expect("editor"),
        );
        let mut outcome = MainCommitOutcome::NotPublished;
        let output = core
            .apply_with_main_commit(
                Input::Command {
                    command: Command::Extension(ExtensionCommand::new(&EMIT_ONLY, ())),
                    selection: ViewSelection::KeepModel,
                },
                HistoryTime(1),
                &mut outcome,
            )
            .expect("main result");
        let main = output
            .commits
            .iter()
            .find(|commit| {
                commit
                    .events
                    .iter()
                    .any(|event| event.name() == "notification")
            })
            .expect("main event commit");
        assert_eq!(
            outcome,
            MainCommitOutcome::Published {
                commit_id: main.id,
                handled: Handled::Yes
            }
        );
        if fail {
            assert!(
                output
                    .effects
                    .iter()
                    .any(|effect| matches!(effect, Effect::FollowUpFailed { .. }))
            );
        } else {
            assert_ne!(output.commits.last().expect("following").id, main.id);
        }
    }
}
