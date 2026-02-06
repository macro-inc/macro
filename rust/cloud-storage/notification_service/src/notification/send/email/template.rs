use crate::{
    config::BASE_URL,
    notification::metadata_utils,
    templates::{channel_invite, channel_message, item_share},
};
use anyhow::Context;
use macro_env::{Environment, ext::frontend_url::FrontendUrl};
use macro_user_id::email::ReadEmailParts;
use model_entity::EntityType;
use model_notifications::{ChannelInviteMetadata, ChannelMessageSendMetadata};
use url::Url;

/// Gets the unsubscribe url for an email
#[allow(dead_code)]
fn get_email_unsubscribe_url(email_unsubscribe_code: &str) -> String {
    let base_url = &*BASE_URL;
    format!("{}/unsubscribe/email/{}", base_url, email_unsubscribe_code)
}
