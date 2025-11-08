use crate::{
    config::BASE_URL,
    notification::metadata_utils,
    templates::{channel_invite, channel_message, item_share},
};
use anyhow::Context;
use macro_env::{Environment, ext::frontend_url::FrontendUrl};
use model_notifications::{
    ChannelInviteMetadata, ChannelMessageSendMetadata, NotificationEventType,
    NotificationWithRecipient,
};
use url::Url;

/// Gets the unsubscribe url for an email
#[allow(dead_code)]
fn get_email_unsubscribe_url(email_unsubscribe_code: &str) -> String {
    let base_url = &*BASE_URL;
    format!("{}/unsubscribe/email/{}", base_url, email_unsubscribe_code)
}

/// Returns the url to the item share page
fn get_item_share_url(_notification: &NotificationWithRecipient) -> anyhow::Result<Url> {
    Ok(Environment::new_or_prod()
        .get_frontend_url()
        .join("login")?)
    // // Depending on the item type we'll need to construct the url differently...
    // let macro_app_url = &*MACRO_APP_URL;
    // let item_id: &str = &notification.inner.notification_entity.event_item_id;
    //
    // let macro_app_path = match notification.inner.notification_entity.event_item_type.as_str() {
    //     "document" => {
    //         let file_type =
    //             metadata_utils::get_metadata_value::<String>(notification, "file_type")?;
    //
    //         let file_type = FileType::from_str(&file_type).context("invalid file type")?;
    //
    //         format!("{}/{}", &file_type.macro_app_path(), item_id)
    //     }
    //     "chat" => format!("chat/{}", item_id),
    //     // hack to have
    //     "channel" => format!("channel/{}", item_id),
    //     "project" => "".to_string(),
    //     _ => "".to_string(),
    // };
    //
    // Ok(format!("{}/{}", macro_app_url, &macro_app_path))
}

/// Returns the filled email template and the subject
pub fn fill_email_template(
    notification: &NotificationWithRecipient,
) -> anyhow::Result<(String, String)> {
    match notification.inner.notification_event.event_type() {
        NotificationEventType::ItemSharedUser | NotificationEventType::ItemSharedOrganization => {
            let mut item_name =
                metadata_utils::get_metadata_value::<String>(notification, "item_name")?;

            let sender = notification
                .inner
                .sender_id
                .clone()
                .context("notification does not have sender id")?;

            let item_url = get_item_share_url(notification).context("unable to create item url")?;

            if notification
                .inner
                .notification_entity
                .event_item_type
                .to_string()
                == "document"
            {
                let file_type =
                    metadata_utils::get_metadata_value::<String>(notification, "file_type")?;

                item_name = format!("{}.{}", item_name, file_type);
            }

            let sender = sender.replace("macro|", "");

            Ok(item_share::fill_item_share_template(
                &item_url,
                &sender,
                &item_name,
                &notification
                    .inner
                    .notification_entity
                    .event_item_type
                    .to_string(),
            ))
        }
        NotificationEventType::ChannelInvite => {
            let metadata = if let Some(metadata) = notification
                .inner
                .notification_event
                .metadata_json()
                .as_ref()
            {
                metadata.clone()
            } else {
                return Err(anyhow::anyhow!("notification does not have metadata"));
            };

            let metadata: ChannelInviteMetadata = serde_json::from_value(metadata)
                .context("unable to deserialize channel invite metadata")?;

            let item_url = get_item_share_url(notification).context("unable to create item url")?;

            channel_invite::fill_channel_invite_template(&item_url, &metadata)
        }
        NotificationEventType::ChannelMessageSend => {
            let metadata = if let Some(metadata) = notification
                .inner
                .notification_event
                .metadata_json()
                .as_ref()
            {
                metadata.clone()
            } else {
                return Err(anyhow::anyhow!("notification does not have metadata"));
            };

            let metadata: ChannelMessageSendMetadata = serde_json::from_value(metadata)
                .context("unable to deserialize channel invite metadata")?;

            let item_url = get_item_share_url(notification).context("unable to create item url")?;

            Ok(channel_message::fill_channel_message_template(
                &item_url,
                &metadata.common.channel_name,
            ))
        }
        _ => Err(anyhow::anyhow!("unsupported notification event type")),
    }
}
