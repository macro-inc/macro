//! Pipedream as a source of connections: apps users connect through
//! Pipedream Connect (Pipedream owns grants, tokens and refresh), whose tools
//! are called through Pipedream's remote MCP server and whose REST APIs
//! through its Connect API proxy. Rows have `provider = 'pipedream'`.

pub(crate) mod api;
pub(crate) mod models;
pub(crate) mod source;
