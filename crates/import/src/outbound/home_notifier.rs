//! Notification-service implementation of the import service's Home hook:
//! each active imported item becomes a self-addressed `item_imported`
//! notification on its document, which is what puts it on Home.

use std::collections::HashSet;
use std::sync::Arc;

use macro_user_id::cowlike::CowLike;
use model_entity::EntityType;
use model_notifications::{ImportedFrom, ItemImportedMetadata};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use uuid::Uuid;

use crate::domain::models::ImportSource;
use crate::domain::service::{ActiveImport, ActiveImportNotify};

#[cfg(test)]
mod test;

/// Namespace for deterministic notification ids, so a redelivered or retried
/// run never notifies twice about the same document.
const NOTIFICATION_ID_NAMESPACE: Uuid = Uuid::from_u128(0x0199_c3e4_4c7b_7a2e_9f1d_6e4b_2a8c_5d10);

/// The notification id for one imported document and user.
fn notification_id(user: &str, entity_id: &str) -> Uuid {
    Uuid::new_v5(
        &NOTIFICATION_ID_NAMESPACE,
        format!("item_imported:{user}:{entity_id}").as_bytes(),
    )
}

fn imported_from(source: ImportSource) -> Option<ImportedFrom> {
    match source {
        ImportSource::Notion => Some(ImportedFrom::Notion),
        ImportSource::Linear => Some(ImportedFrom::Linear),
        ImportSource::Slack => None,
    }
}

/// Build the request for one item. The user is the only recipient and must
/// not be the sender: recipients who sent a notification are filtered out.
fn request(
    user: &macro_user_id::user_id::MacroUserIdStr<'static>,
    item: &ActiveImport,
) -> Option<notification::domain::models::SendNotificationRequest<'static, ItemImportedMetadata, ()>>
{
    let source = imported_from(item.source)?;
    Some(
        SendNotificationRequestBuilder {
            // Notion pages and Linear tasks are both documents.
            notification_entity: EntityType::Document.with_entity_string(item.entity_id.clone()),
            secondary_notification_entity: None,
            notification: ItemImportedMetadata {
                source,
                item_name: item.name.clone(),
            },
            sender_id: None,
            recipient_ids: HashSet::from([user.copied().into_owned()]),
        }
        .into_request_with_id(notification_id(user.as_ref(), &item.entity_id))
        // Live Home refresh only: no push or email for a bulk import.
        .with_conn_gateway(),
    )
}

/// Build an [`ActiveImportNotify`] that sends through `ingress`. Failures
/// only warn: Home is a nicety, never part of the import's outcome.
pub fn notification_active_import_notify<N: NotificationIngress>(
    ingress: Arc<N>,
) -> ActiveImportNotify {
    Arc::new(move |user, items| {
        let ingress = ingress.clone();
        Box::pin(async move {
            for item in &items {
                let Some(request) = request(&user, item) else {
                    continue;
                };
                if let Err(error) = ingress.send_notification(request).await {
                    tracing::warn!(error = ?error, entity_id = %item.entity_id, "failed to surface an imported item on Home");
                }
            }
        })
    })
}
