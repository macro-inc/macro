/// What the list backfill reads from the legacy directory and its sources.
pub mod backfill;
/// Viewer-scoped contact identities and resolved directory records.
pub mod contact;
/// Generic graph data structures (vertices and edges).
pub mod graph;
/// Directory invalidations sent to a user's clients.
pub mod invalidation;
/// The lists a contact belongs to, and inbox sources.
pub mod list;
/// Which of a viewer's lists each contact is in.
pub mod listed;
/// SQS message types for the contacts queue.
pub mod messages;
/// Validated limits, cursors, and pages for bounded directory reads.
pub mod page;
/// Ranked people search over the viewer's contacts and current team.
pub mod people;
/// Bounded search text and exact lookup requests.
pub mod query;
