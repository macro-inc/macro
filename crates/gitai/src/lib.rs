#![deny(missing_docs)]
//! Macro's self-hosted server for the open-source git-ai client: ingest of
//! metrics, notes and transcripts, and the read API over them. See `AGENTS.md`.

/// Models, ports and the use cases the inbound adapters call.
pub mod domain;
/// HTTP adapters: the client-facing `/worker` routes and the read API.
pub mod inbound;
/// S3 and DynamoDB adapters that implement the domain ports.
pub mod outbound;

#[cfg(test)]
mod fakes;
#[cfg(test)]
mod read_fakes;
