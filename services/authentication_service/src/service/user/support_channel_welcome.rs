use std::future::Future;

use channels::domain::models::Sender;
use entity_access::domain::{models::EntityType, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use mention_utils::serialize::user_mention;
use messages::domain::{
    api::MessageCommands,
    models::{MessageAttribution, PostMessage, PostMessageNotificationPolicy, SimpleMention},
    service::MessageWrite,
};
use rootcause::{Report, prelude::ResultExt};
use uuid::Uuid;

#[cfg(test)]
mod test;

const JACOB_EMAIL: &str = "jacob@macro.com";
const JULIA_EMAIL: &str = "julia@macro.com";
const TEO_EMAIL: &str = "teo@macro.com";

/// The channel operation required to post a new user's welcome messages.
pub trait SupportChannelMessageGateway: Send + Sync {
    /// Post a welcome message.
    fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        request: PostMessage,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Posts through the shared message commands with the support sender's current
/// channel membership.
pub struct AuthorizedSupportChannelMessages<A> {
    messages: std::sync::Arc<dyn MessageCommands>,
    access: std::sync::Arc<A>,
}

impl<A> AuthorizedSupportChannelMessages<A> {
    /// Compose the message writer with the access service that verifies membership.
    pub fn new(messages: std::sync::Arc<dyn MessageCommands>, access: std::sync::Arc<A>) -> Self {
        Self { messages, access }
    }
}

impl<A: EntityAccessService> SupportChannelMessageGateway for AuthorizedSupportChannelMessages<A> {
    async fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        request: PostMessage,
    ) -> Result<(), Report> {
        let user = actor
            .as_user()
            .ok_or_else(|| rootcause::report!("support messages require a user sender"))?;
        let access = self
            .access
            .generate_entity_access_receipt::<MessageWrite>(
                user,
                None,
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
            .context("support sender must be a channel member")?;
        self.messages
            .post(access, request)
            .await
            .context("failed to post Macro support welcome message")?;
        Ok(())
    }
}

fn support_user(email: &str) -> Result<MacroUserIdStr<'static>, Report> {
    Ok(MacroUserIdStr::try_from_email(email)
        .context_with(|| format!("invalid Macro support user email: {email}"))?)
}

/// Post Julia's welcome message in a newly created support channel.
pub async fn post_support_channel_welcome(
    gateway: &impl SupportChannelMessageGateway,
    channel_id: &str,
    new_user: MacroUserIdStr<'static>,
) -> Result<(), Report> {
    let channel_id =
        Uuid::parse_str(channel_id).context("support channel returned an invalid id")?;
    let jacob = support_user(JACOB_EMAIL)?;
    let julia = support_user(JULIA_EMAIL)?;
    let teo = support_user(TEO_EMAIL)?;

    let new_user_mention = user_mention(&new_user)?;

    let welcome = format!(
        "Hey {new_user_mention},\n\
\n\
Welcome to Macro, we're excited for you to try it out.\n\
\n\
This is your own personal support Channel, with {} (ceo) and {} (cto) and me (julia).\n\
\n\
If you have any feedback or find any bugs let us know here.",
        user_mention(&jacob)?,
        user_mention(&teo)?,
    );
    // Keep Jacob and Teo visually mentioned without tracking them: tracked
    // mentions would notify them on every signup. Julia is the sender, so the
    // channel notification policy excludes her automatically.
    let mentions = [&new_user].into_iter().map(SimpleMention::user).collect();

    gateway
        .post_message(
            Sender::new_from_user(julia),
            channel_id,
            PostMessage {
                id: None,
                attribution: MessageAttribution::Unprompted,
                notification_policy: PostMessageNotificationPolicy::MentionsOnly,
                content: welcome,
                thread_id: None,
                anchor: None,
                mentions,
                attachments: Vec::new(),
                nonce: None,
            },
        )
        .await?;

    Ok(())
}
