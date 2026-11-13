//! What a hidden session's code may do, decided where its credential is
//! minted and enforced wherever the credential is accepted: every service
//! that validates attribution refuses a request outside the scope.

#[cfg(test)]
mod test;

/// A narrower scope than the person's own access.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionScope {
    /// A hidden suggestion generation session: it reads, writes suggestions and
    /// routine suggestions through its own tools, and drafts email; nothing
    /// else.
    Generation,
    /// A background run whose suggestion sends and posts nothing: it may change
    /// the person's own items, but nothing that reaches anyone else.
    NoSend,
}

/// Requests that reach someone else: sending or scheduling mail, invites
/// and calendar changes guests hear of, posts, reactions, mentions, shares,
/// channel and call membership, team and booking settings, routines (which
/// act later), connected apps and their tools, and webhooks. Also the
/// requests that start work with the person's full access: a new or warmed
/// agent session, a session's control, queued prompts and app connections
/// (which resume it), its tool approvals and review decisions, running or
/// rewriting a chat's tool call (a chat message's tools are refused by its
/// route), agents, bots and the computers they run on, which act later, and
/// their credentials. A run that sends nothing makes none of them.
const SENDS: &[(&str, &str)] = &[
    ("POST", "/email/messages"),
    ("POST", "/email/send-confirmed"),
    ("PUT", "/email/drafts/scheduled/{id}"),
    ("POST", "/email/drafts/{id}/transfer"),
    ("POST", "/email/calendar-events/{id}/forward"),
    ("POST", "/email/fusionauth_resend"),
    ("POST", "/calendar/events/create-confirmed"),
    ("POST", "/events"),
    ("PATCH", "/events/{id}"),
    ("DELETE", "/events/{id}"),
    ("POST", "/events/{id}/copy"),
    ("POST", "/events/{id}/guests"),
    ("PUT", "/events/{id}/rsvp"),
    ("POST", "/events/{id}/replacement"),
    ("POST", "/replacements/{id}/confirm"),
    ("PUT", "/join-requests/{id}"),
    ("POST", "/calendar-events/{id}/join-requests"),
    ("POST", "/scheduling/bookings/{id}/change"),
    ("POST", "/scheduling/links"),
    ("PUT", "/team-sharing"),
    ("POST", "/messages/{type}/{id}"),
    ("PATCH", "/messages/{type}/{id}/items/{id}"),
    ("POST", "/messages/{type}/{id}/items/{id}/reactions"),
    ("PATCH", "/messages/{type}/{id}/threads/{id}"),
    ("POST", "/messages/{type}/{id}/typing"),
    ("POST", "/channels"),
    ("POST", "/channels/activity"),
    ("POST", "/channels/get_or_create_dm"),
    ("POST", "/channels/get_or_create_private"),
    ("POST", "/channels/mentions"),
    ("POST", "/channels/{id}/shares"),
    ("POST", "/channels/{id}/participants"),
    ("POST", "/channels/{id}/bots"),
    ("POST", "/channels/{id}/bots/scoped"),
    ("POST", "/channels/{id}/webhook"),
    ("PUT", "/channels/{id}/access-requests/mine"),
    ("POST", "/channels/{id}/access-requests/{id}/resolve"),
    ("POST", "/external-chats"),
    ("POST", "/external-chats/{id}/sends"),
    ("POST", "/external-chats/{id}/delivery"),
    ("POST", "/external-chats/{id}/messages/attachments"),
    ("POST", "/agent-sessions"),
    ("POST", "/agent-sessions/warm"),
    ("POST", "/agent-sessions/{id}/app-connections"),
    ("POST", "/agent-sessions/{id}/control"),
    ("PUT", "/agent-sessions/{id}/queue/{id}"),
    ("POST", "/agent-sessions/{id}/queue/{id}/steer"),
    ("POST", "/agent-sessions/{id}/tool-approvals/{id}"),
    ("POST", "/agent-sessions/{id}/reviews/{id}"),
    ("PATCH", "/agent-sessions/{id}/permissions"),
    ("POST", "/chats/{id}/tool/call"),
    ("POST", "/chats/{id}/tool/update"),
    ("POST", "/chats/{id}/tool/response/update"),
    ("POST", "/agents"),
    ("PUT", "/agents/{id}"),
    ("PATCH", "/agents/{id}"),
    ("PUT", "/agents/{id}/api-key"),
    ("DELETE", "/agents/{id}/api-key"),
    ("POST", "/bots"),
    ("PATCH", "/bots/{id}"),
    ("DELETE", "/bots/{id}"),
    ("POST", "/bots/{id}/tokens"),
    ("DELETE", "/bots/{id}/tokens/{id}"),
    ("POST", "/harness-pairings/{id}/approve"),
    ("PATCH", "/harnesses/{id}"),
    ("DELETE", "/harnesses/{id}"),
    ("PUT", "/harnesses/{id}/team-access"),
    ("POST", "/harnesses/{id}/claude-sign-in"),
    ("POST", "/harnesses/{id}/claude-sign-in/complete"),
    ("POST", "/harnesses/{id}/claude-sign-out"),
    ("PATCH", "/external-chats/{id}/permissions"),
    ("PATCH", "/crm/pipelines/{id}/permissions"),
    ("PATCH", "/databases/{id}/permissions"),
    ("PATCH", "/forms/{id}/permissions"),
    ("PUT", "/entities/{type}/{id}/direct-access/{id}"),
    ("DELETE", "/entities/{type}/{id}/direct-access/{id}"),
    ("PUT", "/entities/{type}/{id}/access-requests/mine"),
    ("POST", "/entities/{type}/{id}/access-requests/{id}/resolve"),
    ("POST", "/agent-conversations/{id}/{id}/start-fresh"),
    ("POST", "/agent-conversations/{id}/{id}/turns/{id}/retry"),
    (
        "POST",
        "/agent-sessions/{id}/code-executions/{id}/connected-apps/{id}/{id}/calls",
    ),
    (
        "POST",
        "/agent-sessions/{id}/code-executions/{id}/connected-apps/servers",
    ),
    ("POST", "/call/{id}"),
    ("POST", "/call/meetings"),
    ("PATCH", "/call/meetings/{id}"),
    ("POST", "/call/meetings/invite/{id}"),
    ("POST", "/call/meetings/invite/{id}/users"),
    ("POST", "/call/record/{id}/link"),
    ("POST", "/call/record/{id}/share-with-team/toggle"),
    ("POST", "/call/guest-chat/{id}"),
    ("POST", "/call/guest-chat/{id}/messages"),
    ("PATCH", "/call/guest-chat/{id}/messages/{id}"),
    ("POST", "/call/guest-chat/{id}/messages/{id}/reactions"),
    ("POST", "/documents/{id}/comments/text"),
    ("PUT", "/documents/{id}/team_share"),
    ("PUT", "/crm/pipelines/{id}/sharing"),
    ("PUT", "/passwords/teams/{id}/items/{id}/share"),
    ("PUT", "/databases/{id}/awareness"),
    ("POST", "/databases/{id}/webhooks"),
    ("POST", "/webhook/webhooks"),
    ("POST", "/webhook/webhooks/{id}/validate"),
    ("POST", "/team/invite"),
    ("POST", "/team/invite-link"),
    ("POST", "/team/domain-notice"),
    ("POST", "/referral/send"),
    ("POST", "/mobile-welcome-email"),
    ("POST", "/gtm-invite/links"),
    ("POST", "/scheduled-actions"),
    ("PUT", "/scheduled-actions/{id}"),
    ("PUT", "/scheduled-actions/{id}/enabled"),
    ("POST", "/scheduled-actions/{id}/execute"),
    ("PUT", "/scheduled-actions/{id}/template"),
    ("POST", "/scheduled-actions/{id}/template/activate"),
    ("POST", "/call/record/{id}/decline"),
    ("POST", "/call/ring-status/{id}/decline"),
    ("POST", "/call/record/{id}/join"),
    ("POST", "/call/record/{id}/leave"),
    ("DELETE", "/call/{id}"),
    ("DELETE", "/call/meetings/{id}"),
    ("POST", "/call/join/{id}"),
    ("POST", "/call/join/{id}/leave"),
    ("POST", "/call/meetings/join/{id}"),
    ("POST", "/call/{id}/transcript"),
    ("POST", "/channels/{id}/join"),
    ("POST", "/channels/join/{id}"),
    ("POST", "/channels/{id}/leave"),
    ("DELETE", "/channels/{id}/participants"),
    ("PATCH", "/channels/{id}"),
    ("DELETE", "/channels/{id}"),
    ("PUT", "/channels/{id}/profile_picture"),
    ("POST", "/databases/webhooks/{id}"),
    ("PUT", "/crm/email-privacy"),
    ("POST", "/team/auto-join-domain/toggle"),
    ("PUT", "/scheduling/links/{id}"),
    ("PUT", "/scheduling/settings"),
    ("POST", "/github_pull_requests/draft"),
    ("POST", "/mcp/servers"),
];

