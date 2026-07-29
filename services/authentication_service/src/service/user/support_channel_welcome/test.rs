use std::sync::{Arc, Mutex};

use super::*;

#[derive(Clone, Default)]
struct RecordingGateway {
    posted: Arc<Mutex<Vec<PostedWelcomeMessage>>>,
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
        self.posted.lock().unwrap().push(PostedWelcomeMessage {
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

const NEW_USER_MENTION: &str = "<m-user-mention>{\"userId\":\"macro|new.user@example.com\",\"email\":\"new.user@example.com\"}</m-user-mention>";

fn expected_welcome() -> String {
    format!(
        concat!(
            "Hey {new_user},\n",
            "\n",
            "Welcome to Macro, we're excited for you to try it out.\n",
            "\n",
            "This is your own personal support Channel, with <m-user-mention>{{\"userId\":\"macro|jacob@macro.com\",\"email\":\"jacob@macro.com\"}}</m-user-mention> (ceo) and <m-user-mention>{{\"userId\":\"macro|teo@macro.com\",\"email\":\"teo@macro.com\"}}</m-user-mention> (cto) and me (julia).\n",
            "\n",
            "If you have any feedback or find any bugs let us know here.",
        ),
        new_user = NEW_USER_MENTION,
    )
}

#[tokio::test]
async fn posts_the_welcome_message() {
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
    let [welcome] = posted.as_slice() else {
        panic!("expected exactly one posted message, got {}", posted.len());
    };

    assert_eq!(welcome.channel_id, channel_id);
    assert_eq!(welcome.actor.as_user(), Some(&user_id("julia@macro.com")));
    assert_eq!(welcome.request.content, expected_welcome());
    assert_eq!(
        welcome.request.mentions,
        vec![SimpleMention::user(&user_id("new.user@example.com"))]
    );
    assert_eq!(welcome.request.thread_id, None);
    assert!(welcome.request.attachments.is_empty());
    assert_eq!(welcome.request.nonce, None);
    assert_eq!(
        welcome.request.notification_policy,
        PostMessageNotificationPolicy::MentionsOnly
    );
    assert_eq!(welcome.request.triggered_by, None);
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
    assert!(gateway.posted.lock().unwrap().is_empty());
}
