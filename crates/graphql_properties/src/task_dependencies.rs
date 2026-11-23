//! Request-scoped, authorized task dependency facts shared by queries and mutations.

#[cfg(test)]
mod test;

use crate::{EntityPropertyReader, GraphqlProperty, PropertiesEntityPropertyReader};
use async_graphql::{
    ComplexObject, Context, ID, SimpleObject,
    dataloader::{DataLoader, Loader},
};
use entity_access::domain::ports::EntityAccessService;
use futures::future::BoxFuture;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use properties::domain::model::ViewReceipt;
use properties::domain::task_dependency_state::{
    TaskDependencyState, TaskDependencyStateRepository, TaskDependencyStateService,
};
use rootcause::markers::{Cloneable, Dynamic};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use system_properties::SystemPropertyKey;
use tracing::Instrument;
use uuid::Uuid;

/// A task's dependency state, normalized by the task's canonical identity.
#[derive(SimpleObject)]
#[graphql(complex)]
pub struct GraphqlTaskDependencyState {
    /// Indexed reverse endpoints, retained for lazy dependent-state hydration.
    #[graphql(skip)]
    dependent_ids: Vec<Uuid>,
    /// Canonical task identifier.
    pub id: ID,
    /// Whether any existing blocker is unfinished.
    pub is_blocked: bool,
    /// Unfinished blockers that the viewer can read.
    pub open_blocker_ids: Vec<ID>,
    /// Readable prerequisite IDs, independent of completion status.
    pub visible_blocker_ids: Vec<ID>,
    /// Canonical Status, Depends On, and Blocking assignments.
    pub properties: Vec<GraphqlProperty>,
}

/// Internal loader value retains graph endpoints for mutation reconciliation.
#[derive(Clone)]
pub struct TaskDependencyData {
    /// Authoritative dependency facts.
    pub facts: TaskDependencyState,
    /// Independently minted prerequisite view capabilities for domain projection.
    pub blocker_receipts: Vec<ViewReceipt>,
    /// Authorized property assignments.
    pub properties: Vec<EntityPropertyWithDefinition>,
}

impl GraphqlTaskDependencyState {
    /// Convert authorized domain facts to their normalized GraphQL record.
    pub fn new(value: TaskDependencyData) -> Self {
        let visibility = value.facts.visible_state(&value.blocker_receipts);
        Self {
            dependent_ids: value.facts.dependent_ids,
            id: ID(value.facts.task_id.to_string()),
            is_blocked: visibility.is_blocked,
            open_blocker_ids: visibility
                .open_blocker_ids
                .into_iter()
                .map(|id| ID(id.to_string()))
                .collect(),
            visible_blocker_ids: visibility
                .visible_blocker_ids
                .into_iter()
                .map(|id| ID(id.to_string()))
                .collect(),
            properties: value
                .properties
                .into_iter()
                .filter(|property| {
                    matches!(
                        property.definition.id,
                        SystemPropertyKey::STATUS_UUID
                            | SystemPropertyKey::DEPENDS_ON_UUID
                            | SystemPropertyKey::BLOCKING_UUID
                    )
                })
                .map(GraphqlProperty::new)
                .collect(),
        }
    }
}

#[ComplexObject]
impl GraphqlTaskDependencyState {
    /// Hydrate dependent facts in the same batch when a blocker changes remotely.
    async fn dependent_tasks(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlTaskDependencyState>> {
        let loader = ctx.data::<DataLoader<TaskDependencyLoader>>()?;
        let loaded = loader
            .load_many(self.dependent_ids.clone())
            .await
            .map_err(|error| async_graphql::Error::new(error.to_string()))?;
        Ok(loaded
            .into_values()
            .map(GraphqlTaskDependencyState::new)
            .collect())
    }
}

/// Object-safe adapter boundary for the request-scoped dependency loader.
pub trait TaskDependencyReader: Send + Sync + 'static {
    /// Load exactly one bounded batch on behalf of the authenticated viewer.
    fn load<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'static>,
        ids: &'a [Uuid],
    ) -> BoxFuture<'a, Result<HashMap<Uuid, TaskDependencyData>, rootcause::Report>>;
}

