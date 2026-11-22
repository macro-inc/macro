//! One-shot, callback-scoped native decisions; no DOM callout holds a model borrow.
use super::*;
use macro_document_model::plugins_group_b::block_navigation::{
    self as policy, Direction, EdgeRects,
};

pub(super) type Geometry = Result<Option<EdgeRects>, &'static str>;

pub(super) struct Binding {
    pub(super) handle: Id,
    pub(super) command: KeyCommand,
    pub(super) shift: bool,
}
pub(super) struct Issued {
    id: Id,
    mutation_epoch: u64,
    plan: policy::Plan,
}

pub(super) fn advance(invocation: &Invocation) -> Result<(), BoundaryError> {
    let epoch = invocation
        .mutation_epoch
        .get()
        .checked_add(1)
        .ok_or(BoundaryError::Invalid(
            "view command mutation epoch exhausted",
        ))?;
    invocation.mutation_epoch.set(epoch);
    Ok(())
}

fn validate(scope: &Scope<'_, '_>, tx: &Transaction<'_>) -> Result<Direction, BoundaryError> {
    let binding = scope.navigation.as_ref().ok_or(BoundaryError::Invalid(
        "block navigation requires its fixed role",
    ))?;
    if scope.invocation.retire_view.get()
        || tx.view().snapshot().max_key().generation() != scope.generation()
    {
        return Err(BoundaryError::Invalid("block navigation view retired"));
    }
    let state = scope.invocation.registry.lock()?;
    if state.epoch != scope.invocation.epoch
        || !state.entries.iter().any(|entry| {
            entry.role == Role::BlockNavigation
                && entry.handle == binding.handle
                && entry.command == binding.command
        })
    {
        return Err(BoundaryError::Invalid("block navigation binding expired"));
    }
    match binding.command {
        KeyCommand::ArrowUp => Ok(Direction::Up),
        KeyCommand::ArrowDown => Ok(Direction::Down),
        _ => Err(BoundaryError::Invalid("block navigation direction")),
    }
}

pub(super) fn prepare(scope: &Scope<'_, '_>, tx: &Transaction<'_>) -> Result<Value, BoundaryError> {
    scope.plan.borrow_mut().take();
    let direction = validate(scope, tx)?;
    let shift = scope
        .navigation
        .as_ref()
        .is_some_and(|binding| binding.shift);
    let Some(plan) = policy::prepare(tx, direction, shift)? else {
        return Ok(Value::Handle(0));
    };
    let id = Id::issue()?;
    scope.plan.replace(Some(Issued {
        id,
        mutation_epoch: scope.invocation.mutation_epoch.get(),
        plan,
    }));
    Ok(Value::Handle(id.raw()))
}

pub(super) fn block(
    scope: &Scope<'_, '_>,
    tx: &Transaction<'_>,
    id: u64,
) -> Result<Value, BoundaryError> {
    validate(scope, tx)?;
    let plan = scope.plan.borrow();
    let issued = plan
        .as_ref()
        .filter(|issued| issued.id.raw() == id)
        .ok_or(BoundaryError::Invalid("block navigation plan not current"))?;
    if issued.mutation_epoch != scope.invocation.mutation_epoch.get() {
        return Err(BoundaryError::Invalid("block navigation plan changed"));
    }
    Ok(Value::Key(issued.plan.block().map(NodeKey::index)))
}

pub(super) fn cancel(
    scope: &Scope<'_, '_>,
    tx: &Transaction<'_>,
    id: u64,
) -> Result<Value, BoundaryError> {
    let issued = scope
        .plan
        .borrow_mut()
        .take()
        .ok_or(BoundaryError::Invalid("block navigation plan consumed"))?;
    validate(scope, tx)?;
    if issued.id.raw() != id {
        return Err(BoundaryError::Invalid("block navigation plan not current"));
    }
    Ok(Value::None)
}

pub(super) fn complete(
    scope: &Scope<'_, '_>,
    tx: &mut Transaction<'_>,
    id: u64,
    rects: Geometry,
) -> Result<Value, BoundaryError> {
    // Consumption precedes every validation/error/mutation exit, including wrong IDs.
    let issued = scope
        .plan
        .borrow_mut()
        .take()
        .ok_or(BoundaryError::Invalid("block navigation plan consumed"))?;
    validate(scope, tx)?;
    if issued.id.raw() != id || issued.mutation_epoch != scope.invocation.mutation_epoch.get() {
        return Err(BoundaryError::Invalid("block navigation plan changed"));
    }
    let rects = rects.map_err(BoundaryError::Invalid)?;
    advance(scope.invocation)?;
    Ok(Value::Handled(issued.plan.complete(tx, rects)?))
}

impl Registry {
    pub(crate) fn register_block_navigation(
        self: &Arc<Self>,
        session: &mut document_session::DocumentSession<document_session::EditorSurface>,
        down: bool,
        callback: u64,
    ) -> Result<u64, Error> {
        self.ensure_local()?;
        self.rebind(session)?;
        self.insert_role(
            if down {
                KeyCommand::ArrowDown
            } else {
                KeyCommand::ArrowUp
            },
            callback,
            CommandPriority::Low,
            Role::BlockNavigation,
            |registration, listener| session.register_command_listener(registration, listener),
        )
    }
}
