//! GraphQL inbound adapter for the notifications inbox: the
//! `notificationInbox` page and `notificationInboxClears` under the viewer,
//! the done, clear, undo and seen mutations, and the `notificationInboxUpdates` subscription. The shapes
//! mirror the work feed's, so one live feed client serves both. The schema
//! itself is composed by `complete_graph`.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// Request data carrying the inbox service and the shared triggers and
/// viewer lookup.
mod context;
/// Inbox, scope and mutation inputs.
mod inputs;
/// Done, clear, undo and seen mutations.
mod mutations;
/// Page, entry, row, actor, action and patch objects.
mod objects;
/// The `notificationInbox` page and `notificationInboxClears` resolvers.
mod query;
/// The `notificationInboxUpdates` subscription.
mod subscriptions;

pub use context::{NotificationInboxGraphqlContext, NotificationInboxGraphqlService};
pub use inputs::{
    ClearNotificationInboxInput, GraphqlNotificationInboxRowType,
    MarkNotificationInboxNotificationDoneInput, MarkNotificationInboxRowsDoneInput,
    MarkNotificationInboxRowsSeenInput, NotificationInboxInput, NotificationInboxRowTargetInput,
    NotificationInboxScopeInput, UndoNotificationInboxClearInput,
    UndoNotificationInboxRowsDoneInput,
};
pub use mutations::{
    ClearNotificationInboxPayload, MarkNotificationInboxNotificationDonePayload,
    MarkNotificationInboxRowsDonePayload, MarkNotificationInboxRowsSeenPayload,
    NotificationInboxMutationRoot, UndoNotificationInboxClearPayload,
    UndoNotificationInboxRowsDonePayload,
};
pub use objects::{
    GraphqlNotificationInboxActor, GraphqlNotificationInboxActorKind,
    GraphqlNotificationInboxClear, GraphqlNotificationInboxClearStatus,
    GraphqlNotificationInboxEntry, GraphqlNotificationInboxPage, GraphqlNotificationInboxPatch,
    GraphqlNotificationInboxRow, GraphqlNotificationInboxRowAction,
    GraphqlNotificationInboxRowActionKind,
};
pub use query::{resolve_notification_inbox, resolve_notification_inbox_clears};
pub use subscriptions::NotificationInboxSubscriptionRoot;
