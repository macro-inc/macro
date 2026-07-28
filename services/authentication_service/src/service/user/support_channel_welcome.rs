use std::future::Future;

use bot_id::{MACRO_AI_BOT_ID, MACRO_AI_NAME};
use channels::domain::{
    models::{PostMessageNotificationPolicy, PostMessageRequest, Sender, SimpleMention},
    ports::ChannelService,
};
use macro_user_id::user_id::MacroUserIdStr;
use mention_utils::serialize::{bot_mention, document_mention, user_mention};
use model::document_storage_service_internal::StarterDocHowToGuide;
use rootcause::{Report, prelude::ResultExt};
use uuid::Uuid;

#[cfg(test)]
mod test;

const JACOB_EMAIL: &str = "jacob@macro.com";
const JULIA_EMAIL: &str = "julia@macro.com";
const TEO_EMAIL: &str = "teo@macro.com";

/// The channel operation required to post a new user's welcome messages.
pub trait SupportChannelMessageGateway: Send + Sync + 'static {
    /// Post a welcome message, returning the created message id.
    fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        request: PostMessageRequest,
    ) -> impl Future<Output = Result<Uuid, Report>> + Send;
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
    ) -> Result<Uuid, Report> {
        let response = ChannelService::post_message(self, actor, channel_id, request)
            .await
            .context("failed to post Macro support welcome message")?;

        Ok(Uuid::parse_str(&response.id)
            .context("posted Macro support welcome message returned an invalid id")?)
    }
}

fn support_user(email: &str) -> Result<MacroUserIdStr<'static>, Report> {
    Ok(MacroUserIdStr::try_from_email(email)
        .context_with(|| format!("invalid Macro support user email: {email}"))?)
}

/// Post the welcome script in a newly created support channel: Julia's
/// welcome message, a scripted reply from the Macro assistant (posted
/// directly as the bot — the model is never invoked), and Julia's feedback
/// prompt.
pub async fn post_support_channel_welcome(
    gateway: &impl SupportChannelMessageGateway,
    channel_id: &str,
    new_user: MacroUserIdStr<'static>,
    how_to_guide: Option<&StarterDocHowToGuide>,
) -> Result<(), Report> {
    let channel_id =
        Uuid::parse_str(channel_id).context("support channel returned an invalid id")?;
    let jacob = support_user(JACOB_EMAIL)?;
    let julia = support_user(JULIA_EMAIL)?;
    let teo = support_user(TEO_EMAIL)?;

    let new_user_mention = user_mention(&new_user)?;
    let macro_mention = bot_mention(MACRO_AI_BOT_ID, MACRO_AI_NAME)?;
    // When the guide could not be seeded the document paragraph keeps its
    // point but drops the example mention.
    let document_example = match how_to_guide {
        Some(guide) => format!(
            ", like this: {}",
            document_mention(&guide.document_id, &guide.document_name)?
        ),
        None => String::new(),
    };

    let welcome = format!(
        "Hey {new_user_mention},\n\
\n\
Welcome to Macro, we're excited for you to try it out.\n\
\n\
This is your own personal support Channel, with {} (ceo) and {} (cto) and me (julia).\n\
\n\
Channels are how you stay in touch with other people on Macro.\n\
\n\
You can @mention people to get their attention. They'll get a separate notification in their inbox (like you'll see for this message).\n\
\n\
You can @mention documents{document_example}. Mentioning a document shares it with the other participants.\n\
\n\
You can even @mention our chat assistant, {macro_mention}. Say hi to {new_user_mention}, {macro_mention}.",
        user_mention(&jacob)?,
        user_mention(&teo)?,
    );
    // Keep Jacob, Teo, Macro, and the guide visually mentioned without
    // tracking them: tracked mentions would notify Jacob and Teo (and the
    // support team about the guide) on every signup, and a tracked bot
    // mention could trigger a real model reply if bot triggers were ever
    // wired into this service. Julia is the sender, so the channel
    // notification policy excludes her automatically.
    let mentions = [&new_user].into_iter().map(SimpleMention::user).collect();

    let welcome_message_id = gateway
        .post_message(
            Sender::new_from_user(julia.clone()),
            channel_id,
            PostMessageRequest {
                content: welcome,
                mentions,
                thread_id: None,
                attachments: Vec::new(),
                nonce: None,
                notification_policy: PostMessageNotificationPolicy::MentionsOnly,
                triggered_by: None,
            },
        )
        .await?;

    // The scripted assistant reply, threaded under the welcome message and
    // authored by the Macro bot itself. The new user's mention stays
    // visual-only: they already get the mention notification from the
    // welcome message above.
    let assistant_reply = format!(
        "Hey {new_user_mention}! 👋 Welcome to Macro — great to have you here.\n\
\n\
I'm the built-in assistant. You can @mention me anytime in a channel or chat and I'll help out: summarizing threads, drafting emails, digging through your docs and messages, managing tasks, whatever you need. Just ask.\n\
\n\
Excited for you to dive in."
    );

    gateway
        .post_message(
            Sender::new_from_bot(MACRO_AI_BOT_ID),
            channel_id,
            PostMessageRequest {
                content: assistant_reply,
                mentions: Vec::new(),
                thread_id: Some(welcome_message_id),
                attachments: Vec::new(),
                nonce: None,
                notification_policy: PostMessageNotificationPolicy::Default,
                // Julia's message asks Macro to say hi, so she is the
                // triggering user — the same attribution a real
                // mention-triggered agent reply would carry.
                triggered_by: Some(julia.to_string()),
            },
        )
        .await?;

    gateway
        .post_message(
            Sender::new_from_user(julia),
            channel_id,
            PostMessageRequest {
                content: "If you have any feedback or find any bugs let us know here.".to_string(),
                mentions: Vec::new(),
                thread_id: None,
                attachments: Vec::new(),
                nonce: None,
                notification_policy: PostMessageNotificationPolicy::Default,
                triggered_by: None,
            },
        )
        .await?;

    Ok(())
}
