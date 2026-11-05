//! GraphQL inbound adapter for the notifications inbox: the
//! `notificationInbox` page under the viewer, the done, undo and seen
//! mutations, and the `notificationInboxUpdates` subscription. The shapes
//! mirror the work feed's, so one live feed client serves both. The schema
//! itself is composed by `complete_graph`.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// Request data carrying the inbox service and the shared triggers and
/// viewer lookup.
mod context;
/// Inbox, scope and mutation inputs.
mod inputs;
/// Done, undo and seen mutations.
mod mutations;
/// Page, entry, row, actor, action and patch objects.
mod objects;
/// The `notificationInbox` page resolver.
mod query;
/// The `notificationInboxUpdates` subscription.
mod subscriptions;

pub use context::{NotificationInboxGraphqlContext, NotificationInboxGraphqlService};
pub use inputs::{
    GraphqlNotificationInboxRowType, MarkNotificationInboxRowsDoneInput,
    MarkNotificationInboxRowsSeenInput, NotificationInboxInput, NotificationInboxRowTargetInput,
    NotificationInboxScopeInput, UndoNotificationInboxRowsDoneInput,
};
pub use mutations::{
    MarkNotificationInboxRowsDonePayload, MarkNotificationInboxRowsSeenPayload,
    NotificationInboxMutationRoot, UndoNotificationInboxRowsDonePayload,
};
pub use objects::{
    GraphqlNotificationInboxActor, GraphqlNotificationInboxActorKind,
    GraphqlNotificationInboxEntry, GraphqlNotificationInboxPage, GraphqlNotificationInboxPatch,
    GraphqlNotificationInboxRow, GraphqlNotificationInboxRowAction,
    GraphqlNotificationInboxRowActionKind,
};
pub use query::resolve_notification_inbox;
pub use subscriptions::NotificationInboxSubscriptionRoot;
