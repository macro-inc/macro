//! The catalog permissions resolve against, from `agent_permission_registry`.

use crate::domain::model::{Catalog, CatalogEntry, CatalogGroup};

/// Every group and operation in the checked-in registry; the always-allowed
/// ones apart, so no setting can name them.
pub fn registry_catalog() -> Catalog {
    Catalog {
        version: agent_permission_registry::version().to_owned(),
        groups: agent_permission_registry::groups()
            .iter()
            .map(|group| CatalogGroup {
                id: group.id.clone(),
                name: group.name.clone(),
                description: group.description.clone(),
            })
            .collect(),
        entries: entries(false),
        always_allowed: entries(true),
    }
}

/// The registry's operations that are, or are not, always allowed.
fn entries(always_allowed: bool) -> Vec<CatalogEntry> {
    agent_permission_registry::operations()
        .filter(|(_, _, classification)| classification.always_allowed == always_allowed)
        .map(|(service, operation, classification)| CatalogEntry {
            service: service.to_owned(),
            operation: operation.to_owned(),
            group: classification.group.clone(),
            action: classification.action,
            label: classification.label.clone(),
        })
        .collect()
}
