//! Reading a user's Notion workspace for import into Macro.
//!
//! The domain is the importer's view of Notion: typed pages, data sources and
//! property values, the [`domain::ports::NotionApi`] port, and the
//! inventory that walks everything in scope. The outbound adapter reaches
//! Notion's REST API through the user's Pipedream Connect grant.

#![deny(missing_docs)]

pub mod domain;
pub mod outbound;
