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
        let before = client.core.version();
        let Runtime::Editor(session) = &mut client.core else {
            return Err(Failure::new(
                "editor_surface",
                "editor operation on a generic client",
            ));
        };
        let input = match &op {
            EditorOp::Undo => EditorInput::Undo,
            EditorOp::Redo => EditorInput::Redo,
            EditorOp::SetBlock { .. }
            | EditorOp::ToggleList { .. }
            | EditorOp::InsertTable { .. }
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
        self.emit(Fact::LocalOp {
            client: name.clone(),
            op: AbstractOp::Editor(op),
            spans,
        });
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
}
