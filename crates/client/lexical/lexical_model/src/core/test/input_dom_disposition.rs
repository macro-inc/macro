use super::*;

struct Prefix {
    prevent: bool,
    stop: bool,
    fail: bool,
}
impl Plugin for Prefix {
    fn name(&self) -> &'static str {
        "input-dom-prefix"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::InsertText,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if !matches!(command, Command::InsertText(_)) {
            return Ok(Handled::No);
        }
        if self.prevent {
            tx.prevent_default();
        }
        if self.stop {
            tx.stop_dom_propagation()?;
        }
        if self.fail {
            return tx.dispatch(&Command::FormatText(TextFormatType::Bold));
        }
        Ok(Handled::Yes)
    }
}
struct NestedFailure;
impl Plugin for NestedFailure {
    fn name(&self) -> &'static str {
        "nested-format-failure"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::FormatText,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Err(Error::Invariant("injected nested Format failure"))
    }
}

#[test]
fn input_dom_disposition_matrix_keeps_model_and_history_unchanged() {
    for (prevent, stop) in [(false, false), (true, false), (false, true), (true, true)] {
        for fail in [false, true] {
            let editor = Editor::builder(EditorMode::ViewAttached)
                .plugin(Prefix {
                    prevent,
                    stop,
                    fail,
                })
                .plugin(NestedFailure)
                .build()
                .unwrap();
            let mut core = EditorCore::new(
                editor,
                CoreConfig {
                    history: Some(HistoryConfig::default()),
                    editable: true,
                    diff: DiffOptions::default(),
                    track_text_content: false,
                },
            );
            let before = core.state().to_json_string().unwrap();
            let publication = core.editor.suspend_version;
            let disposition = InputDomDisposition {
                default_prevented: prevent,
                propagation_stopped: stop,
            };
            let result = core.apply(
                Input::Command {
                    command: Command::InsertText("prefix".into()),
                    selection: ViewSelection::KeepModel,
                },
                HistoryTime(1),
            );
            if fail {
                let error = result.unwrap_err();
                assert!(matches!(
                    error.error,
                    Error::Invariant("injected nested Format failure")
                ));
                assert!(error.committed.is_empty());
                assert_eq!(error.dom_disposition, disposition);
                assert_eq!(core.editor.suspend_version, publication);
            } else {
                let output = result.unwrap();
                let mut expected = Vec::new();
                if prevent {
                    expected.push(Effect::PreventDefault);
                }
                if stop {
                    expected.push(Effect::InputDomDisposition(disposition));
                }
                assert_eq!(output.effects, expected);
                assert!(output.diff.ops.is_empty());
                assert!(output.commits.is_empty());
            }
            assert_eq!(core.state().to_json_string().unwrap(), before);
            assert!(!core.history.as_ref().unwrap().availability().can_undo);
            assert!(!core.history.as_ref().unwrap().availability().can_redo);
            // A real next entry without a handler must not inherit this prefix.
            let next = core
                .apply(
                    Input::Command {
                        command: Command::FormatElement(ElementFormat::Center),
                        selection: ViewSelection::KeepModel,
                    },
                    HistoryTime(2),
                )
                .unwrap();
            assert_eq!(next.handled, Handled::No);
            assert!(next.effects.is_empty());
        }
    }
}
