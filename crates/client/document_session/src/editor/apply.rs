//! Local editor application with optional main-transaction outcome.
use super::*;

impl EditorSurface {
    pub(crate) fn apply(
        &mut self,
        doc: &LoroDoc,
        input: Input,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError> {
        self.apply_inner(doc, input, now, access, view, None)
    }
    pub(crate) fn apply_with_main_commit(
        &mut self,
        doc: &LoroDoc,
        input: Input,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
        main_commit: lexical_model::MainCommitObservation<'_>,
    ) -> Result<bool, SessionError> {
        self.apply_inner(doc, input, now, access, view, Some(main_commit))
    }
    fn apply_inner(
        &mut self,
        doc: &LoroDoc,
        input: Input,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
        main_commit: Option<lexical_model::MainCommitObservation<'_>>,
    ) -> Result<bool, SessionError> {
        let time = history_time(now)?;
        self.history_clock.store(now.wall.0, Ordering::Relaxed);
        self.handled = Handled::No;
        let cold_span = match &input {
            Input::SetState { .. } => Some(tracing::info_span!(
                "editor.set_state",
                outcome = tracing::field::Empty
            )),
            Input::Command {
                command: Command::Paste(payload),
                ..
            } => Some(tracing::info_span!(
                "editor.paste",
                bytes = payload.data.values().map(String::len).sum::<usize>(),
                outcome = tracing::field::Empty
            )),
            _ => None,
        };
        let _cold_guard = cold_span.as_ref().map(tracing::Span::enter);
        if !self.focus_known {
            match &input {
                Input::SelectionFromView {
                    selection: ViewSelection::None,
                    ..
                } => self.focused = false,
                Input::SelectionFromView { selection, .. } | Input::Command { selection, .. }
                    if !matches!(selection, ViewSelection::KeepModel | ViewSelection::None) =>
                {
                    self.focused = true
                }
                Input::TextFromView { .. }
                | Input::TextDeltaFromView(_)
                | Input::InsertTextEvent { .. }
                | Input::Composition { .. } => self.focused = true,
                _ => {}
            }
        }
        let history = match &input {
            Input::Undo
            | Input::Command {
                command: Command::Undo,
                ..
            } => Some(false),
            Input::Redo
            | Input::Command {
                command: Command::Redo,
                ..
            } => Some(true),
            _ => None,
        };
        if let Some(redo) = history {
            return self.navigate_history(doc, redo, now, access, view);
        }

        let clear = matches!(
            input,
            Input::Command {
                command: Command::ClearHistory | Command::ClearEditor,
                ..
            }
        );
        if matches!(
            input,
            Input::Command {
                command: Command::ClearHistory,
                ..
            }
        ) {
            if let Some(undo) = &self.undo {
                undo.clear();
            }
            self.group_active = false;
            self.history_ready = true;
            self.handled = Handled::Yes;
            self.tracker = MergeTracker::new(self.config.delay_ms, time);
            self.history_changed(view);
            return Ok(false);
        }
        let routed_history = match &input {
            Input::KeyDown {
                routed: Some(Command::Undo),
                ..
            } => Some(false),
            Input::KeyDown {
                routed: Some(Command::Redo),
                ..
            } => Some(true),
            _ => None,
        };
        self.history_selection.prepare(self.selection_cursors());
        if let Some(capture) = &self.follow_up_errors {
            capture.clear();
        }
        let result = match main_commit {
            Some(outcome) => self
                .core
                .apply_with_main_commit_observation(input, time, outcome),
            None => self.core.apply(input, time),
        };
        // Preserve the real error prefix before any subsequent fallible projection.
        if let Err(error) = &result {
            Self::failed_dom_disposition(error, view);
        }
        // Run KeyDown and routed command listeners through the model first. Its
        // snapshot history is disabled here; only an unhandled successful route
        // falls through to collaborative history, after its commits are projected.
        let routed_history = routed_history.filter(|_| {
            result
                .as_ref()
                .is_ok_and(|output| output.handled == Handled::No)
        });
        let commits: &[Commit] = match &result {
            Ok(out) => &out.commits,
            Err(error) => &error.committed,
        };
        #[cfg(feature = "application")]
        self.checklist.observe(commits);
        if let Ok(output) = &result
            && let Some(selection) = &output.installed_selection
        {
            self.history_selection
                .prepare(selection.as_ref().and_then(|selection| {
                    let previous = commits
                        .first()
                        .map_or(self.core.state(), |commit| &commit.prev);
                    self.projection.as_ref()?.cursor(doc, previous, selection)
                }));
        }
        self.group(commits, time)?;
        #[cfg(feature = "test-faults")]
        let fault = if std::mem::take(&mut self.wrong_next_type) {
            self.prepare_projection_type_write(doc)?
        } else {
            None
        };
        let changed = if access == Access::Edit && !commits.is_empty() && self.projection.is_some()
        {
            let projection = self.projection.as_mut().ok_or(SessionError::NotReady)?;
            let projected = if self
                .undo
                .as_ref()
                .is_some_and(|undo| undo.accepts_projected_checkpoint(LOCAL_ORIGIN))
            {
                projection.local_commit_without_events(doc, commits, now.wall.0 / 1000)?
            } else {
                projection.local_commit(doc, commits, LOCAL_ORIGIN, now.wall.0 / 1000)?
            };
            if projected.events_suppressed && projected.changed {
                self.undo
                    .as_ref()
                    .ok_or(SessionError::NotReady)?
                    .record_projected_checkpoint()?;
            }
            projected.changed
        } else {
            false
        };
        #[cfg(test)]
        if changed && std::mem::take(&mut self.fail_after_next_local_commit) {
            return Err(SessionError::Configuration(
                "injected failure after a local commit",
            ));
        }
        #[cfg(feature = "test-faults")]
        if changed && let Some(fault) = fault {
            self.inject_projection_type_write(doc, fault)?;
        }
        if clear {
            if let Some(undo) = &mut self.undo {
                undo.group_end();
                undo.clear();
            }
            self.group_active = false;
            self.tracker = MergeTracker::new(self.config.delay_ms, time);
            self.history_ready = true;
        }
        let failed = result.is_err();
        #[cfg(feature = "application")]
        let upgrade =
            matches!(&result, Ok(output) if Self::requests_metadata_upgrade(&output.effects));
        match result {
            Ok(output) => {
                self.handled = output.handled;
                Self::output(
                    output,
                    view,
                    #[cfg(feature = "application")]
                    &mut self.checklist,
                    self.reported_errors.as_deref(),
                    self.follow_up_errors.as_deref(),
                );
            }
            Err(error) => {
                if let (Some(first), Some(last)) = (error.committed.first(), error.committed.last())
                {
                    let mut chain = first.clone();
                    chain.next = last.next.clone();
                    chain.full_reconcile = true;
                    view.push(ViewEffect::Diff(chain.diff(&self.config.diff)?));
                }
                if let Some(observer) = &self.reported_errors {
                    observer.reported(&error.error, view.len());
                }
                view.push(ViewEffect::Error(SessionError::Model(error.error)));
            }
        }
        #[cfg(feature = "application")]
        let changed = if upgrade {
            self.upgrade_document_metadata(doc, now, access, view)? || changed
        } else {
            changed
        };
        self.refresh_cursor(doc);
        if changed && let Some(undo) = &self.undo {
            self.history_selection
                .record_after(undo, self.selection_cursors());
        }
        self.history_changed(view);
        if let Some(span) = &cold_span {
            span.record("outcome", if failed { "error" } else { "ok" });
        }
        if let Some(redo) = routed_history {
            return Ok(self.navigate_history(doc, redo, now, access, view)? || changed);
        }
        Ok(changed)
    }
}