/// Requests a generation session may make besides reads by method: its own
/// tools and drafting email. Paths as the SDK sends them, `{…}` one segment.
const GENERATION_WRITES: &[(&str, &str)] = &[
    ("POST", "/suggestions"),
    ("PATCH", "/suggestions/{id}"),
    ("POST", "/suggestions/{id}/retire"),
    ("PUT", "/suggestions/{id}/draft"),
    ("POST", "/scheduled-actions/suggestions"),
    ("POST", "/scheduled-actions/suggestions/{id}/retire"),
    ("POST", "/email/drafts"),
    // Tool free only: the route refuses a generation session tools.
    ("POST", "/structured-completion"),
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
            Self::NoSend => "no_send",
        }
    }

    /// The scope stored as `name`, if it is one.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "generation" => Some(Self::Generation),
            "no_send" => Some(Self::NoSend),
            _ => None,
        }
    }

    /// The requests that reach someone else, which a run that sends
    /// nothing never makes.
    pub fn sends() -> &'static [(&'static str, &'static str)] {
        SENDS
    }

    /// Whether a request with `method` to `path` is inside the scope. Reads
    /// by method always are. A generation session makes other requests only
    /// on its list or [`POST_READS`]; a run that sends nothing makes any but
    /// the ones that reach someone else. `path` may carry one service prefix
    /// before the SDK's path. Credentials are not decided here: a scoped
    /// credential is a `ScopedMacroApiJwt`, which `AccountHolderOrInternal`
    /// refuses on every route that issues one.
    pub fn allows(self, method: &str, path: &str) -> bool {
        if reads_by_method(method) {
            return true;
        }
        match self {
            Self::Generation => {
                listed(GENERATION_WRITES, method, path) || listed(POST_READS, method, path)
            }
            Self::NoSend => !listed(SENDS, method, path),
        }
    }
}

