//! GraphQL inbound adapter for the authenticated viewer's bounded contact directory.
#![deny(missing_docs)]

mod reads;
mod user_query;

pub use reads::ContactsGraphqlContext;
pub use user_query::{GraphqlContact, GraphqlContactPage, GraphqlContactsQuery};

#[cfg(test)]
mod test;
