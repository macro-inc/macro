/// Repositories the service accepts data for, as `host/owner/name`. Events
/// for any other repository, or with none, are dropped before storage.
pub const ALLOWED_REPOSITORIES: &[&str] = &["github.com/macro-inc/macro"];

/// The git-ai release this server is tested against. `/worker/releases`
/// offers only this version, so an upstream wire change reaches laptops only
/// after it is bumped here.
pub const PINNED_CLIENT_VERSION: &str = "1.7.6";
