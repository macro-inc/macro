//! Posts account manager requests and approvals into the pair's DM.

use std::sync::Arc;

use channels::domain::{
    models::{ChannelSender, GetOrCreateDmRequest},
    ports::ChannelService,
};
use entity_access::domain::{models::EntityType, ports::EntityAccessService};
use macro_service_urls::AppServiceUrl;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::MessageCommands,
    models::{MessageAttribution, PostMessage, PostMessageNotificationPolicy},
    service::MessageWrite,
};
use rootcause::prelude::ResultExt;
use uuid::Uuid;

use crate::domain::{models::CARD_TAG, ports::AccountManagerDelivery};

/// Delivery through the shared channel and message services.
pub struct DmAccountManagerDelivery<C, A> {
    channels: Arc<C>,
    messages: Arc<dyn MessageCommands>,
    access: Arc<A>,
    app_url: AppServiceUrl,
}

impl<C, A> DmAccountManagerDelivery<C, A> {
    /// Compose delivery from the services that own channels and messages.
    pub fn new(
        channels: Arc<C>,
        messages: Arc<dyn MessageCommands>,
        access: Arc<A>,
        app_url: AppServiceUrl,
    ) -> Self {
        Self {
            channels,
            messages,
            access,
            app_url,
        }
    }
}

fn card(grant_id: Uuid) -> String {
    format!(r#"<{CARD_TAG}>{{"id":"{grant_id}"}}</{CARD_TAG}>"#)
}

impl<C, A> DmAccountManagerDelivery<C, A>
where
    C: ChannelService,
    A: EntityAccessService,
{
    async fn post(
        &self,
        sender: &MacroUserIdStr<'static>,
        recipient: &MacroUserIdStr<'static>,
        content: String,
    ) -> Result<(), rootcause::Report> {
        let channel = self
            .channels
            .get_or_create_dm(
                ChannelSender::new_from_user(sender.clone()),
                GetOrCreateDmRequest {
                    recipient_id: ChannelSender::new_from_user(recipient.clone()),
                },
            )
            .await
            .map_err(|error| rootcause::report!("could not open the DM: {error:?}"))?;
        let access = self
            .access
            .generate_entity_access_receipt::<MessageWrite>(
                sender,
                None,
                &channel.channel_id,
                EntityType::Channel,
            )
            .await
            .context("sender must be able to post in the DM")?;

        self.messages
            .post(
                access,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::ActingUser,
                    notification_policy: PostMessageNotificationPolicy::default(),
                    content,
                    thread_id: None,
                    anchor: None,
                    mentions: Vec::new(),
                    attachments: Vec::new(),
                    nonce: None,
                },
            )
            .await
            .context("could not post in the DM")?;

        Ok(())
    }
}

impl<C, A> AccountManagerDelivery for DmAccountManagerDelivery<C, A>
where
    C: ChannelService,
    A: EntityAccessService,
{
    async fn deliver_request(
        &self,
        sender: &MacroUserIdStr<'static>,
        recipient: &MacroUserIdStr<'static>,
        grant_id: Uuid,
    ) -> Result<(), rootcause::Report> {
        self.post(sender, recipient, card(grant_id)).await
    }

    async fn deliver_approval(
        &self,
        sender: &MacroUserIdStr<'static>,
        recipient: &MacroUserIdStr<'static>,
        grant_id: Uuid,
    ) -> Result<(), rootcause::Report> {
        let link = format!("{}/app/account-manager/{grant_id}", self.app_url.as_ref());
        let content = format!(
            "{}\n\nAccess approved. The manager can reveal the token once at {link}",
            card(grant_id),
        );

        self.post(sender, recipient, content).await
    }
}
