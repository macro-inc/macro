#![deny(missing_docs)]
//! What a caller may do on a route, decided from two values: the route's
//! [`Category`], declared where the route is registered, and the [`Caller`],
//! resolved from the request's verified credential. One table ([`decide`])
//! holds every answer, so a route can't be refused on one mount and allowed on
//! another, and nothing here matches paths.
//!
//! This crate is data only: it decides nothing by itself. The table only
//! refuses. Which principals a route admits and what they may
//! do to a given item stay with `macro_authorization` and the domain's access
//! receipts.

mod caller;
mod category;
mod policy;

pub use caller::Caller;
pub use category::Category;
pub use policy::{
    CategorySet, Enforcement, Refusal, RefusalCode, ResolvedCaller, RouteDecision, Verdict, decide,
};

pub mod inbound;
