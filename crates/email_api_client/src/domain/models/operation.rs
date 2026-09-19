/// A provider-neutral email API capability used for quota accounting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ApiOperationKind {
    /// Fetch the mailbox profile.
    GetProfile,
    /// Fetch incremental mailbox changes.
    ListChanges,
    /// List mailbox labels.
    ListLabels,
    /// Create a mailbox label.
    CreateLabel,
    /// Delete a mailbox label.
    DeleteLabel,
    /// Fetch one message.
    GetMessage,
    /// List messages.
    ListMessages,
    /// Modify labels on a message.
    ModifyMessageLabels,
    /// Fetch one message attachment.
    GetAttachment,
    /// Send a message.
    SendMessage,
    /// Fetch one thread.
    GetThread,
    /// List threads.
    ListThreads,
    /// List provider contacts.
    ListContacts,
    /// Create a blocked-sender rule.
    BlockSender,
    /// Remove a blocked-sender rule.
    UnblockSender,
    /// List blocked senders.
    ListBlockedSenders,
    /// Register a mailbox notification subscription.
    Subscribe,
    /// Stop a mailbox notification subscription.
    Unsubscribe,
}
