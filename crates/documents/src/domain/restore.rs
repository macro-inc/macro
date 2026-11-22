//! Restoration admission before the existing persistence operation is started.
use super::models::DocumentError;
use entity_access::domain::models::{EntityAccessReceipt, EntityType};
use model::document::DocumentBasic;
use models_permissions::share_permission::access_level::OwnerAccessLevel;

/// Run the existing restoration transaction only for the receipt's document.
/// The operation factory is lazy: admission happens before persistence starts.
pub async fn restore_document<Restore, Operation>(
    access: EntityAccessReceipt<OwnerAccessLevel>,
    document: &DocumentBasic,
    restore: Restore,
) -> Result<(), DocumentError>
where
    Restore: FnOnce(String, Option<String>) -> Operation + Send,
    Operation: Future<Output = anyhow::Result<()>> + Send,
{
    if access.entity().entity_type != EntityType::Document
        || access.entity().entity_id != document.document_id
    {
        return Err(DocumentError::Unauthorized);
    }
    super::skill_access::ensure_skill_write(document.sub_type)?;
    restore(
        access.entity().entity_id.clone(),
        document.project_id.clone(),
    )
    .await
    .map_err(DocumentError::Internal)
}

#[cfg(test)]
mod test;