/// The scope a credential signs (`agent_scope`), for a service that has no
/// database to look its correlation up in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignedScope {
    /// The credential signs no scope.
    Unscoped,
    /// A scope this build knows.
    Known(SessionScope),
    /// A name this build doesn't know, signed by a newer harness: only reads
    /// by method are inside it.
    Unknown,
}

impl SignedScope {
    /// The scope signed as `claim`.
    pub fn from_claim(claim: Option<&str>) -> Self {
        match claim {
            None => Self::Unscoped,
            Some(name) => SessionScope::parse(name).map_or(Self::Unknown, Self::Known),
        }
    }

    /// Whether a request with `method` to `path` is inside the signed scope.
    pub fn allows(self, method: &str, path: &str) -> bool {
        match self {
            Self::Unscoped => true,
            Self::Known(scope) => scope.allows(method, path),
            Self::Unknown => reads_by_method(method),
        }
    }

    /// The signed scope, if it is one this build knows.
    pub fn known(self) -> Option<SessionScope> {
        match self {
            Self::Known(scope) => Some(scope),
            Self::Unscoped | Self::Unknown => None,
        }
    }
}

/// Requests whose method says they only read.
fn reads_by_method(method: &str) -> bool {
    matches!(method, "GET" | "HEAD" | "OPTIONS")
}

/// Whether `list` holds a request with `method` whose template `path` matches.
fn listed(list: &[(&str, &str)], method: &str, path: &str) -> bool {
    list.iter()
        .any(|(listed, template)| *listed == method && matches(path, template))
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
