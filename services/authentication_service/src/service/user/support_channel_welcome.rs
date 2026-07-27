use std::future::Future;

use channels::domain::{
    models::{PostMessageNotificationPolicy, PostMessageRequest, Sender, SimpleMention},
    ports::ChannelService,
};
use macro_user_id::user_id::MacroUserIdStr;
use mention_utils::serialize::user_mention;
use rootcause::{Report, prelude::ResultExt};
use uuid::Uuid;

#[cfg(test)]
mod test;

const JACOB_EMAIL: &str = "jacob@macro.com";
const JULIA_EMAIL: &str = "julia@macro.com";
const TEO_EMAIL: &str = "teo@macro.com";

/// The channel operation required to post a new user's welcome message.
pub trait SupportChannelMessageGateway: Send + Sync + 'static {
    /// Post the initial welcome message.
    fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        request: PostMessageRequest,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

impl<T> SupportChannelMessageGateway for T
where
    T: ChannelService,
{
    async fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        request: PostMessageRequest,
    ) -> Result<(), Report> {
        ChannelService::post_message(self, actor, channel_id, request)
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

    let content = format!(
        "Hey {},\n\
Thanks signing up for Macro, we're excited for you to try it out.\n\
In case you need any help, this is a support channel with {} (the ceo) and {} (the cto).\n\
If you have any feedback or find any bugs let us know here!\n\
Julia",
        user_mention(&new_user)?,
        user_mention(&jacob)?,
        user_mention(&teo)?,
    );
    // Keep Jacob and Teo visually mentioned in the welcome copy without notifying them. Julia is
    // the sender, so the channel notification policy excludes her automatically.
    let mentions = [&new_user].into_iter().map(SimpleMention::user).collect();

    gateway
        .post_message(
            Sender::new_from_user(julia),
            channel_id,
            PostMessageRequest {
                content,
                mentions,
                thread_id: None,
                attachments: Vec::new(),
                nonce: None,
                notification_policy: PostMessageNotificationPolicy::MentionsOnly,
                triggered_by: None,
            },
        )
        .await
}
