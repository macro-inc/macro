use crate::*;
use doc_sync_core::{Access, Now};
use loro::LoroDoc;
impl crate::session::sealed::Sealed for EditorSurface {}
impl Surface for EditorSurface {
    fn construct(config: SurfaceConfig, peer: u64, now: Now) -> Result<Self, SessionError> {
        let SurfaceConfig::Editor(config) = config else {
            return Err(SessionError::WrongSurface);
        };
        Self::new(config, peer, now)
    }
    fn init(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        self.init(doc, now, access, view)
    }
    fn remote(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError> {
        match self.remote_pending(doc, now, access, view, false) {
            Ok(changed) => Ok(changed),
            Err(error) => {
                view.push(ViewEffect::Error(error));
                self.resync(doc, now, access, view)?;
                Ok(true)
            }
        }
    }
    fn local(
        &mut self,
        doc: &LoroDoc,
        input: SessionInput,
        now: Now,
        access: Access,
        ready: bool,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError> {
        let SessionInput::Editor(input) = input else {
            return Err(SessionError::WrongSurface);
        };
        if contains_remote(&input) {
            return Err(SessionError::WrongSurface);
        }
        if let lexical_model::Input::Batch(inputs) = &input
            && inputs.iter().any(|input| {
                matches!(
                    input,
                    lexical_model::Input::Undo
                        | lexical_model::Input::Redo
                        | lexical_model::Input::Command {
                            command: lexical_model::Command::Undo
                                | lexical_model::Command::Redo
                                | lexical_model::Command::ClearHistory
                                | lexical_model::Command::ClearEditor,
                            ..
                        }
                )
            })
        {
            return Err(SessionError::Model(lexical_model::Error::InputNotBatchable));
        }
        let local_only = local_only(&input, self.config.local_commands);
        if !ready && !local_only {
            return Err(SessionError::NotReady);
        }
        if access != Access::Edit && !local_only {
            return Err(SessionError::ReadOnly);
        }
        if ready && access == Access::Edit && self.projection.is_none() {
            self.init(doc, now, access, view)?;
        }
        self.core.set_editable(access == Access::Edit);
        match self.apply(doc, input, now, access, view) {
            Err(error @ SessionError::Projection(_)) => {
                view.push(ViewEffect::Error(error));
                self.resync(doc, now, access, view)?;
                Ok(true)
            }
            result => result,
        }
    }
    fn take_resynced(&mut self) -> bool {
        std::mem::take(&mut self.resynced)
    }
    fn presence(&self, _doc: &LoroDoc) -> Option<loro::LoroValue> {
        self.selection_cursors()
            .as_ref()
            .map(lexical_loro::encode_selection)
    }
    fn set_focus(&mut self, focused: bool) -> Result<(), SessionError> {
        self.focused = focused;
        self.focus_known = true;
        Ok(())
    }
    fn supports_comments(&self) -> bool {
        true
    }
    fn comment_already_placed(&self, request: &CommentMarkRequest) -> bool {
        matches!(request.action, CommentAction::Add { .. })
            && self
                .state()
                .view()
                .descendants(lexical_model::NodeKey::ROOT)
                .any(|(key, _)| {
                    self.state()
                        .view()
                        .get::<lexical_rich_nodes::mark::MarkNode>(key)
                        .is_some_and(|mark| mark.has_id(&request.mark_id))
                })
    }
    fn stage_comment(
        &self,
        doc: &LoroDoc,
        request: &CommentMarkRequest,
        peer: u64,
        now: Now,
    ) -> Result<Vec<u8>, doc_sync_core::CommentRefusal> {
        self.stage(doc, request, peer, now)
    }
    fn composing(&self) -> bool {
        matches!(
            self.core.composition(),
            lexical_model::Composition::Composing { .. }
        )
    }
    fn composition_changed(&self, before: &LoroDoc, after: &LoroDoc) -> bool {
        use loro::ContainerTrait;
        let lexical_model::Composition::Composing { key } = self.core.composition() else {
            return false;
        };
        let view = self.state().view();
        let paragraph = view.parent(key).unwrap_or(key);
        let Some(id) = self
            .projection
            .as_ref()
            .and_then(|projection| projection.container_of(paragraph))
        else {
            return true;
        };
        match (
            before.get_container(id.clone()),
            after.get_container(id.clone()),
        ) {
            (Some(loro::Container::Map(a)), Some(loro::Container::Map(b))) => {
                b.is_deleted() || a.get_deep_value() != b.get_deep_value()
            }
            _ => true,
        }
    }
    fn end_composition(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        use lexical_model::*;
        let Composition::Composing { key } = self.core.composition() else {
            return Ok(());
        };
        let text = self.state().view().text_content(key).into_owned();
        self.apply(
            doc,
            Input::Composition {
                event: CompositionEvent::End {
                    key,
                    text,
                    anchor: None,
                    focus: None,
                    data: String::new(),
                },
                selection: ViewSelection::KeepModel,
            },
            now,
            access,
            view,
        )?;
        Ok(())
    }
    fn drop_binding(&mut self) {
        self.clear_binding();
    }
}
fn contains_remote(input: &lexical_model::Input) -> bool {
    match input {
        lexical_model::Input::ApplyRemote { .. } => true,
        lexical_model::Input::Batch(inputs) => inputs.iter().any(contains_remote),
        _ => false,
    }
}
fn local_only(input: &lexical_model::Input, allowed: &[lexical_model::CommandKind]) -> bool {
    use lexical_model::{Command, Input};
    match input {
        Input::SelectionFromView { .. } => true,
        Input::Command { command, .. } => {
            matches!(
                command,
                Command::SelectAll(_) | Command::SelectionChange | Command::ClearHistory
            ) || allowed.contains(&command.kind())
        }
        Input::Batch(inputs) => inputs.iter().all(|input| local_only(input, allowed)),
        _ => false,
    }
}
impl crate::session::sealed::Sealed for GenericSurface {}
impl Surface for GenericSurface {
    fn construct(config: SurfaceConfig, _: u64, _: Now) -> Result<Self, SessionError> {
        let SurfaceConfig::Generic(config) = config else {
            return Err(SessionError::WrongSurface);
        };
        Ok(Self::new(config))
    }
    fn init(
        &mut self,
        doc: &LoroDoc,
        _: Now,
        _: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        self.init(doc, view)
    }
    fn remote(
        &mut self,
        doc: &LoroDoc,
        _: Now,
        _: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError> {
        self.drain(doc, view)?;
        Ok(false)
    }
    fn local(
        &mut self,
        doc: &LoroDoc,
        input: SessionInput,
        now: Now,
        access: Access,
        ready: bool,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError> {
        self.local(doc, input, now, access, ready, view)
    }
    fn composing(&self) -> bool {
        false
    }
    fn composition_changed(&self, _: &LoroDoc, _: &LoroDoc) -> bool {
        false
    }
    fn end_composition(
        &mut self,
        _: &LoroDoc,
        _: Now,
        _: Access,
        _: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        Ok(())
    }
    fn drop_binding(&mut self) {
        self.drop_binding();
    }
}
