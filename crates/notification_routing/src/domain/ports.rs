//! Ports (trait contracts) for notification stacks.

use std::collections::HashMap;
use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::NotificationLane;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::evaluate::DocumentPlacement;
use crate::domain::models::{NewStack, NotificationStack, StackChanges, StackError};

/// Outbound persistence port for stacks.
///
/// Every method is scoped to an owner: someone else's stack misses instead of
/// erroring.
pub trait StackRepository: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The owner's stacks in position order.
    fn list(
        &self,
        owner: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<NotificationStack>, Self::Err>> + Send;

    /// The enabled stacks of every one of `owners` who has any, each list in
    /// position order.
    fn enabled_for(
        &self,
        owners: &[MacroUserIdStr<'_>],
    ) -> impl Future<
        Output = Result<HashMap<MacroUserIdStr<'static>, Vec<NotificationStack>>, Self::Err>,
    > + Send;

    /// Store a new stack after the owner's last one. `None` when the owner
    /// already has `limit` stacks.
    fn create(
        &self,
        owner: &MacroUserIdStr<'_>,
        id: Uuid,
        stack: &NewStack,
        lane: NotificationLane,
        limit: usize,
    ) -> impl Future<Output = Result<Option<NotificationStack>, Self::Err>> + Send;

    /// Apply `changes` to one of the owner's stacks and count the edit in its
    /// revision. `None` when the owner has no such stack.
    fn update(
        &self,
        owner: &MacroUserIdStr<'_>,
        id: Uuid,
        changes: &StackChanges,
    ) -> impl Future<Output = Result<Option<NotificationStack>, Self::Err>> + Send;

    /// Remove one of the owner's stacks. Returns whether a stack was removed.
    /// Notifications it captured keep their lane.
    fn delete(
        &self,
        owner: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Put the owner's stacks in the order of `ids` and return them. `None`,
    /// with nothing changed, unless `ids` names each of the owner's stacks
    /// exactly once.
    fn reorder(
        &self,
        owner: &MacroUserIdStr<'_>,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<Option<Vec<NotificationStack>>, Self::Err>> + Send;
}

/// Outbound port for where a document is filed, read only when a rule names a
/// folder or a task project.
pub trait DocumentPlacements: Send + Sync + 'static {
    /// The folders `document_id` sits in and, for a task, its project. A
    /// document that no longer exists is filed nowhere.
    fn placement(
        &self,
        document_id: &str,
        is_task: bool,
    ) -> impl Future<Output = Result<DocumentPlacement, Report>> + Send;
}

/// Inbound service port: a person managing their own stacks.
///
/// Every method answers [`StackError::Unavailable`] to someone stacks are not
/// turned on for.
pub trait NotificationStackService: Send + Sync + 'static {
    /// The owner's stacks in position order.
    fn list(
        &self,
        owner: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<NotificationStack>, StackError>> + Send;

    /// Create a stack after the owner's last one.
    fn create(
        &self,
        owner: &MacroUserIdStr<'_>,
        stack: NewStack,
    ) -> impl Future<Output = Result<NotificationStack, StackError>> + Send;

    /// Change one of the owner's stacks. Notifications already routed stay
    /// where they are.
    fn update(
        &self,
        owner: &MacroUserIdStr<'_>,
        id: Uuid,
        changes: StackChanges,
    ) -> impl Future<Output = Result<NotificationStack, StackError>> + Send;

    /// Delete one of the owner's stacks. Notifications it captured keep
    /// their lane.
    fn delete(
        &self,
        owner: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<(), StackError>> + Send;

    /// Put the owner's stacks in a new order, which must name each of them
    /// once.
    fn reorder(
        &self,
        owner: &MacroUserIdStr<'_>,
        ids: Vec<Uuid>,
    ) -> impl Future<Output = Result<Vec<NotificationStack>, StackError>> + Send;
}
