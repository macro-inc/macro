/// Viewer-scoped contact identities and resolved directory records.
pub mod contact;
/// Generic graph data structures (vertices and edges).
pub mod graph;
/// SQS message types for the contacts queue.
pub mod messages;
/// Validated limits, cursors, and pages for bounded directory reads.
pub mod page;
/// Ranked people search over the viewer's contacts and current team.
pub mod people;
/// Bounded search text and exact lookup requests.
pub mod query;
