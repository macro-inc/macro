//! Fresh-peer annotation staging; rejected marks never enter the live WAL.
use crate::*;
use doc_sync_core::{CommentRefusal, Now, RequestId};
use lexical_model::*;
use lexical_rich_nodes::mark::{self, MarkNode};
use loro::{ExportMode, LoroDoc};

/// Correlated annotation publication request.
#[derive(Clone, Debug)]
pub struct CommentMarkRequest {
    /// Host request correlation key.
    pub request: RequestId,
    /// Stable annotation identity.
    pub mark_id: String,
    /// Add a selected range or remove the mark everywhere.
    pub action: CommentAction,
}
/// Annotation operation against server-current content.
#[derive(Clone, Debug)]
pub enum CommentAction {
    /// Wrap text only if both durable cursors still resolve to the expected text.
    Add {
        /// Durable selection start.
        anchor: lexical_loro::NodeCursor,
        /// Durable selection end.
        focus: lexical_loro::NodeCursor,
        /// Exact text expected under the selected range.
        text: String,
    },
    /// Remove this id from marks, unwrapping marks with no remaining ids.
    Remove,
}
#[derive(Clone, Debug)]
struct Stage {
    id: String,
    range: Option<RangeSelection>,
    text: Option<String>,
}
static STAGE: CommandKey<Stage> = CommandKey::new("session-stage-comment");
struct StagePlugin;
impl Plugin for StagePlugin {
    fn name(&self) -> &'static str {
        "session-comment-staging"
    }
    fn commands(&self) -> &[CommandRegistration] {
        static REGISTRATIONS: [CommandRegistration; 1] = [CommandRegistration {
            command: CommandKind::Extension(&STAGE),
            priority: CommandPriority::Critical,
            placement: Placement::Before,
        }];
        &REGISTRATIONS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(stage) = command.payload(&STAGE) else {
            return Ok(Handled::No);
        };
        let marks = tx
            .descendants(NodeKey::ROOT)
            .map(|(key, _)| key)
            .filter(|key| {
                tx.view()
                    .get::<MarkNode>(*key)
                    .is_some_and(|mark| mark.has_id(&stage.id))
            })
            .collect::<Vec<_>>();
        if let Some(range) = &stage.range {
            // Retry after a lost ack is idempotent.
            if !marks.is_empty() {
                return Ok(Handled::Yes);
            }
            tx.set_selection(Some(Selection::Range(range.clone())))?;
            if tx.view().selection_text_content()? != stage.text.as_deref().unwrap_or_default() {
                return Err(Error::Invariant("comment selection changed"));
            }
            let backward = range.is_backward(tx.view())?;
            mark::wrap_selection_in_mark_node::<
                fn(&mut Transaction<'_>, Vec<String>) -> Result<NodeKey, Error>,
            >(tx, range, backward, &stage.id, None)?;
        } else {
            for key in marks {
                let id = tx
                    .view()
                    .cast::<MarkNode>(key)
                    .ok_or(Error::NodeTypeMismatch(key))?;
                let mut value = tx
                    .view()
                    .get::<MarkNode>(key)
                    .ok_or(Error::NodeTypeMismatch(key))?
                    .clone();
                value.delete_id(&stage.id);
                if value.ids.is_empty() {
                    mark::unwrap_mark_node(tx, key)?;
                } else {
                    *tx.get_mut(id)? = value;
                }
            }
        }
        Ok(Handled::Yes)
    }
}
impl EditorSurface {
    pub(crate) fn stage(
        &self,
        doc: &LoroDoc,
        request: &CommentMarkRequest,
        peer: u64,
        now: Now,
    ) -> Result<Vec<u8>, CommentRefusal> {
        let fork = lexical_loro::fork_doc(doc, peer).map_err(|_| CommentRefusal::StagingFailed)?;
        let before = fork.oplog_vv();
        let state = lexical_loro::reconstruct_state(&fork, self.config.policy)
            .map_err(|_| CommentRefusal::StagingFailed)?;
        let editor = Self::builder(&self.config, EditorMode::Headless, peer)
            .plugin(StagePlugin)
            .initial_state(state)
            .build()
            .map_err(|_| CommentRefusal::StagingFailed)?;
        let mut core = EditorCore::new(
            editor,
            CoreConfig {
                history: None,
                editable: false,
                diff: DiffOptions::default(),
                track_text_content: false,
            },
        );
        let already_placed = matches!(request.action, CommentAction::Add { .. })
            && core
                .state()
                .view()
                .descendants(NodeKey::ROOT)
                .any(|(key, _)| {
                    core.state()
                        .view()
                        .get::<MarkNode>(key)
                        .is_some_and(|mark| mark.has_id(&request.mark_id))
                });
        if already_placed {
            // A prior server acceptance may have outlived its ack and the original cursors.
            return fork
                .export(ExportMode::updates(&before))
                .map_err(|_| CommentRefusal::StagingFailed);
        }
        let initial = core.take_initial_output();
        let base = initial
            .as_ref()
            .and_then(|out| out.commits.first())
            .map_or(core.state(), |commit| &commit.prev);
        let mut projection = lexical_loro::LoroProjection::attach(&fork, base, self.config.policy)
            .map_err(|_| CommentRefusal::StagingFailed)?;
        if let Some(initial) = initial {
            projection
                .local_commit(
                    &fork,
                    &initial.commits,
                    lexical_loro::LOCAL_ORIGIN,
                    now.wall.0 / 1000,
                )
                .map_err(|_| CommentRefusal::StagingFailed)?;
        }
        let (range, text) = match &request.action {
            CommentAction::Remove => (None, None),
            CommentAction::Add {
                anchor,
                focus,
                text,
            } => {
                let anchor = projection
                    .point(&fork, core.state(), anchor)
                    .ok_or(CommentRefusal::SelectionChanged)?;
                let focus = projection
                    .point(&fork, core.state(), focus)
                    .ok_or(CommentRefusal::SelectionChanged)?;
                (
                    {
                        let mut range = RangeSelection::at_root();
                        range.anchor = anchor;
                        range.focus = focus;
                        Some(range)
                    },
                    Some(text.clone()),
                )
            }
        };
        let output = core
            .apply(
                Input::Command {
                    command: Command::Extension(ExtensionCommand::new(
                        &STAGE,
                        Stage {
                            id: request.mark_id.clone(),
                            range,
                            text,
                        },
                    )),
                    selection: ViewSelection::KeepModel,
                },
                HistoryTime(now.mono.0),
            )
            .map_err(|error| {
                if matches!(error.error, Error::Invariant("comment selection changed")) {
                    CommentRefusal::SelectionChanged
                } else {
                    CommentRefusal::StagingFailed
                }
            })?;
        projection
            .local_commit(
                &fork,
                &output.commits,
                lexical_loro::LOCAL_ORIGIN,
                now.wall.0 / 1000,
            )
            .map_err(|_| CommentRefusal::StagingFailed)?;
        fork.export(ExportMode::updates(&before))
            .map_err(|_| CommentRefusal::StagingFailed)
    }
}
