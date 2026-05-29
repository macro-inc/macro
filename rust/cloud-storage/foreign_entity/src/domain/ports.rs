//! Port definitions for the foreign entity domain.
//!
//! These traits define the contracts that adapters and service consumers use.

use std::future::Future;

use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use item_filters::ast::{LiteralTree, foreign_entity::ForeignEntityLiteral};
use models_pagination::{Query, SimpleSortMethod};
use uuid::Uuid;

use super::models::{
    CreateForeignEntity, ForeignEntity, ForeignEntityError, PatchForeignEntity, SourceId,
};

/// Query type used when listing foreign entities for source ids.
pub type ForeignEntityListQuery = Query<Uuid, SimpleSortMethod, LiteralTree<ForeignEntityLiteral>>;

/// Repository for persisting and fetching foreign entity records.
///
/// Implementations are responsible for database operations and should return
/// `Ok(None)` or `Ok(false)` when a requested row does not exist.
pub trait ForeignEntityRepository: Send + Sync + 'static {
    /// Error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Fetch a foreign entity record by its internal primary key.
    fn get_foreign_entity_by_id(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<ForeignEntity>, Self::Err>> + Send;

    /// Fetch foreign entity records by their external identifier.
    ///
    /// When `foreign_entity_source` is provided, only records from that source
    /// should be returned. An empty result is a successful lookup.
    fn get_foreign_entities_by_foreign_entity_id(
        &self,
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> impl Future<Output = Result<Vec<ForeignEntity>, Self::Err>> + Send;

    /// List foreign entities visible through the supplied source identifiers.
    fn get_foreign_entities_for_user(
        &self,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: ForeignEntityListQuery,
    ) -> impl Future<Output = Result<Vec<ForeignEntity>, Self::Err>> + Send;

    /// Create a foreign entity record using the supplied internal primary key.
    fn create_foreign_entity(
        &self,
        id: Uuid,
        create: CreateForeignEntity,
    ) -> impl Future<Output = Result<ForeignEntity, Self::Err>> + Send;

    /// Delete a foreign entity record by internal primary key.
    ///
    /// Returns `true` when a row was deleted and `false` when no row matched.
    fn delete_foreign_entity(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Patch selected fields on a foreign entity record.
    ///
    /// Returns `Ok(None)` when no row matched the supplied internal primary key.
    fn patch_foreign_entity(
        &self,
        id: Uuid,
        patch: PatchForeignEntity,
    ) -> impl Future<Output = Result<Option<ForeignEntity>, Self::Err>> + Send;
}

/// Service interface for foreign entity CRUD operations.
///
/// The service owns validation, ID generation, and mapping repository misses to
/// domain errors.
pub trait ForeignEntityService: Send + Sync + 'static {
    /// Fetch an authorized foreign entity record using an access receipt.
    fn get_foreign_entity(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<ForeignEntity, ForeignEntityError>> + Send;

    /// Fetch a foreign entity record by its internal primary key.
    fn get_foreign_entity_by_id(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<ForeignEntity, ForeignEntityError>> + Send;

    /// Fetch foreign entity records by their external identifier.
    ///
    /// When `foreign_entity_source` is provided, only records from that source
    /// are returned. An empty result is a successful lookup.
    fn get_foreign_entities_by_foreign_entity_id(
        &self,
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> impl Future<Output = Result<Vec<ForeignEntity>, ForeignEntityError>> + Send;

    /// List foreign entities visible through the supplied source identifiers.
    fn get_foreign_entities_for_user(
        &self,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: ForeignEntityListQuery,
    ) -> impl Future<Output = Result<Vec<ForeignEntity>, ForeignEntityError>> + Send;

    /// Create a foreign entity record.
    fn create_foreign_entity(
        &self,
        create: CreateForeignEntity,
    ) -> impl Future<Output = Result<ForeignEntity, ForeignEntityError>> + Send;

    /// Delete a foreign entity record by internal primary key.
    fn delete_foreign_entity(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<(), ForeignEntityError>> + Send;

    /// Patch selected fields on a foreign entity record.
    fn patch_foreign_entity(
        &self,
        id: Uuid,
        patch: PatchForeignEntity,
    ) -> impl Future<Output = Result<ForeignEntity, ForeignEntityError>> + Send;
}
