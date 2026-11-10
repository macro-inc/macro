use super::*;
pub(super) enum Operation {
    Selection,
    Text(u32),
    OwnJSON(u32),
    SetSelection(wire::SelectionMsg),
    Dispatch(wire::EditorInputMsg),
    Enter,
    Register(u64, u8),
    Unregister(u64),
}
#[derive(Debug)]
pub(super) enum Value {
    None,
    Bytes(Vec<u8>),
    Text(String),
    Handled(bool),
    Handle(u64),
}
pub(super) trait Current {
    fn id(&self) -> Id;
    fn generation(&self) -> u32;
    fn execute(&self, operation: Operation) -> Result<Value, BoundaryError>;
}
scoped_tls_hkt::scoped_thread_local!(pub(super) static CURRENT: for<'a> &'a (dyn Current + 'a));
pub(super) struct Scope<'a, 'editor> {
    tx: RefCell<Option<&'a mut Transaction<'editor>>>,
    invocation: &'a Invocation,
    id: Id,
    generation: u32,
}
impl<'a, 'editor> Scope<'a, 'editor> {
    pub(super) fn new(
        tx: &'a mut Transaction<'editor>,
        invocation: &'a Invocation,
        id: Id,
    ) -> Self {
        let generation = tx.view().snapshot().max_key().generation();
        Self {
            tx: RefCell::new(Some(tx)),
            invocation,
            id,
            generation,
        }
    }
}
impl Current for Scope<'_, '_> {
    fn id(&self) -> Id {
        self.id
    }
    fn generation(&self) -> u32 {
        self.generation
    }
    fn execute(&self, operation: Operation) -> Result<Value, BoundaryError> {
        if self.invocation.registry.lock()?.epoch != self.invocation.epoch {
            return Err(BoundaryError::Invalid("view command binding expired"));
        }
        let tx = self
            .tx
            .try_borrow_mut()
            .map_err(|_| BoundaryError::Invalid("view command scope busy"))?
            .take()
            .ok_or(BoundaryError::Invalid(
                "view command scope already executing",
            ))?;
        // No RefCell or registry guard crosses a command dispatch or JS callout.
        let result = execute(tx, self.invocation, operation);
        self.tx.replace(Some(tx));
        result
    }
}
pub(super) fn execute_current(scope: u64, operation: Operation) -> Result<Value, BoundaryError> {
    if !CURRENT.is_set() {
        return Err(BoundaryError::Invalid("view command scope expired"));
    }
    CURRENT.with(|current| {
        if current.id().raw() != scope {
            return Err(BoundaryError::Invalid("view command scope is not current"));
        }
        current.execute(operation)
    })
}
fn execute(
    tx: &mut Transaction<'_>,
    invocation: &Invocation,
    operation: Operation,
) -> Result<Value, BoundaryError> {
    let generation = tx.view().snapshot().max_key().generation();
    Ok(match operation {
        Operation::Selection => {
            let selection = tx.view().snapshot().selection();
            let mut encoded =
                editor_input::view_selection(&lexical_model::view_selection(selection));
            encoded.dirty = selection.is_some_and(Selection::is_dirty);
            Value::Bytes(bytes(&encoded)?)
        }
        Operation::Text(key) => {
            let key = editor_input::key(key, generation);
            if tx.view().node(key).is_none() {
                return Err(BoundaryError::Invalid("view command node missing"));
            }
            Value::Text(tx.view().text_content(key).into_owned())
        }
        Operation::OwnJSON(key) => Value::Text(serde_json::to_string(
            &tx.view().export_json(editor_input::key(key, generation))?,
        )?),
        Operation::SetSelection(selection) => {
            tx.selection_from_view(editor_input::selection(&selection, generation)?)?;
            Value::None
        }
        Operation::Register(callback, priority) => Value::Handle(invocation.registry.insert(
            callback,
            registry::priority(priority)?,
            |registration, listener| tx.register_command_listener(registration, listener),
        )?),
        Operation::Unregister(handle) => {
            invocation
                .registry
                .remove(handle, |id| tx.unregister_command_listener(id))?;
            Value::None
        }
        Operation::Enter => {
            require_edit(invocation)?;
            Value::Handled(
                tx.dispatch(&Command::Key {
                    command: KeyCommand::Enter,
                    event: None,
                })? == Handled::Yes,
            )
        }
        Operation::Dispatch(msg) => {
            let read_only = match &msg {
                wire::EditorInputMsg::EditorCommand { command, .. } => {
                    let code = u32::from(*command);
                    if !(1..=11).contains(&code) && !(15..=17).contains(&code) {
                        return Err(BoundaryError::Invalid("unsupported scoped command"));
                    }
                    code == 10
                }
                wire::EditorInputMsg::EditorApplication {
                    name,
                    keyboard: false,
                    ..
                } if matches!(
                    name.as_str(),
                    "group-b.table"
                        | "group-b.table-check-down"
                        | "group-b.move"
                        | "group-b.resolve-pr"
                        | "group-b.link"
                        | "group-b.media"
                        | "group-b.checklist"
                        | "group-b.code"
                        | "group-b.select-all"
                        | "group-b.node-transform"
                ) =>
                {
                    name == "group-b.select-all"
                }
                _ => return Err(BoundaryError::Invalid("unsupported scoped input")),
            };
            if !read_only {
                require_edit(invocation)?;
            }
            let Input::Command { command, selection } = editor_input::input(msg, generation)?
            else {
                return Err(BoundaryError::Invalid("scoped input must be a command"));
            };
            tx.selection_from_view(selection)?;
            Value::Handled(tx.dispatch(&command)? == Handled::Yes)
        }
    })
}
fn require_edit(invocation: &Invocation) -> Result<(), BoundaryError> {
    if invocation.access != doc_sync_core::Access::Edit {
        return Err(BoundaryError::Invalid(
            "scoped document mutation requires Edit access",
        ));
    }
    Ok(())
}
