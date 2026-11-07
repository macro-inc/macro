//! Schema-only stub for clients released before external chats replaced
//! WhatsApp groups. Their notification document spreads
//! `... on GraphqlWhatsappGroupMessageMetadata`, and an unknown type fails
//! validation of the whole document. The type is uninhabited, so the server
//! never returns it.

use std::convert::Infallible;

use async_graphql::{ID, Object};

/// A removed WhatsApp group message notification. Never returned.
pub struct GraphqlWhatsappGroupMessageMetadata(Infallible);

impl GraphqlWhatsappGroupMessageMetadata {
    /// Any resolver's value: the type has no values, so none ever runs.
    fn never<T>(&self) -> T {
        match self.0 {}
    }
}

/// A removed WhatsApp group message notification. Never returned; external
/// chat messages use `GraphqlExternalChatMessageMetadata`. Remove after
/// 2026-11-30.
#[Object(name = "GraphqlWhatsappGroupMessageMetadata")]
impl GraphqlWhatsappGroupMessageMetadata {
    /// Display name of the group.
    async fn group_name(&self) -> String {
        self.never()
    }

    /// Message to open within the group.
    async fn message_id(&self) -> ID {
        self.never()
    }
}
