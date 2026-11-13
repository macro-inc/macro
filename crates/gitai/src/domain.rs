/// Turns a metrics upload into stored records: filter, redaction, records.
pub mod ingest;
/// Object keys in the two buckets.
pub mod layout;
/// The counters and their labels.
pub mod metrics;
/// Values every use case shares.
pub mod models;
/// Sessions named in authorship notes.
pub mod note;
/// Capabilities the domain needs from storage and telemetry.
pub mod ports;
/// The read API over stored commits, notes and sessions.
pub mod read;
/// The server-side secret redaction pass.
pub mod redaction;
/// Repository URL normalization and the allowlist check.
pub mod repository;
/// The use cases, generic over the ports.
pub mod service;
/// The git-ai metrics wire format.
pub mod wire;
