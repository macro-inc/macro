/// Request-level cap on how many characters of a field OpenSearch analyzes
/// for highlighting. Must stay below the index-level
/// `index.highlight.max_analyzed_offset` (default 1,000,000): with the
/// request-level cap set, an oversized field gets a truncated highlight,
/// while without it the plain highlighter throws and OpenSearch fails the
/// entire shard's fetch phase — silently dropping every hit on that shard
/// from the (HTTP 200, partial) response.
pub(crate) const HIGHLIGHT_MAX_ANALYZER_OFFSET: u32 = 999_999;

mod builder;
pub mod call_records;
pub mod channels;
pub mod chats;
pub mod documents;
pub mod emails;
pub mod model;
pub mod projects;
mod properties;
mod query;
pub mod unified;
mod utils;
