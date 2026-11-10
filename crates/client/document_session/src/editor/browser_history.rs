//! Browser history applies the remote content first and restores live awareness separately.
use super::*;

pub(super) struct AwarenessSelection {
    focused: bool,
    format: TextFormat,
}

impl AwarenessSelection {
    pub(super) fn capture(surface: &EditorSurface) -> Self {
        Self {
            focused: surface.focused,
            format: surface
                .core
                .state()
                .selection()
                .and_then(Selection::as_range)
                .map_or(TextFormat::empty(), |range| range.format),
        }
    }
}

impl EditorSurface {
    pub(super) fn publish_browser_history_selection(
        &self,
        view: &mut Vec<ViewEffect>,
        awareness_write: Option<bool>,
    ) {
        let selection = self.core.state().selection();
        let (format, style) = selection.and_then(Selection::as_range).map_or_else(
            || (TextFormat::empty(), Arc::from("")),
            |range| (range.format, range.style.clone()),
        );
        let selection = view_selection(selection);
        view.push(match awareness_write {
            Some(write_dom) => ViewEffect::HistoryAwarenessSelection {
                selection,
                format,
                style,
                write_dom,
            },
            None => ViewEffect::Editor(Effect::SetViewSelection {
                selection,
                format,
                style,
            }),
        });
    }

    pub(super) fn restore_browser_history_selection(
        &mut self,
        doc: &LoroDoc,
        points: Option<(Point, Point)>,
        awareness: AwarenessSelection,
        now: Now,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        self.history_selection.applied();
        if let Some((anchor, focus)) = points {
            let mut range = RangeSelection::new(anchor, focus);
            range.format = awareness.format;
            if let Some(capture) = &self.follow_up_errors {
                capture.clear();
            }
            let mut output = self
                .core
                .apply(
                    Input::Command {
                        command: Command::Extension(ExtensionCommand::new(
                            &builder::RESTORE_HISTORY_AWARENESS,
                            builder::HistoryAwarenessRestore {
                                range,
                                focused: awareness.focused,
                            },
                        )),
                        selection: ViewSelection::KeepModel,
                    },
                    HistoryTime(now.mono.0),
                )
                .map_err(|error| SessionError::Model(error.error))?;
            output
                .effects
                .retain(|effect| !matches!(effect, Effect::SetViewSelection { .. }));
            Self::output(
                output,
                view,
                self.reported_errors.as_deref(),
                self.follow_up_errors.as_deref(),
            );
            self.publish_browser_history_selection(view, Some(awareness.focused));
            self.refresh_cursor(doc);
        }
        // Preserve the previous local awareness when its point cannot resolve.
        // The real browser selectionchange can supply a new model selection.
        self.history_changed(view);
        Ok(())
    }
}
