//! User-scoped batched share provenance query for Drive's Shared with me view.

use std::sync::Arc;

use async_graphql::{Context, Enum, ErrorExtensions, ID, InputObject, SimpleObject};
use async_trait::async_trait;
use entity_access::domain::{
    models::{
        AccessError, EntityShareProvenance, MAX_SHARE_PROVENANCE_ENTITIES, ShareProvenanceKind,
    },
    ports::EntityShareProvenanceLookup,
};
use graphql_common::{GraphqlEntityType, parse_id};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

/// How an entity was shared with the authenticated viewer.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum GraphqlShareProvenanceKind {
    /// Shared directly with the viewer (explicit user grant or `@mention`).
    Direct,
    /// Shared inside a direct-message conversation.
    Dm,
    /// Shared inside a public, private, or team channel.
    Channel,
    /// Shared with a team the viewer belongs to.
    Team,
}

impl From<ShareProvenanceKind> for GraphqlShareProvenanceKind {
    fn from(kind: ShareProvenanceKind) -> Self {
        match kind {
            ShareProvenanceKind::Direct => Self::Direct,
            ShareProvenanceKind::Dm => Self::Dm,
            ShareProvenanceKind::Channel => Self::Channel,
            ShareProvenanceKind::Team => Self::Team,
        }
    }
}

/// Entity reference requested for share-provenance lookup.
#[derive(InputObject, Clone)]
pub struct ShareProvenanceEntityInput {
    /// Canonical entity type.
    pub entity_type: GraphqlEntityType,
    /// Canonical entity UUID.
    pub entity_id: ID,
}

/// Viewer-relative share provenance for one requested entity.
///
/// Embedded value object (no global `id`) scoped to the authenticated viewer.
#[derive(SimpleObject, Clone)]
pub struct GraphqlEntityShareProvenance {
    /// Canonical entity type.
    pub entity_type: GraphqlEntityType,
    /// Canonical entity UUID.
    pub entity_id: ID,
    /// Highest-priority share provenance category for the viewer.
    pub kind: GraphqlShareProvenanceKind,
    /// Originating channel ID when `kind` is `DM` or `CHANNEL`.
    pub channel_id: Option<ID>,
    /// Originating channel name when `kind` is `CHANNEL` and named.
    pub channel_name: Option<String>,
    /// Originating team ID when `kind` is `TEAM`.
    pub team_id: Option<ID>,
    /// Originating team name when `kind` is `TEAM`.
    pub team_name: Option<String>,
}

impl From<EntityShareProvenance> for GraphqlEntityShareProvenance {
    fn from(entry: EntityShareProvenance) -> Self {
        Self {
            entity_type: GraphqlEntityType::new(entry.entity_type),
            entity_id: ID(entry.entity_id.to_string()),
            kind: entry.kind.into(),
            channel_id: entry.channel_id.map(|id| ID(id.to_string())),
            channel_name: entry.channel_name,
            team_id: entry.team_id.map(|id| ID(id.to_string())),
            team_name: entry.team_name,
        }
    }
}

/// Error returned while resolving viewer-relative share provenance for GraphQL.
#[derive(Debug, thiserror::Error)]
pub enum ShareProvenanceQueryError {
    /// Caller sent an invalid request or exceeded batch limits.
    #[error("{0}")]
    BadRequest(&'static str),
    /// Underlying domain or storage failure.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

/// Resolves viewer-relative share provenance for a bounded batch of entities.
#[async_trait]
pub trait ShareProvenanceQueryReader: Send + Sync {
    /// Look up how each entity was shared with `user_id`.
    async fn get_entities_share_provenance<'a>(
        &'a self,
        user_id: &'a MacroUserIdStr<'static>,
        entities: &'a [(Uuid, EntityType)],
    ) -> Result<Vec<EntityShareProvenance>, ShareProvenanceQueryError>;
}

/// Request-scoped share provenance reader inserted into GraphQL context by the host.
#[derive(Clone)]
pub struct ShareProvenanceQuery(Arc<dyn ShareProvenanceQueryReader>);

impl ShareProvenanceQuery {
    /// Wrap any share-provenance reader for GraphQL request data.
    pub fn new(reader: impl ShareProvenanceQueryReader + 'static) -> Self {
        Self(Arc::new(reader))
    }