/// Properties-domain adapter with the canonical entity authorizer.
pub struct PropertiesTaskDependencyReader<R, P, A> {
    /// Receipt-gated dependency facts from the domain repository.
    service: TaskDependencyStateService<R>,
    /// Canonical property assignments authorized for the same viewer.
    properties: PropertiesEntityPropertyReader<P, A>,
    /// Mints document-view receipts before reading dependency facts.
    access: Arc<A>,
}

impl<R: TaskDependencyStateRepository, P, A> PropertiesTaskDependencyReader<R, P, A> {
    /// Compose the domain read service with existing properties and access services.
    pub fn new(repository: R, properties: Arc<P>, access: Arc<A>) -> Self {
        Self {
            service: TaskDependencyStateService::new(repository),
            properties: PropertiesEntityPropertyReader::new(properties, access.clone()),
            access,
        }
    }
}

impl<R, P, A> TaskDependencyReader for PropertiesTaskDependencyReader<R, P, A>
where
    R: TaskDependencyStateRepository,
    P: properties::PropertiesService,
    A: EntityAccessService,
{
    fn load<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'static>,
        ids: &'a [Uuid],
    ) -> BoxFuture<'a, Result<HashMap<Uuid, TaskDependencyData>, rootcause::Report>> {
        Box::pin(async move {
            let strings = ids.iter().map(ToString::to_string).collect::<Vec<_>>();
            let receipts = self
                .access
                .generate_document_view_access_receipts(user, &strings)
                .await
                .map_err(|error| rootcause::report!(error))?
                .into_values()
                .collect::<Vec<_>>();
            let facts = self
                .service
                .load(&receipts)
                .await
                .map_err(|error| rootcause::report!(error))?;
            // Authorize all prerequisites, not just unfinished ones: visibility evidence
            // must not reveal completion status. Keep canonical facts for the aggregate.
            let blocker_receipts =
                load_blocker_view_receipts(self.access.as_ref(), user, &facts).await?;
            let entities = ids
                .iter()
                .map(|id| model_entity::EntityType::Document.with_entity_string(id.to_string()))
                .collect::<Vec<_>>();
            let mut properties = self.properties.get_properties(user, &entities).await?;
            Ok(facts
                .into_iter()
                .map(|(id, facts)| {
                    let entity =
                        model_entity::EntityType::Document.with_entity_string(id.to_string());
                    (
                        id,
                        TaskDependencyData {
                            blocker_receipts: facts
                                .blocker_ids
                                .iter()
                                .filter_map(|id| blocker_receipts.get(id).cloned())
                                .collect(),
                            facts,
                            properties: properties.remove(&entity).unwrap_or_default(),
                        },
                    )
                })
                .collect())
        })
    }
}

/// Mint status-neutral blocker view capabilities; the repository bounds SQL statements.
pub(crate) async fn load_blocker_view_receipts(
    access: &impl EntityAccessService,
    user: &MacroUserIdStr<'static>,
    facts: &HashMap<Uuid, TaskDependencyState>,
) -> Result<HashMap<Uuid, ViewReceipt>, rootcause::Report> {
    let ids = facts
        .values()
        .flat_map(|state| state.blocker_ids.iter().copied())
        .collect::<HashSet<_>>()
        .into_iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>();
    // One bulk call lets the repository load source memberships once and apply
    // its own UUID statement cap, instead of repeating that work per outer chunk.
    Ok(access
        .generate_document_view_access_receipts(user, &ids)
        .await
        .map_err(|error| rootcause::report!(error))?
        .into_values()
        .filter_map(|receipt| {
            Uuid::parse_str(&receipt.entity().entity_id)
                .ok()
                .map(|id| (id, receipt))
        })
        .collect())
}

/// Fixed loader type avoids adding dependency-reader generics to every schema root.
pub struct TaskDependencyLoader {
    /// Authenticated viewer identity, excluded from tracing fields.
    user: MacroUserIdStr<'static>,
    /// Authorized batched dependency reader shared by loader requests.
    reader: Arc<dyn TaskDependencyReader>,
}

