//! Existing link-maintenance effects behind the email domain's ports.

mod legacy;
pub(crate) use legacy::LegacyLinkDeletionAdapter;

use crate::outbound::message_labels::gmail_ops::PgGmailOps;
use crate::outbound::persistence_error::InboxPersistenceError;
use crate::pubsub::context::{NotificationIngressType, PubSubEventBroker};
use email::domain::mailbox::link_manager::{
    LinkManagerNotifications, LinkManagerRepository, LinkManagerService, ReauthNotification,
};
use model_entity::EntityType;
use model_notifications::InboxReauthRequiredMetadata;
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use std::sync::Arc;
use uuid::Uuid;

pub(crate) type LinkManager = LinkManagerService<
    PgGmailOps,
    Arc<crate::composition::InboxHealth>,
    Arc<crate::composition::InboxLifecycle>,
    ReauthNotifier,
    PubSubEventBroker,
    LegacyLinkDeletionAdapter,
>;

impl LinkManagerRepository for PgGmailOps {
    async fn primaries(&self, owner: &str, link: Uuid) -> Result<Vec<String>, Self::Err> {
        macro_db_client::macro_user_links::get_primaries_for_link(&self.0, owner, link)
            .await
            .map_err(Into::into)
    }
}

pub(crate) struct ReauthNotifier(pub Arc<NotificationIngressType>);

impl LinkManagerNotifications for ReauthNotifier {
    type Err = InboxPersistenceError;

    async fn send(&self, notification: ReauthNotification) -> Result<(), Self::Err> {
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::User
                .with_entity_string(notification.owner.to_string()),
            secondary_notification_entity: None,
            notification: InboxReauthRequiredMetadata {
                email_address: notification.email_address,
            },
            sender_id: None,
            recipient_ids: notification.recipient_ids,
        }
        .into_request()
        .with_conn_gateway();
        self.0
            .send_notification(request)
            .await
            .map(|_| ())
            .map_err(|error| anyhow::anyhow!("{error}").into())
    }
}
