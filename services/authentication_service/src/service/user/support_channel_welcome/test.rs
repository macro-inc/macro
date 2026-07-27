use std::sync::{Arc, Mutex};

use super::*;

#[derive(Clone, Default)]
struct RecordingGateway {
    posted: Arc<Mutex<Option<PostedWelcomeMessage>>>,
}

struct PostedWelcomeMessage {
    actor: Sender,
    channel_id: Uuid,
    request: PostMessageRequest,
}

impl SupportChannelMessageGateway for RecordingGateway {
    async fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        request: PostMessageRequest,
    ) -> Result<(), Report> {
        *self.posted.lock().unwrap() = Some(PostedWelcomeMessage {
            actor,
            channel_id,
            request,
        });
        Ok(())
    }
}

fn user_id(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

#[tokio::test]
async fn posts_welcome_as_julia_and_notifies_only_the_new_user() {
    let channel_id = Uuid::new_v4();
    let gateway = RecordingGateway::default();

    post_support_channel_welcome(
        &gateway,
        &channel_id.to_string(),
        user_id("new.user@example.com"),
    )
    .await
    .unwrap();

    let posted = gateway.posted.lock().unwrap();
    let posted = posted.as_ref().unwrap();
    assert_eq!(posted.actor.as_user(), Some(&user_id("julia@macro.com")));
    assert_eq!(posted.channel_id, channel_id);
    assert_eq!(
        posted.request.content,
        concat!(
            "Hey <m-user-mention>{\"userId\":\"macro|new.user@example.com\",\"email\":\"new.user@example.com\"}</m-user-mention>,\n",
            "Thanks signing up for Macro, we're excited for you to try it out.\n",
            "In case you need any help, this is a support channel with <m-user-mention>{\"userId\":\"macro|jacob@macro.com\",\"email\":\"jacob@macro.com\"}</m-user-mention> (the ceo) and <m-user-mention>{\"userId\":\"macro|teo@macro.com\",\"email\":\"teo@macro.com\"}</m-user-mention> (the cto).\n",
            "If you have any feedback or find any bugs let us know here!\n",
            "Julia",
        )
    );
    assert_eq!(
        posted.request.mentions,
        vec![SimpleMention::user(&user_id("new.user@example.com"))]
    );
    assert_eq!(posted.request.thread_id, None);
    assert!(posted.request.attachments.is_empty());
    assert_eq!(posted.request.nonce, None);
    assert_eq!(
        posted.request.notification_policy,
        PostMessageNotificationPolicy::MentionsOnly
    );
    assert_eq!(posted.request.triggered_by, None);
}

#[tokio::test]
async fn rejects_an_invalid_channel_id_without_posting() {
    let gateway = RecordingGateway::default();

    let error =
        post_support_channel_welcome(&gateway, "not-a-uuid", user_id("new.user@example.com"))
            .await
            .unwrap_err();

    assert_eq!(
        error.downcast_current_context::<&str>().copied(),
        Some("support channel returned an invalid id")
    );
    assert!(gateway.posted.lock().unwrap().is_none());
}
