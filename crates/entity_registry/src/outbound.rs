//! Postgres adapters: transactional write helpers and the pool-backed read port.

pub mod pg_entity_registry_repo;
pub mod pg_entity_tx;

use model_owner::{Owner, OwnerType};

pub(crate) fn bind_owner(owner: &Owner) -> (OwnerType, String) {
    (owner.owner_type(), owner.principal_id())
}
