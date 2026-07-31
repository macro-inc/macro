//! GraphQL inbound adapter for the email domain: email message object types
//! and the DataLoader-backed Soup email-message edge.
#![deny(missing_docs)]

mod loaders;
mod objects;
mod user_objects;
mod user_query;

pub use loaders::{
    EmailContentKey, EmailContentLoad, EmailContentLoader, EmailServiceEmailContentReader,
    NoOpSoupEmailContentEdgeReader, SoupEmailContentEdgeReader, email_content_loader,
};
pub use objects::{GraphqlSoupEmailMessage, load_email_messages, load_latest_email_message};
pub use user_objects::{
    GraphqlEmailLabel, GraphqlEmailLink, GraphqlEmailLinkSettings, GraphqlEmailProvider,
    GraphqlEmailSyncStatus,
};
pub use user_query::GraphqlEmailQuery;
