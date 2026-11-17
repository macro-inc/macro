//! GraphQL inbound adapter for bots: the [`GraphqlBot`] identity every reader
//! shares, the authenticated user's bot lookups and lists, the live
//! `botUpdates` subscription, and the resolvers other domains' edges reach
//! bots through.
#![deny(missing_docs)]

mod context;
mod errors;
mod loader;
mod objects;
mod subscription;
#[cfg(test)]
mod test;
mod user_query;

pub use context::{BotReads, BotsGraphqlContext, ChannelMemberAuthorizer};
pub use loader::{BotIdentityDataLoader, BotIdentityLoader, bot_identity_loader, resolve_bot};
pub use objects::GraphqlBot;
pub use subscription::{BotUpdatesGraphqlContext, BotsSubscriptionRoot};
pub use user_query::GraphqlBotsQuery;
