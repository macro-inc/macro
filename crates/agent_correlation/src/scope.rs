//! What a hidden session's code may do, decided where its credential is
//! minted and enforced wherever the credential is accepted: every service
//! that validates attribution refuses a request outside the scope.

#[cfg(test)]
mod test;

/// A narrower scope than the person's own access.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionScope {
    /// A hidden suggestion generation session: it reads, writes ideas and
    /// routine suggestions through its own tools, and drafts email; nothing
    /// else.
    Generation,
}

/// Requests a generation session may make besides reads by method: its own
/// tools and drafting email. Paths as the SDK sends them, `{…}` one segment.
const GENERATION_WRITES: &[(&str, &str)] = &[
    ("POST", "/ideas"),
    ("PATCH", "/ideas/{id}"),
    ("POST", "/ideas/{id}/retire"),
    ("POST", "/scheduled-actions/suggestions"),
    ("POST", "/scheduled-actions/suggestions/{id}/retire"),
    ("POST", "/email/drafts"),
];

/// Reads the SDK sends as POST (batch lookups, search); the harness checks
/// this list against the SDK's operation catalog.
pub const POST_READS: &[(&str, &str)] = &[
    ("POST", "/agent-sessions/preview"),
    ("POST", "/github_pull_requests/mergeability"),
    ("POST", "/team/invite-link/team"),
    ("POST", "/user/get_names"),
    ("POST", "/user/get_names_with_email"),
    ("POST", "/ai-cost/usage"),
    ("POST", "/chats/history_batch_messages"),
    ("POST", "/decisions"),
    ("POST", "/preview"),
    ("POST", "/email/messages/batch"),
    ("POST", "/v1/user_notifications/item/bulk"),
    ("POST", "/properties/entities/bulk"),
    ("POST", "/search"),
    ("POST", "/search/simple"),
    ("POST", "/scheduled-actions/check"),
    ("POST", "/unfurl/bulk"),
    ("POST", "/calendar-events/preview"),
    ("POST", "/call/record/preview"),
    ("POST", "/channel-labels/preview"),
    ("POST", "/channels/preview"),
    ("POST", "/crm/pipelines/{id}/rows"),
    ("POST", "/documents/github_prs/tasks"),
    ("POST", "/documents/preview"),
    ("POST", "/documents/similarity_search"),
    ("POST", "/items/soup"),
    ("POST", "/items/soup/ast"),
    ("POST", "/items/soup/ast/grouped"),
    ("POST", "/projects/preview"),
];

impl SessionScope {
    /// Its stored name.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Generation => "generation",
        }
    }

    /// The scope stored as `name`, if it is one.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "generation" => Some(Self::Generation),
            _ => None,
        }
    }

    /// The requests besides reads this scope may make.
    pub fn writes(self) -> &'static [(&'static str, &'static str)] {
        match self {
            Self::Generation => GENERATION_WRITES,
        }
    }

    /// Whether a request with `method` to `path` is inside the scope. Reads
    /// by method always are; any other request only on the scope's list or
    /// [`POST_READS`]. `path` may carry one service prefix before the SDK's
    /// path.
    pub fn allows(self, method: &str, path: &str) -> bool {
        if matches!(method, "GET" | "HEAD" | "OPTIONS") {
            return true;
        }
        self.writes()
            .iter()
            .chain(POST_READS)
            .any(|(allowed, template)| *allowed == method && matches(path, template))
    }
}

/// The path prefixes services are reached under through the gateway, as the
/// SDK's hosts name them.
const SERVICE_PREFIXES: &[&str] = &[
    "/agent-harness",
    "/auth",
    "/calendar",
    "/cognition",
    "/connection-gateway",
    "/contacts",
    "/dss",
    "/email",
    "/notification",
    "/scheduled-action",
    "/unfurl",
];

/// Whether `path` is `template`'s SDK path, alone or under one service
/// prefix, a `{…}` segment standing for any one segment.
pub fn matches(path: &str, template: &str) -> bool {
    let path = path.trim_end_matches('/');
    let exact = |path: &str| {
        let path: Vec<&str> = path.split('/').collect();
        let template: Vec<&str> = template.trim_end_matches('/').split('/').collect();
        path.len() == template.len()
            && path.iter().zip(&template).all(|(segment, wanted)| {
                (wanted.starts_with('{') && wanted.ends_with('}') && !segment.is_empty())
                    || segment == wanted
            })
    };
    exact(path)
        || SERVICE_PREFIXES.iter().any(|prefix| {
            path.strip_prefix(prefix)
                .is_some_and(|rest| rest.starts_with('/') && exact(rest))
        })
}
