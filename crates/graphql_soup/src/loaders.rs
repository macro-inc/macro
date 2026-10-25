//! DataLoader-backed hydration of lightweight realtime Soup patches and
//! single-entity lookups. Email threads hydrate through entity access
//! receipts, the rule the REST thread route applies, so a thread shared by a
//! team's CRM or a project resolves for the viewer even though it lives in a
//! teammate's inbox; every other entity hydrates through one filtered Soup
//! request per user.

#[cfg(test)]
mod test;

use std::{
    collections::{HashMap, HashSet},
    future::Future,
    sync::Arc,
};

use async_graphql::dataloader::{DataLoader, Loader};
use email::domain::{
    models::{PreviewView, PreviewViewStandardLabel},
    ports::EmailThreadPreviewService,
};
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, MemberTeamRole},
    ports::EntityAccessService,
};
use filter_ast::Expr;
use futures::{
    future::BoxFuture,
    future::{try_join, try_join_all},
};
use item_filters::ast::{
    EmailFilterAst, EntityFilterAst,
    agent_session::AgentSessionLiteral,
    calendar_event::CalendarEventLiteral,
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    chat::ChatLiteral,
    crm_company::CrmCompanyLiteral,
    crm_contact::CrmContactLiteral,
    database_row::DatabaseRowLiteral,
    document::DocumentLiteral,
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
    initiative::InitiativeLiteral,
    project::ProjectLiteral,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use models_pagination::SimpleSortMethod;
use models_soup::{email_thread::SoupEnrichedEmailThreadPreview, item::SoupItem};
use rootcause::{
    Report,
    markers::{Cloneable, Dynamic},
};
use soup::domain::{
    models::{SoupProjectionHydration, SoupQuery, SoupRequest, SoupSortDirection, SoupType},
    ports::SoupService,
};
use uuid::Uuid;

/// Maximum number of entity keys folded into one user-scoped Soup request.
const MAX_BATCH_SIZE: usize = 500;

/// Key used to hydrate one Soup item for one viewer.
pub type SoupItemLoaderKey = (MacroUserIdStr<'static>, Entity<'static>);

/// Cloneable error returned by the realtime Soup item loader.
pub type SoupItemLoaderError = Report<Dynamic, Cloneable>;

/// Hydrates the email threads a viewer may read.
pub trait SoupEmailThreadReader: Send + Sync + 'static {
    /// Return the preview of each requested thread that `user_id` may view.
    /// A thread the viewer cannot read, or that does not exist, is absent.
    fn read_threads(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
    ) -> impl Future<Output = Result<Vec<SoupEnrichedEmailThreadPreview<()>>, SoupItemLoaderError>> + Send;
}

/// Thread reader that settles access through the entity access service, the
/// rule the REST thread route applies, and hydrates through the email domain.
pub struct EntityAccessEmailThreadReader<E, A> {
    /// Shared email service that renders the authorized threads.
    email_service: Arc<E>,
    /// Access service that mints the view receipts.
    access: A,
}

impl<E, A> EntityAccessEmailThreadReader<E, A> {
    /// Construct a thread reader from the shared email and access services.
    pub fn new(email_service: Arc<E>, access: A) -> Self {
        Self {
            email_service,
            access,
        }
    }
}

impl<E, A> SoupEmailThreadReader for EntityAccessEmailThreadReader<E, A>
where
    E: EmailThreadPreviewService,
    A: EntityAccessService,
{
    #[tracing::instrument(
        name = "soup.hydrate_email_threads",
        skip_all,
        fields(thread_count = thread_ids.len())
    )]
    async fn read_threads(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
    ) -> Result<Vec<SoupEnrichedEmailThreadPreview<()>>, SoupItemLoaderError> {
        let ids = thread_ids.iter().map(Uuid::to_string).collect::<Vec<_>>();
        let results = self
            .access
            .generate_email_thread_view_access_receipts(&user_id, None, &ids)
            .await;
        let mut receipts = Vec::with_capacity(results.len());
        for (thread_id, result) in results {
            match result {
                Ok(receipt) => receipts.push(receipt),
                Err(
                    AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::NotFound(_),
                ) => {}
                Err(error) => {
                    return Err(rootcause::report!(
                        "email thread {thread_id} access check failed: {error}"
                    )
                    .into_cloneable());
                }
            }
        }
        if receipts.is_empty() {
            return Ok(Vec::new());
        }
        let previews = self
            .email_service
            .get_email_thread_previews_by_receipts(user_id, receipts)
            .await
            .map_err(|error| rootcause::report!(error).into_dynamic().into_cloneable())?;
        Ok(previews.into_iter().map(Into::into).collect())
    }
}

