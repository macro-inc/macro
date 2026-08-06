//! DataLoader-backed hydration of lightweight realtime Soup patches.

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
    ports::EmailService,
};
use filter_ast::Expr;
use futures::{future::BoxFuture, future::try_join_all};
use item_filters::ast::{
    EmailFilterAst, EntityFilterAst,
    calendar_event::CalendarEventLiteral,
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    chat::ChatLiteral,
    crm_company::CrmCompanyLiteral,
    document::DocumentLiteral,
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
    project::ProjectLiteral,
    reminder::ReminderLiteral,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use models_pagination::SimpleSortMethod;
use models_soup::item::SoupItem;
use rootcause::{
    Report,
    markers::{Cloneable, Dynamic},
};
use soup::domain::{
    models::{SoupQuery, SoupRequest, SoupSortDirection, SoupType},
    ports::SoupService,
};
use uuid::Uuid;

/// Maximum number of entity keys folded into one user-scoped Soup request.
const MAX_BATCH_SIZE: usize = 500;

/// Key used to hydrate one Soup item for one viewer.
pub type SoupItemLoaderKey = (MacroUserIdStr<'static>, Entity<'static>);

/// Cloneable error returned by the realtime Soup item loader.
pub type SoupItemLoaderError = Report<Dynamic, Cloneable>;

/// Resolves the inboxes visible to a user for email-thread Soup hydration.
pub trait SoupInboxReader: Send + Sync + 'static {
    /// Return the IDs of every inbox visible to `user_id`.
    fn get_inbox_ids(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Uuid>, SoupItemLoaderError>> + Send;
}

/// Inbox reader backed by the email domain service.
pub struct EmailServiceInboxReader<E> {
    /// Shared email service used to resolve visible inboxes.
    service: Arc<E>,
}

impl<E> EmailServiceInboxReader<E> {
    /// Construct an inbox reader from the shared email service.
    pub fn new(service: Arc<E>) -> Self {
        Self { service }
    }
}

impl<E> SoupInboxReader for EmailServiceInboxReader<E>
where
    E: EmailService,
{
    async fn get_inbox_ids(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<Uuid>, SoupItemLoaderError> {
        self.service
            .get_inboxes_for_macro_id(user_id)
            .await
            .map(|links| links.into_iter().map(|link| link.id).collect())
            .map_err(|error| rootcause::report!(error).into_dynamic().into_cloneable())
    }
}

/// Batches lightweight entity patches into one filtered Soup request per user.
pub struct SoupItemLoader<S, I> {
    /// Existing Soup query service.
    soup_service: S,
    /// Reader used only when a batch requests email threads.
    inbox_reader: I,
}

impl<S, I> SoupItemLoader<S, I> {
    /// Construct a Soup item loader from its existing domain services.
    pub fn new(soup_service: S, inbox_reader: I) -> Self {
        Self {
            soup_service,
            inbox_reader,
        }
    }
}

impl<S, I> SoupItemLoader<S, I>
where
    S: SoupService,
    I: SoupInboxReader,
{
    /// Execute one filtered Soup request for one user's portion of a batch.
    async fn load_user(
        &self,
        user_id: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<SoupItemLoaderKey, SoupItem<()>>, SoupItemLoaderError> {
        let requested = entities.iter().cloned().collect::<HashSet<_>>();
        let needs_inboxes = entities
            .iter()
            .any(|entity| entity.entity_type == EntityType::EmailThread);
        let link_ids = if needs_inboxes {
            self.inbox_reader.get_inbox_ids(user_id.clone()).await?
        } else {
            Vec::new()
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
            user: user_id.clone(),
            email_preview_view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
            link_ids,
        };

        let items = self
            .soup_service
            .get_user_soup(request, None)
            .await
            .map_err(|error| rootcause::report!(error).into_dynamic().into_cloneable())?
            .either(|page| page.items, |page| page.items);

        let mut loaded = HashMap::with_capacity(items.len());
        for item in items {
            let entity = item.entity();
            if !requested.contains(&entity) {
                return Err(rootcause::report!(
                    "filtered Soup request returned unrequested entity {} {}",
                    entity.entity_type,
                    entity.entity_id
                )
                .into_cloneable());
            }
            if loaded
                .insert((user_id.clone(), entity.clone()), item)
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
}

impl<S, I> SoupItemLoader<S, I>
where
    S: SoupService,
    I: SoupInboxReader,
{
    /// Partition keys by user and execute one Soup request for each user.
    async fn load_keys(
        &self,
        keys: Vec<SoupItemLoaderKey>,
    ) -> Result<HashMap<SoupItemLoaderKey, SoupItem<()>>, SoupItemLoaderError> {
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

impl<S, I> Loader<SoupItemLoaderKey> for SoupItemLoader<S, I>
where
    S: SoupService,
    I: SoupInboxReader,
{
    type Value = SoupItem<()>;
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

impl<S, I> Loader<OwnedSoupItemLoaderKey> for SoupItemLoader<S, I>
where
    S: SoupService,
    I: SoupInboxReader,
{
    type Value = SoupItem<()>;
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
    ) -> BoxFuture<'static, Result<Option<SoupItem<()>>, SoupItemLoaderError>>
    + Send
    + Sync;

/// Load one statically owned key through a concrete DataLoader.
async fn load_one_owned<S, I>(
    loader: Arc<DataLoader<SoupItemLoader<S, I>>>,
    key: OwnedSoupItemLoaderKey,
) -> Result<Option<SoupItem<()>>, SoupItemLoaderError>
where
    S: SoupService,
    I: SoupInboxReader,
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
    fn new<S, I>(loader: SoupItemLoader<S, I>) -> Self
    where
        S: SoupService,
        I: SoupInboxReader,
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
    ) -> Result<Option<SoupItem<()>>, SoupItemLoaderError> {
        let (user_id, entity) = key;
        (self.load_one)(OwnedSoupItemLoaderKey { user_id, entity }).await
    }
}

/// Build the realtime Soup DataLoader from the existing Soup and email services.
pub fn soup_item_loader<S, E>(soup_service: S, email_service: Arc<E>) -> SoupItemDataLoader
where
    S: SoupService,
    E: EmailService,
{
    SoupItemDataLoader::new(SoupItemLoader::new(
        soup_service,
        EmailServiceInboxReader::new(email_service),
    ))
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

/// Encode an exact entity set into all branches of the Soup filter AST.
fn entity_filter_ast(entities: &[Entity<'static>]) -> Result<EntityFilterAst, SoupItemLoaderError> {
    let mut documents = Vec::new();
    let mut chats = Vec::new();
    let mut projects = Vec::new();
    let mut email_threads = Vec::new();
    let mut channels = Vec::new();
    let mut channel_threads = Vec::new();
    let mut calls = Vec::new();
    let mut crm_companies = Vec::new();
    let mut foreign_entities = Vec::new();
    let mut calendar_events = Vec::new();
    let mut reminders = Vec::new();

    for entity in entities {
        let id = Uuid::parse_str(entity.entity_id.as_ref()).map_err(|error| {
            rootcause::report!(
                "invalid {} entity id {}: {error}",
                entity.entity_type,
                entity.entity_id
            )
            .into_cloneable()
        })?;
        match entity.entity_type {
            EntityType::Document => documents.push(DocumentLiteral::Id(id)),
            EntityType::Chat => chats.push(ChatLiteral::ChatId(id)),
            EntityType::Project => projects.push(ProjectLiteral::ProjectIdSelf(id)),
            EntityType::EmailThread => email_threads.push(EmailLiteral::ThreadId(id)),
            EntityType::Channel => channels.push(ChannelLiteral::ChannelId(id)),
            EntityType::ChannelMessage => {
                channel_threads.push(ChannelThreadLiteral::ThreadId(id));
            }
            EntityType::Call => calls.push(CallLiteral::CallId(id)),
            EntityType::CrmCompany => crm_companies.push(CrmCompanyLiteral::Id(id)),
            EntityType::ForeignEntity => foreign_entities.push(ForeignEntityLiteral::Id(id)),
            EntityType::CalendarEvent => calendar_events.push(CalendarEventLiteral::Id(id)),
            EntityType::Reminder => reminders.push(ReminderLiteral::Id(id)),
            EntityType::User
            | EntityType::Team
            | EntityType::StaticFile
            | EntityType::CrmContact => {
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
        calendar_event_filter: Some(literal_tree(calendar_events, CalendarEventLiteral::Id(nil))),
        document_filter: Some(literal_tree(documents, DocumentLiteral::Id(nil))),
        project_filter: Some(literal_tree(projects, ProjectLiteral::ProjectIdSelf(nil))),
        chat_filter: Some(literal_tree(chats, ChatLiteral::ChatId(nil))),
        email_filter: EmailFilterAst {
            tree: Some(literal_tree(email_threads, EmailLiteral::ThreadId(nil))),
            crm_scope: None,
        },
        channel_filter: Some(literal_tree(channels, ChannelLiteral::ChannelId(nil))),
        channel_thread_filter: Some(literal_tree(
            channel_threads,
            ChannelThreadLiteral::ThreadId(nil),
        )),
        call_filter: Some(literal_tree(calls, CallLiteral::CallId(nil))),
        crm_company_filter: Some(literal_tree(crm_companies, CrmCompanyLiteral::Id(nil))),
        foreign_entity_filter: Some(literal_tree(
            foreign_entities,
            ForeignEntityLiteral::Id(nil),
        )),
        reminder_filter: Some(literal_tree(reminders, ReminderLiteral::Id(nil))),
        properties_filter: None,
    })
}
