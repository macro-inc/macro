//! The read API: attribution of commits and pull requests (squash merges
//! resolved through GitHub), blame, and sessions with their transcripts.

/// Line attestations of an authorship note.
pub mod attestation;
/// Responses and the records the read side reads.
pub mod models;
/// The index reads and GitHub calls the read side needs.
pub mod ports;
/// The read use cases.
pub mod service;