    /// Wrap an [`EntityShareProvenanceLookup`] domain service directly.
    pub fn from_lookup<L>(lookup: Arc<L>) -> Self
    where
        L: EntityShareProvenanceLookup + 'static,
    {
        Self::new(EntityAccessShareProvenanceReader(lookup))
    }

    /// Empty reader used by SDL export and schema-only tests.
    pub fn noop() -> Self {
        Self::new(NoOpShareProvenanceQueryReader)
    }
}

/// Adapts an [`EntityShareProvenanceLookup`] domain service into [`ShareProvenanceQueryReader`].
struct EntityAccessShareProvenanceReader<L>(Arc<L>);

#[async_trait]
impl<L> ShareProvenanceQueryReader for EntityAccessShareProvenanceReader<L>
where
    L: EntityShareProvenanceLookup,
{
    async fn get_entities_share_provenance<'a>(
        &'a self,
        user_id: &'a MacroUserIdStr<'static>,
        entities: &'a [(Uuid, EntityType)],
    ) -> Result<Vec<EntityShareProvenance>, ShareProvenanceQueryError> {
        self.0
            .get_entities_share_provenance(&user_id.0, entities)
            .await
            .map_err(|error| match error {
                AccessError::BadRequest(msg) => ShareProvenanceQueryError::BadRequest(msg),
                other => ShareProvenanceQueryError::Internal(anyhow::Error::from(other)),
            })
    }
}

/// No-op share-provenance reader that always returns an empty list.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpShareProvenanceQueryReader;

#[async_trait]
impl ShareProvenanceQueryReader for NoOpShareProvenanceQueryReader {
    async fn get_entities_share_provenance<'a>(
        &'a self,
        _user_id: &'a MacroUserIdStr<'static>,
        _entities: &'a [(Uuid, EntityType)],
    ) -> Result<Vec<EntityShareProvenance>, ShareProvenanceQueryError> {
        Ok(Vec::new())
    }
}

/// Resolve `user.shareProvenance` from GraphQL request data.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn resolve_share_provenance(
    ctx: &Context<'_>,
    user_id: &MacroUserIdStr<'static>,
    entities: Vec<ShareProvenanceEntityInput>,
) -> async_graphql::Result<Vec<GraphqlEntityShareProvenance>> {
    if entities.len() > MAX_SHARE_PROVENANCE_ENTITIES {
        return Err(async_graphql::Error::new(format!(
            "at most {MAX_SHARE_PROVENANCE_ENTITIES} entities may be requested at once"
        ))
        .extend_with(|_, ext| ext.set("code", "BAD_USER_INPUT")));
    }
    if entities.is_empty() {
        return Ok(Vec::new());
    }

    let mut parsed = Vec::with_capacity(entities.len());
    for entry in entities {
        let entity_type = entry.entity_type.into_model()?;
        let entity_id = parse_id(entry.entity_id, "entityId")?;
        parsed.push((entity_id, entity_type));
    }

    let ShareProvenanceQuery(reader) = ctx.data::<ShareProvenanceQuery>().map_err(|error| {
        tracing::error!(error = ?error, "share provenance reader missing from GraphQL context");
        async_graphql::Error::new("share provenance is unavailable")
            .extend_with(|_, ext| ext.set("code", "UNAVAILABLE"))
    })?;

    let entries = reader
        .get_entities_share_provenance(user_id, &parsed)
        .await
        .map_err(|error| match error {
            ShareProvenanceQueryError::BadRequest(msg) => async_graphql::Error::new(msg)
                .extend_with(|_, ext| ext.set("code", "BAD_USER_INPUT")),
            ShareProvenanceQueryError::Internal(error) => {
                tracing::error!(error = ?error, "failed to resolve viewer share provenance");
                async_graphql::Error::new("share provenance is unavailable")
                    .extend_with(|_, ext| ext.set("code", "UNAVAILABLE"))
            }
        })?;

    Ok(entries.into_iter().map(Into::into).collect())
}
