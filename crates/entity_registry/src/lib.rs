#![deny(missing_docs)]
//! Owning crate for the `entity` table: one recorded owner per in-scope resource.
//!
//! Effective access lives in `entity_access`, not here. Writes ride the
//! caller's transaction so a resource row and its registry row commit or roll
//! back together. Reads go through [`EntityRegistryRepository`].
//!
//! [`RegisteredEntityType`] is the table CHECK as a type. Use
//! [`NewEntityRecord::try_new`] when the caller holds a wide
//! [`model_entity::EntityType`].
//!
//! # Architecture
//!
//! - **domain**: registry records, outcomes, and the read port.
//! - **outbound** (feature `postgres`): transactional write helpers and the
//!   pool-backed repository.
//!
//! There is no inbound module and no domain service: callers invoke the helpers
//! and the read port directly.
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

pub use domain::models::{
    EntityRecord, EntityRegistryError, EntityRegistryResult, EntityTypeCount, InsertOutcome,
    NewEntityRecord, RegisteredEntityType, UnregisteredEntityType, WriteOutcome,
};
pub use domain::ports::EntityRegistryRepository;
/// Re-exported because it appears in every write input and every record.
pub use model_owner::Owner;

#[cfg(feature = "postgres")]
pub use outbound::pg_entity_registry_repo::PgEntityRegistryRepository;
#[cfg(feature = "postgres")]
pub use outbound::pg_entity_tx::{
    clear_deleted, delete_entity, insert_entity, mark_deleted, touch_updated,
};