/// Resolves a viewer's current team capability for source-scoped PR hydration.
pub trait SoupTeamReader: Send + Sync + 'static {
    /// Recheck membership on each batch, so a long-lived socket cannot retain removed access.
    fn team_receipt(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> BoxFuture<'_, Result<Option<EntityAccessReceipt<MemberTeamRole>>, SoupItemLoaderError>>;
}

/// Reads current team capabilities through the entity access service.
struct EntityAccessTeamReader<A>(A);
impl<A: EntityAccessService> SoupTeamReader for EntityAccessTeamReader<A> {
    fn team_receipt(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> BoxFuture<'_, Result<Option<EntityAccessReceipt<MemberTeamRole>>, SoupItemLoaderError>>
    {
        Box::pin(async move {
            let team = self
                .0
                .get_user_team(&user)
                .await
                .map_err(|error| rootcause::report!(error).into_dynamic().into_cloneable())?;
            let Some(team) = team else {
                return Ok(None);
            };
            self.0
                .generate_entity_access_receipt::<MemberTeamRole>(
                    &user,
                    None,
                    &team.team_id.to_string(),
                    EntityType::Team,
                )
                .await
                .map(Some)
                .map_err(|error| rootcause::report!(error).into_dynamic().into_cloneable())
        })
    }
}

/// Batches lightweight entity patches per user: email threads through the
/// access-checked thread reader, every other entity through one filtered Soup
/// request.
pub struct SoupItemLoader<S, R> {
    /// Existing Soup query service.
    soup_service: S,
    /// Reader used only when a batch requests email threads.
    thread_reader: R,
    /// Optional reader for current team access during PR and session hydration.
    team_reader: Option<Arc<dyn SoupTeamReader>>,
}

impl<S, R> SoupItemLoader<S, R> {
    /// Construct a Soup item loader from its existing domain services.
    pub fn new(soup_service: S, thread_reader: R) -> Self {
        Self {
            soup_service,
            thread_reader,
            team_reader: None,
        }
    }
}

impl<S, R> SoupItemLoader<S, R>
where
    S: SoupService,
    R: SoupEmailThreadReader,
{
    /// Hydrate one user's portion of a batch.
    async fn load_user(
        &self,
        user_id: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<SoupItemLoaderKey, SoupProjectionHydration>, SoupItemLoaderError> {
        let requested = entities.iter().cloned().collect::<HashSet<_>>();
        let mut thread_ids = Vec::new();
        let mut soup_entities = Vec::new();
        for entity in entities {
            if entity.entity_type == EntityType::EmailThread {
                thread_ids.push(entity_uuid(&entity)?);
            } else {
                soup_entities.push(entity);
            }
        }

        let threads = async {
            if thread_ids.is_empty() {
                return Ok(Vec::new());
            }
            self.thread_reader
                .read_threads(user_id.clone(), thread_ids)
                .await
        };
        let (threads, items) = try_join(
            threads,
            self.load_soup_items(user_id.clone(), soup_entities),
        )
        .await?;

        let hydrations = threads
            .into_iter()
            .map(|thread| SoupProjectionHydration {
                item: SoupItem::EmailThread(thread),
                document_server_facts: None,
            })
            .chain(items);
        let mut loaded = HashMap::with_capacity(requested.len());
        for hydration in hydrations {
            let entity = hydration.item.entity();
            if !requested.contains(&entity) {
                return Err(rootcause::report!(
                    "filtered Soup request returned unrequested entity {} {}",
                    entity.entity_type,
                    entity.entity_id
                )
                .into_cloneable());
            }
            if loaded
                .insert((user_id.clone(), entity.clone()), hydration)
                .is_some()
            {
                return Err(rootcause::report!(
                    "filtered Soup request returned duplicate entity {} {}",
                    entity.entity_type,
                    entity.entity_id
                )
                .into_cloneable());
            }
        }

        Ok(loaded)
    }

    /// Execute one filtered Soup request for the non-email entities of a batch.
    async fn load_soup_items(
        &self,
        user_id: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> Result<Vec<SoupProjectionHydration>, SoupItemLoaderError> {
        if entities.is_empty() {
            return Ok(Vec::new());
        }
        // CRM records are team-scoped: Soup skips them without the viewer's team.
        let needs_team = entities.iter().any(|entity| {
            matches!(
                entity.entity_type,
                EntityType::ForeignEntity
                    | EntityType::AgentSession
                    | EntityType::CrmCompany
                    | EntityType::CrmContact
            )
        });
        let team = match (&self.team_reader, needs_team) {
            (Some(reader), true) => reader.team_receipt(user_id.clone()).await?,
            _ => None,
        };
        let filter = entity_filter_ast(&entities)?;
        let limit = u16::try_from(entities.len())
            .unwrap_or(MAX_BATCH_SIZE as u16)
            .clamp(1, MAX_BATCH_SIZE as u16);
        let request = SoupRequest {
            soup_type: SoupType::Expanded,
            limit,
            cursor: SoupQuery::new_sort_simple(SimpleSortMethod::UpdatedAt, filter),
            // Batch entity load — order is irrelevant, the caller re-keys by id.
            sort_direction: SoupSortDirection::default(),
            user: user_id,
            email_preview_view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
            // Email threads hydrate through the thread reader, so the request
            // carries no inbox scope and Soup's email leg stays off.
            link_ids: Vec::new(),
        };

        Ok(self
            .soup_service
            .get_user_soup_with_projection(request, team)
            .await
            .map_err(|error| rootcause::report!(error).into_dynamic().into_cloneable())?
            .into_items())
    }
}

impl<S, R> SoupItemLoader<S, R>
where
    S: SoupService,
    R: SoupEmailThreadReader,
{
    /// Partition keys by user and hydrate each user's keys in one pass.
    async fn load_keys(
        &self,
        keys: Vec<SoupItemLoaderKey>,
    ) -> Result<HashMap<SoupItemLoaderKey, SoupProjectionHydration>, SoupItemLoaderError> {
        let mut entities_by_user = HashMap::<MacroUserIdStr<'static>, Vec<Entity<'static>>>::new();
        for (user_id, entity) in keys {
            entities_by_user.entry(user_id).or_default().push(entity);
        }

        let batches = entities_by_user
            .into_iter()
            .map(|(user_id, entities)| self.load_user(user_id, entities));
        let loaded = try_join_all(batches).await?;
        Ok(loaded.into_iter().flatten().collect())
    }
}

impl<S, R> Loader<SoupItemLoaderKey> for SoupItemLoader<S, R>
where
    S: SoupService,
    R: SoupEmailThreadReader,
{
    type Value = SoupProjectionHydration;
    type Error = SoupItemLoaderError;

    async fn load(
        &self,
        keys: &[SoupItemLoaderKey],
    ) -> Result<HashMap<SoupItemLoaderKey, Self::Value>, Self::Error> {
        self.load_keys(keys.to_vec()).await
    }
}

/// Owned key used only across the type-erased GraphQL context boundary.
#[derive(Clone, Hash, PartialEq, Eq)]
struct OwnedSoupItemLoaderKey {
    /// User whose Soup visibility applies.
    user_id: MacroUserIdStr<'static>,
    /// Entity to hydrate.
    entity: Entity<'static>,
}

impl<S, R> Loader<OwnedSoupItemLoaderKey> for SoupItemLoader<S, R>
where
    S: SoupService,
    R: SoupEmailThreadReader,
{
    type Value = SoupProjectionHydration;
    type Error = SoupItemLoaderError;

    async fn load(
        &self,
        keys: &[OwnedSoupItemLoaderKey],
    ) -> Result<HashMap<OwnedSoupItemLoaderKey, Self::Value>, Self::Error> {
        let tuple_keys = keys
            .iter()
            .map(|key| (key.user_id.clone(), key.entity.clone()))
            .collect();
        let loaded = self.load_keys(tuple_keys).await?;
        Ok(loaded
            .into_iter()
            .map(|((user_id, entity), item)| (OwnedSoupItemLoaderKey { user_id, entity }, item))
            .collect())
    }
}

/// Type-erased function that loads one Soup item through a concrete DataLoader.
type LoadOne = dyn Fn(
        OwnedSoupItemLoaderKey,
    ) -> BoxFuture<'static, Result<Option<SoupProjectionHydration>, SoupItemLoaderError>>
    + Send
    + Sync;

/// Load one statically owned key through a concrete DataLoader.
async fn load_one_owned<S, R>(
    loader: Arc<DataLoader<SoupItemLoader<S, R>>>,
    key: OwnedSoupItemLoaderKey,
) -> Result<Option<SoupProjectionHydration>, SoupItemLoaderError>
where
    S: SoupService,
    R: SoupEmailThreadReader,
{
    loader.load_one::<OwnedSoupItemLoaderKey>(key).await
}

/// Type-erased Soup DataLoader stored in GraphQL request or connection data.
#[derive(Clone)]
pub struct SoupItemDataLoader {
    /// Function backed by the concrete async-graphql DataLoader.
    load_one: Arc<LoadOne>,
}

impl SoupItemDataLoader {
    /// Construct a type-erased DataLoader from a concrete loader implementation.
    pub fn new<S, R>(loader: SoupItemLoader<S, R>) -> Self
    where
        S: SoupService,
        R: SoupEmailThreadReader,
    {
        let loader = Arc::new(DataLoader::new(loader, tokio::spawn).max_batch_size(MAX_BATCH_SIZE));
        // A WebSocket may receive repeated updates for the same entity. Only
        // coalesce concurrent loads; never retain an item across updates.
        loader.enable_all_cache(false);
        Self {
            load_one: Arc::new(move |key| {
                let loader = Arc::clone(&loader);
                Box::pin(load_one_owned(loader, key))
            }),
        }
    }

    /// Load one Soup item for one viewer.
    pub async fn load_one(
        &self,
        key: SoupItemLoaderKey,
    ) -> Result<Option<SoupProjectionHydration>, SoupItemLoaderError> {
        let (user_id, entity) = key;
        (self.load_one)(OwnedSoupItemLoaderKey { user_id, entity }).await
    }
}

/// Primary-backed Soup reader for single agent-session lookups. A session is
/// opened the moment it is created, and its log is read by subscribing first
/// and querying second; both need every committed row, which a replica
/// lagging by seconds does not have. Lists keep the replica-backed reader.
#[derive(Clone)]
pub struct AgentSessionEntityLoader(pub SoupItemDataLoader);

/// Primary-backed Soup reader for reads that must see a write committed
/// moments earlier, before a replica has replayed it: `soupUpdates`
/// hydration, where a replica read returns the pre-write row and the client
/// caches it as current, and `soupEntity`, which opens an entity right after
/// it is created or edited. Lists keep the replica-backed reader.
#[derive(Clone)]
pub struct PrimarySoupItemLoader(pub SoupItemDataLoader);

/// Build the Soup DataLoader from the Soup service and the access-checked
/// email thread reader.
pub fn soup_item_loader<S, E, A>(
    soup_service: S,
    email_service: Arc<E>,
    access: A,
) -> SoupItemDataLoader
where
    S: SoupService,
    E: EmailThreadPreviewService,
    A: EntityAccessService,
{
    SoupItemDataLoader::new(SoupItemLoader::new(
        soup_service,
        EntityAccessEmailThreadReader::new(email_service, access),
    ))
}

/// Build a loader that rechecks team access for PRs and linked session metadata.
pub fn soup_item_loader_with_team_access<S, E, A>(
    soup_service: S,
    email_service: Arc<E>,
    access: A,
) -> SoupItemDataLoader
where
    S: SoupService,
    E: EmailThreadPreviewService,
    A: EntityAccessService,
{
    let mut loader = SoupItemLoader::new(
        soup_service,
        EntityAccessEmailThreadReader::new(email_service, access.clone()),
    );
    loader.team_reader = Some(Arc::new(EntityAccessTeamReader(access)));
    SoupItemDataLoader::new(loader)
}

/// Build an OR tree from literals, falling back to an impossible literal when empty.
fn literal_tree<T>(literals: Vec<T>, impossible: T) -> Arc<Expr<T>> {
    Arc::new(
        literals
            .into_iter()
            .map(Expr::val)
            .reduce(Expr::or)
            .unwrap_or_else(|| Expr::val(impossible)),
    )
}

/// Parse an entity's id, which every Soup-hydrated entity carries as a UUID.
fn entity_uuid(entity: &Entity<'static>) -> Result<Uuid, SoupItemLoaderError> {
    Uuid::parse_str(entity.entity_id.as_ref()).map_err(|error| {
        rootcause::report!(
            "invalid {} entity id {}: {error}",
            entity.entity_type,
            entity.entity_id
        )
        .into_cloneable()
    })
}

/// Encode an exact entity set into all branches of the Soup filter AST.
/// Email threads hydrate through the thread reader and are not accepted here.
fn entity_filter_ast(entities: &[Entity<'static>]) -> Result<EntityFilterAst, SoupItemLoaderError> {
    let mut documents = Vec::new();
    let mut chats = Vec::new();
    let mut projects = Vec::new();
    let mut initiatives = Vec::new();
    let mut channels = Vec::new();
    let mut channel_threads = Vec::new();
    let mut calls = Vec::new();
    let mut crm_companies = Vec::new();
    let mut crm_contacts = Vec::new();
    let mut foreign_entities = Vec::new();
    let mut calendar_events = Vec::new();
    let mut agent_sessions = Vec::new();
    let mut database_rows = Vec::new();

    for entity in entities {
        let id = entity_uuid(entity)?;
        match entity.entity_type {
            EntityType::Document => documents.push(DocumentLiteral::Id(id)),
            EntityType::Chat => chats.push(ChatLiteral::ChatId(id)),
            EntityType::Project => projects.push(ProjectLiteral::ProjectIdSelf(id)),
            EntityType::Initiative => initiatives.push(InitiativeLiteral::Id(id)),
            EntityType::EmailThread => {
                return Err(rootcause::report!(
                    "email threads hydrate through the thread reader, not the Soup request"
                )
                .into_cloneable());
            }
            EntityType::Channel => channels.push(ChannelLiteral::ChannelId(id)),
            EntityType::ChannelMessage => {
                channel_threads.push(ChannelThreadLiteral::ThreadId(id));
            }
            EntityType::Call => calls.push(CallLiteral::CallId(id)),
            EntityType::CrmCompany => crm_companies.push(CrmCompanyLiteral::Id(id)),
            EntityType::CrmContact => crm_contacts.push(CrmContactLiteral::Id(id)),
            EntityType::ForeignEntity => foreign_entities.push(ForeignEntityLiteral::Id(id)),
            EntityType::CalendarEvent => calendar_events.push(CalendarEventLiteral::Id(id)),
            EntityType::AgentSession => agent_sessions.push(AgentSessionLiteral::Id(id)),
            EntityType::DatabaseRow => database_rows.push(DatabaseRowLiteral::Id(id)),
            EntityType::User
            | EntityType::Team
            | EntityType::StaticFile
            | EntityType::Skill
            | EntityType::ScheduledAction
            | EntityType::Reminder
            | EntityType::CrmPipeline
            | EntityType::Database
            | EntityType::Form => {
                return Err(rootcause::report!(
                    "entity type {} is not represented in Soup",
                    entity.entity_type
                )
                .into_cloneable());
            }
        }
    }

    let nil = Uuid::nil();
    Ok(EntityFilterAst {
        favorites_only: None,
        crm_association: None,
        calendar_event_filter: Some(literal_tree(calendar_events, CalendarEventLiteral::Id(nil))),
        document_filter: Some(literal_tree(documents, DocumentLiteral::Id(nil))),
        project_filter: Some(literal_tree(projects, ProjectLiteral::ProjectIdSelf(nil))),
        chat_filter: Some(literal_tree(chats, ChatLiteral::ChatId(nil))),
        // Email threads never ride this request; the impossible id rules
        // Soup's email leg out like every other unrequested branch.
        email_filter: EmailFilterAst {
            tree: Some(Arc::new(Expr::val(EmailLiteral::ThreadId(nil)))),
            crm_scope: None,
        },
        channel_filter: Some(literal_tree(channels, ChannelLiteral::ChannelId(nil))),
        channel_thread_filter: Some(literal_tree(
            channel_threads,
            ChannelThreadLiteral::ThreadId(nil),
        )),
        call_filter: Some(literal_tree(calls, CallLiteral::CallId(nil))),
        crm_company_filter: Some(literal_tree(crm_companies, CrmCompanyLiteral::Id(nil))),
        crm_contact_filter: (!crm_contacts.is_empty())
            .then(|| literal_tree(crm_contacts, CrmContactLiteral::Id(nil))),
        foreign_entity_filter: Some(literal_tree(
            foreign_entities,
            ForeignEntityLiteral::Id(nil),
        )),
        github_pull_request_filter: None,
        agent_session_filter: Some(literal_tree(agent_sessions, AgentSessionLiteral::Id(nil))),
        initiative_filter: Some(literal_tree(initiatives, InitiativeLiteral::Id(nil))),
        database_row_filter: Some(literal_tree(database_rows, DatabaseRowLiteral::Id(nil))),
        properties_filter: None,
    })
}