impl Loader<Uuid> for TaskDependencyLoader {
    type Value = TaskDependencyData;
    type Error = rootcause::Report<Dynamic, Cloneable>;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Self::Value>, Self::Error> {
        let mut result = HashMap::new();
        for batch in keys.chunks(500) {
            result.extend(
                self.reader
                    .load(&self.user, batch)
                    .await
                    .map_err(|error| error.into_cloneable())?,
            );
        }
        Ok(result)
    }
}

/// Construct a loader for one authenticated GraphQL request.
pub fn task_dependency_loader(
    user: MacroUserIdStr<'static>,
    reader: impl TaskDependencyReader,
) -> DataLoader<TaskDependencyLoader> {
    DataLoader::new(
        TaskDependencyLoader {
            user,
            reader: Arc::new(reader),
        },
        |future| tokio::spawn(future.in_current_span()),
    )
}

/// Resolve one task dependency record without a per-row database query.
pub async fn load_task_dependencies(
    ctx: &Context<'_>,
    task_id: Uuid,
) -> async_graphql::Result<Option<GraphqlTaskDependencyState>> {
    let loader = ctx.data::<DataLoader<TaskDependencyLoader>>()?;
    Ok(loader
        .load_one(task_id)
        .await
        .map_err(|error| async_graphql::Error::new(error.to_string()))?
        .map(GraphqlTaskDependencyState::new))
}

/// Attach a stable recovery code and opaque task identifier to completion rejection.
pub(crate) fn task_property_error(
    error: impl std::fmt::Display,
    task_id: Uuid,
) -> async_graphql::Error {
    use async_graphql::ErrorExtensions;
    let message = error.to_string();
    if message == "Task is blocked" {
        return async_graphql::Error::new(message).extend_with(|_, extensions| {
            extensions.set("code", "TASK_BLOCKED");
            extensions.set("taskId", task_id.to_string());
        });
    }
    async_graphql::Error::new(message)
}

/// Read post-write neighbors as well as pre-write neighbors before returning effects.
pub(crate) async fn load_task_property_effects(
    loader: &DataLoader<TaskDependencyLoader>,
    task_id: Uuid,
    mut ids: Vec<Uuid>,
) -> async_graphql::Result<Vec<GraphqlTaskDependencyState>> {
    let current = loader
        .load_one(task_id)
        .await
        .map_err(|error| async_graphql::Error::new(error.to_string()))?;
    if let Some(current) = current {
        ids.extend(current.facts.blocker_ids);
        ids.extend(current.facts.dependent_ids);
    }
    ids.sort_unstable();
    ids.dedup();
    let mut states = loader
        .load_many(ids)
        .await
        .map_err(|error| async_graphql::Error::new(error.to_string()))?
        .into_values()
        .collect::<Vec<_>>();
    states.sort_by_key(|state| state.facts.task_id);
    Ok(states
        .into_iter()
        .map(GraphqlTaskDependencyState::new)
        .collect())
}

/// Resolve one bounded viewer-scoped batch for task search results.
pub async fn load_task_dependency_batch(
    ctx: &Context<'_>,
    task_ids: Vec<ID>,
) -> async_graphql::Result<Vec<GraphqlTaskDependencyState>> {
    if task_ids.len() > 500 {
        return Err(async_graphql::Error::new(
            "At most 500 tasks can be loaded at once",
        ));
    }
    let ids = task_ids
        .into_iter()
        .map(|id| {
            Uuid::parse_str(id.as_str()).map_err(|_| async_graphql::Error::new("Invalid task ID"))
        })
        .collect::<async_graphql::Result<Vec<_>>>()?;
    let loader = ctx.data::<DataLoader<TaskDependencyLoader>>()?;
    let states = loader
        .load_many(ids)
        .await
        .map_err(|error| async_graphql::Error::new(error.to_string()))?;
    Ok(states
        .into_values()
        .map(GraphqlTaskDependencyState::new)
        .collect())
}
