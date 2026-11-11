//! Domain models for agent workspace repos.

use std::pin::Pin;

use bytes::Bytes;
use chrono::{DateTime, Utc};
use futures::Stream;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

pub use agent_credentials::{RepoToken, RepoTokenHash};

/// A stored agent repo.
#[derive(Debug, Clone)]
pub struct AgentRepo {
    /// The agent's Macro user; also the repo's identity.
    pub agent_user_id: MacroUserIdStr<'static>,
    /// The team whose admins may read the repo.
    pub team_id: Uuid,
    /// Hash of the repo token.
    pub token_hash: RepoTokenHash,
    /// Size when last measured, before a push.
    pub size_bytes: Option<u64>,
    /// When the repo was created.
    pub created_at: DateTime<Utc>,
    /// When a push was last accepted.
    pub last_push_at: Option<DateTime<Utc>>,
}

/// A repo created or re-keyed by [`crate::domain::ports::AgentGitService::create_repo`].
#[derive(Debug, Clone)]
pub struct CreatedRepo {
    /// The agent's Macro user.
    pub agent_user_id: MacroUserIdStr<'static>,
    /// The new token; this is the only time it is readable.
    pub token: RepoToken,
}

/// Who is asking for a repo.
#[derive(Debug, Clone)]
pub enum GitCredential {
    /// A repo token (HTTP Basic password).
    RepoToken(RepoToken),
    /// A Macro user authenticated by session, JWT, or API key.
    User(MacroUserIdStr<'static>),
}

/// What a request does to the repo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitAccess {
    /// Clone or fetch.
    Read,
    /// Push.
    Push,
}

/// The two smart-HTTP git services.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr)]
pub enum GitService {
    /// Clone and fetch.
    #[strum(serialize = "git-upload-pack")]
    UploadPack,
    /// Push.
    #[strum(serialize = "git-receive-pack")]
    ReceivePack,
}

/// A smart-HTTP endpoint of one repo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitEndpoint {
    /// `GET info/refs?service=…`: the ref advertisement.
    InfoRefs(GitService),
    /// `POST git-upload-pack` or `POST git-receive-pack`.
    Rpc(GitService),
}

impl GitEndpoint {
    /// The access the endpoint needs.
    pub fn access(self) -> GitAccess {
        let service = match self {
            GitEndpoint::InfoRefs(service) | GitEndpoint::Rpc(service) => service,
        };

        match service {
            GitService::UploadPack => GitAccess::Read,
            GitService::ReceivePack => GitAccess::Push,
        }
    }
}

/// A streamed request or response body.
pub type GitBody = Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>>;

/// A smart-HTTP request, stripped of transport.
pub struct GitRequest {
    /// The endpoint.
    pub endpoint: GitEndpoint,
    /// `Content-Type` of the body.
    pub content_type: Option<String>,
    /// `Content-Encoding` of the body (git gzips large fetch requests).
    pub content_encoding: Option<String>,
    /// `Git-Protocol` header (protocol v2 negotiation).
    pub git_protocol: Option<String>,
    /// The request body.
    pub body: GitBody,
}

/// The backend's answer.
pub struct GitResponse {
    /// HTTP status code.
    pub status: u16,
    /// Response headers.
    pub headers: Vec<(String, String)>,
    /// The response body.
    pub body: GitBody,
}

/// A repo the caller has been authorized for, at an access level.
///
/// Only the domain service constructs it; backends take it as proof.
#[derive(Debug, Clone)]
pub struct AuthorizedRepo {
    agent_user_id: MacroUserIdStr<'static>,
    access: GitAccess,
    max_input_size: Option<u64>,
}

impl AuthorizedRepo {
    pub(crate) fn new(
        agent_user_id: MacroUserIdStr<'static>,
        access: GitAccess,
        max_input_size: Option<u64>,
    ) -> Self {
        Self {
            agent_user_id,
            access,
            max_input_size,
        }
    }

    /// The repo.
    pub fn agent_user_id(&self) -> &MacroUserIdStr<'static> {
        &self.agent_user_id
    }

    /// Remaining push bytes, enforced again by git after unpacking the stream.
    pub fn max_input_size(&self) -> Option<u64> {
        self.max_input_size
    }

    /// The granted access.
    pub fn access(&self) -> GitAccess {
        self.access
    }
}

/// Per-repo limits.
#[derive(Debug, Clone, Copy)]
pub struct RepoLimits {
    /// Pushes are rejected once the repo reaches this size; one push may not
    /// carry more than the remaining room.
    pub max_repo_size_bytes: u64,
}

/// Errors from the agent git domain.
#[derive(Debug, thiserror::Error)]
pub enum AgentGitError {
    /// No repo for this agent.
    #[error("no workspace repo for this agent")]
    NotFound,
    /// The repo token did not match.
    #[error("invalid repo token")]
    InvalidToken,
    /// Authenticated, but not allowed this access.
    #[error("not allowed to {0:?} this repo")]
    Forbidden(GitAccess),
    /// The agent already has a repo for a different team.
    #[error("the agent's repo belongs to another team")]
    TeamMismatch,
    /// The repo is at its size cap.
    #[error("repo is {size_bytes} bytes, at its {limit_bytes}-byte limit")]
    RepoTooLarge {
        /// Measured size.
        size_bytes: u64,
        /// The cap.
        limit_bytes: u64,
    },
    /// Receive-pack does not accept content encodings.
    #[error("content encoding is not supported for pushes")]
    EncodedPush,
    /// Too many pushes in the current window.
    #[error("too many pushes; retry in a minute")]
    PushRateLimited,
    /// `main` has no readable `config/voice.json`.
    #[error("the agent's repo has no valid config/voice.json")]
    NoVoice,
    /// Anything else.
    #[error("internal error: {0}")]
    Internal(rootcause::Report),
}
