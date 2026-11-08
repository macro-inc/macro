//! The editor host sends real session inputs and executes every resulting core effect.
use super::*;
use crate::client::{resolve::resolve, runtime::Runtime};
use document_session::SessionInput;
use lexical_model::{Command, Input as EditorInput, ViewSelection};
mod input;

impl Sim {
    pub(super) fn editor_edit(&mut self, name: &ClientName, op: EditorOp) -> Result<(), Failure> {
        let Some(client) = self.clients.get_mut(name) else {
            self.emit(Fact::OpSkipped {
                client: name.clone(),
                reason: "NoTarget".into(),
            });
            return Ok(());
        };
        if !client.alive
            || client.frozen
            || !matches!(
                client.core.phase(),
                doc_sync_core::Phase::Running | doc_sync_core::Phase::Resetting
            )
            || (client.effective_access != Access::Edit && !matches!(op, EditorOp::Select { .. }))
        {
            self.emit(Fact::OpSkipped {
                client: name.clone(),
                reason: "ReadOnlyOrNotReady".into(),
            });
            return Ok(());
        }
        if let EditorOp::MarkdownShortcut { block, shortcut } = &op {
            if client.spec.kind == ClientKind::AiWorker {
                self.emit(Fact::OpSkipped {
                    client: name.clone(),
                    reason: "BrowserShortcutUnavailable".into(),
                });
                return Ok(());
            }
            return self.editor_shortcut(name, *block, *shortcut);
        }
        let Runtime::Editor(session) = &mut client.core else {
            return Err(Failure::new(
                "editor_surface",
                "editor operation on a generic client",
            ));
        };
        let input = match &op {
            EditorOp::MarkdownShortcut { .. } => unreachable!("shortcut lowered above"),
            EditorOp::Undo => EditorInput::Undo,
            EditorOp::Redo => EditorInput::Redo,
            EditorOp::SetBlock { .. }
            | EditorOp::ToggleList { .. }
            | EditorOp::InsertTable { .. }
            | EditorOp::PasteMarkdown { .. }
            | EditorOp::Type { .. }
            | EditorOp::Backspace { .. }
            | EditorOp::DeleteRange { .. }
            | EditorOp::SplitBlock { .. }
            | EditorOp::Format { .. }
            | EditorOp::Indent { .. }
            | EditorOp::Outdent { .. } => {
                let Some(input) = input::editing_input(
                    session.surface().state(),
                    &op,
                    client.spec.kind == ClientKind::AiWorker,
                ) else {
                    self.emit(Fact::OpSkipped {
                        client: name.clone(),
                        reason: "NoTarget".into(),
                    });
                    return Ok(());
                };
                input
            }
            EditorOp::Select { from, to } => {
                let state = session.surface().state();
                let (Some(anchor), Some(focus)) = (resolve(state, *from), resolve(state, *to))
                else {
                    self.emit(Fact::OpSkipped {
                        client: name.clone(),
                        reason: "NoTarget".into(),
                    });
                    return Ok(());
                };
                if client.spec.kind == ClientKind::AiWorker {
                    EditorInput::Command {
                        command: Command::Extension(lexical_model::ExtensionCommand::new(
                            &crate::client::commands::MODEL_SELECTION,
                            lexical_model::RangeSelection::new(anchor, focus),
                        )),
                        selection: ViewSelection::KeepModel,
                    }
                } else {
                    EditorInput::SelectionFromView {
                        selection: ViewSelection::Range {
                            anchor,
                            focus,
                            resolution_dirty: false,
                        },
                        change: None,
                    }
                }
            }
        };
        self.apply_editor_input(name, Some(op), input)
    }
    fn apply_editor_input(
        &mut self,
        name: &ClientName,
        op: Option<EditorOp>,
        input: EditorInput,
    ) -> Result<(), Failure> {
        let client = self
            .clients
            .get_mut(name)
            .ok_or_else(|| Failure::new("editor_surface", "missing client"))?;
        let before = client.core.version();
        let Runtime::Editor(session) = &mut client.core else {
            return Err(Failure::new(
                "editor_surface",
                "editor operation on a generic client",
            ));
        };
        let now = doc_sync_core::Now {
            mono: doc_sync_core::Millis(self.clock.now),
            wall: doc_sync_core::UnixMillis(self.clock.wall(client.skew)),
        };
        let handled = Runtime::editor_handle(session, SessionInput::Editor(input), now);
        let peer = session.peer_id();
        let start = before.get(&peer).copied().unwrap_or(0);
        let end = session.version().get(&peer).copied().unwrap_or(0);
        let spans = if end > start {
            vec![IdSpan { peer, start, end }]
        } else {
            vec![]
        };
        let session = client.session;
        let (out, facts) = client.finish(before, handled);
        let failures = std::mem::take(&mut client.failures);
        let generation = client.generation;
        self.stats.handles = self.stats.handles.saturating_add(1);
        self.stats.wal_max_depth = self
            .stats
            .wal_max_depth
            .max(u64::try_from(client.core.wal().entries.len()).unwrap_or(u64::MAX));
        if let Some(op) = op {
            self.emit(Fact::LocalOp {
                client: name.clone(),
                op: AbstractOp::Editor(op),
                spans,
            });
        }
        for fact in facts {
            self.emit(fact);
        }
        for failure in failures {
            self.fail(failure);
        }
        if let Some(at) = out.wake_at {
            self.schedule(at.0, Pending::Wake(name.clone(), session, generation));
        }
        self.outputs(name, session, out)
    }

    fn editor_shortcut(
        &mut self,
        name: &ClientName,
        block: u16,
        shortcut: u8,
    ) -> Result<(), Failure> {
        let client = &self.clients[name];
        let before = client.core.version();
        let Runtime::Editor(session) = &client.core else {
            return Err(Failure::new(
                "editor_surface",
                "shortcut on a generic client",
            ));
        };
        let Some(point) = resolve(session.surface().state(), Pos { block, offset: 0 }) else {
            self.emit(Fact::OpSkipped {
                client: name.clone(),
                reason: "NoTarget".into(),
            });
            return Ok(());
        };
        self.apply_editor_input(
            name,
            None,
            EditorInput::SelectionFromView {
                selection: ViewSelection::Range {
                    anchor: point,
                    focus: point,
                    resolution_dirty: false,
                },
                change: None,
            },
        )?;
        for character in crate::client::shortcuts::PATTERNS[usize::from(shortcut) % 4].chars() {
            self.apply_editor_input(
                name,
                None,
                EditorInput::Command {
                    command: Command::Extension(lexical_model::ExtensionCommand::new(
                        &crate::client::shortcuts::SHORTCUT_CHAR,
                        character,
                    )),
                    selection: ViewSelection::KeepModel,
                },
            )?;
        }
        let client = &self.clients[name];
        let peer = client.core.peer_id();
        let start = before.get(&peer).copied().unwrap_or(0);
        let end = client.core.version().get(&peer).copied().unwrap_or(0);
        self.emit(Fact::LocalOp {
            client: name.clone(),
            op: AbstractOp::Editor(EditorOp::MarkdownShortcut { block, shortcut }),
            spans: if end > start {
                vec![IdSpan { peer, start, end }]
            } else {
                vec![]
            },
        });
        Ok(())
    }
}
