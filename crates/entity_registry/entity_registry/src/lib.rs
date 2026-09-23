#![deny(missing_docs)]
//! Owning crate for the `entity` table: one recorded owner per in-scope resource.
//!
//! Effective access lives in `entity_access`, not here. Reads go through
//! [`EntityRegistryService`], backed by [`EntityRegistryRepository`].
//! Transactional writes live in `entity_registry_db_utils` so other crates can
//! join them to their own resource-row transactions. Shared types live in
//! `shared_entity_registry`; this crate does not depend on the write helpers.
//!
//! [`RegisteredEntityType`] is the table CHECK as a type. Use
//! [`NewEntityRecord::try_new`] when the caller holds a wide
//! [`model_entity::EntityType`].
//!
//! ```
//! use entity_registry::{NewEntityRecord, Owner, RegisteredEntityType};
//! use model_entity::EntityType;
//! use model_owner::OwnerType;
//! use uuid::Uuid;
//!
//! let owner = Owner::parse(OwnerType::User, "macro|hutch@macro.com").unwrap();
//! let record = NewEntityRecord::try_new(Uuid::nil(), EntityType::Chat, owner.clone()).unwrap();
//! assert_eq!(record.entity_type, RegisteredEntityType::Chat);
//! assert!(NewEntityRecord::try_new(Uuid::nil(), EntityType::Initiative, owner).is_err());
//! ```

pub mod domain;

#[cfg(feature = "postgres")]
pub mod outbound;

pub use domain::models::{EntityRecord, EntityTypeCount};
pub use domain::owner_grant_policy::OwnerGrantPolicy;
pub use domain::ports::{BotFacts, EntityRegistryRepository, EntityRegistryService};
pub use domain::service::EntityRegistryServiceImpl;
pub use shared_entity_registry::{
    EntityRegistryError, EntityRegistryResult, InsertOutcome, NewEntityRecord, Owner,
    RegisteredEntityType, UnregisteredEntityType, WriteOutcome,
};

#[cfg(feature = "postgres")]
pub use outbound::pg_entity_registry_repo::PgEntityRegistryRepository;
