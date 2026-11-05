//! Artifacts: agent-written web pages published as Macro documents.
//!
//! An artifact is a `Document` of file type `artifact` whose body is a list of
//! immutable versions. Each version maps relative paths to content-addressed
//! objects in the document bucket and names scenes, the pages people share
//! and place on canvases. Pages run scripts, so they are served from a
//! separate origin per artifact (`<document_id>.<artifact content host>`)
//! by the content router, never from a Macro origin.
//!
//! - **domain**: models, manifest validation, ports and the service.
//! - **outbound**: Postgres version repository and the S3 object store.
//! - **inbound**: the API router and the content router.
//! - **wiring**: how a host assembles them.

#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod outbound;
pub mod wiring;

#[cfg(test)]
mod testing;
