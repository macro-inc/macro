//! Metadata needed to present a searchable session without loading its ACP log.

use std::{future::Future, pin::Pin};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use crate::domain::error::Result;

/// Current metadata for an agent-session search result.
#[derive(Debug, Clone)]
pub struct AgentSessionSearchMetadata {
    /// Session identity.
    pub id: Uuid,
    /// User-facing name.
    pub name: String,
    /// Session owner.
    pub owner_id: MacroUserIdStr<'static>,
    /// Agent persona identity.
    pub bot_id: Uuid,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last metadata update.
    pub updated_at: DateTime<Utc>,
}

/// Repository capability for metadata belonging to sessions already authorized
/// by the caller's owning access boundary.
pub trait AgentSessionSearchMetadataRepo: Send + Sync + 'static {
    /// Fetch the current presentation metadata for the supplied session IDs.
    fn search_metadata(
        &self,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<AgentSessionSearchMetadata>>> + Send;
}

/// Agent-session use case for reading search-result presentation metadata.
///
/// Search callers must first resolve authorization. This service deliberately
/// accepts only that resulting allowlist and never loads ACP logs.
pub trait AgentSessionSearchMetadataService: Send + Sync + 'static {
    /// Fetch current metadata for an already-authorized allowlist.
    fn search_metadata(
        &self,
        ids: Vec<Uuid>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<AgentSessionSearchMetadata>>> + Send + '_>>;
}

/// Default implementation of [`AgentSessionSearchMetadataService`].
#[derive(Clone)]
pub struct AgentSessionSearchMetadataServiceImpl<R>(pub R);

impl<R> AgentSessionSearchMetadataServiceImpl<R> {
    /// Create the service from its persistence port.
    pub fn new(repo: R) -> Self {
        Self(repo)
    }
}

impl<R> AgentSessionSearchMetadataService for AgentSessionSearchMetadataServiceImpl<R>
where
    R: AgentSessionSearchMetadataRepo,
{
    fn search_metadata(
        &self,
        ids: Vec<Uuid>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<AgentSessionSearchMetadata>>> + Send + '_>> {
        Box::pin(async move { self.0.search_metadata(&ids).await })
    }
}
