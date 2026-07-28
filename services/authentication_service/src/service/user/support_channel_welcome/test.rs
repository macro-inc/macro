use std::sync::{Arc, Mutex};

use super::*;

#[derive(Clone, Default)]
struct RecordingGateway {
    posted: Arc<Mutex<Vec<PostedWelcomeMessage>>>,
}

struct PostedWelcomeMessage {
    id: Uuid,
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
    ) -> Result<Uuid, Report> {
        let id = Uuid::new_v4();
        self.posted.lock().unwrap().push(PostedWelcomeMessage {
            id,
            actor,
            channel_id,
            request,
        });
        Ok(id)
    }
}

fn user_id(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn how_to_guide() -> StarterDocHowToGuide {
    StarterDocHowToGuide {
        document_id: "1af9022e-6d0d-4f9c-8bc4-4b1f9a2f47d0".to_string(),
        document_name: "Macro how to guide".to_string(),
    }
}

const NEW_USER_MENTION: &str = "<m-user-mention>{\"userId\":\"macro|new.user@example.com\",\"email\":\"new.user@example.com\"}</m-user-mention>";
const MACRO_MENTION: &str = "<m-user-mention>{\"userId\":\"bot|00000000-0000-0000-0000-00000000a1a1\",\"email\":\"Macro\"}</m-user-mention>";

fn expected_welcome(document_example: &str) -> String {
    format!(
        concat!(
            "Hey {new_user},\n",
            "\n",
            "Welcome to Macro, we're excited for you to try it out.\n",
            "\n",
            "This is your own personal support Channel, with <m-user-mention>{{\"userId\":\"macro|jacob@macro.com\",\"email\":\"jacob@macro.com\"}}</m-user-mention> (ceo) and <m-user-mention>{{\"userId\":\"macro|teo@macro.com\",\"email\":\"teo@macro.com\"}}</m-user-mention> (cto) and me (julia).\n",
            "\n",
            "Channels are how you stay in touch with other people on Macro.\n",
            "\n",
            "You can @mention people to get their attention. They'll get a separate notification in their inbox (like you'll see for this message).\n",
            "\n",
            "You can @mention documents{document_example}. Mentioning a document shares it with the other participants.\n",
            "\n",
            "You can even @mention our chat assistant, {macro_bot}. Say hi to {new_user}, {macro_bot}.",
        ),
        new_user = NEW_USER_MENTION,
        macro_bot = MACRO_MENTION,
        document_example = document_example,
    )
}

fn expected_assistant_reply() -> String {
    format!(
        concat!(
            "Hey {new_user}! 👋 Welcome to Macro — great to have you here.\n",
            "\n",
            "I'm the built-in assistant. You can @mention me anytime in a channel or chat and I'll help out: summarizing threads, drafting emails, digging through your docs and messages, managing tasks, whatever you need. Just ask.\n",
            "\n",
            "Excited for you to dive in.",
        ),
        new_user = NEW_USER_MENTION,
    )
}

#[tokio::test]
async fn posts_the_welcome_script_with_the_guide_mentioned() {
    let channel_id = Uuid::new_v4();
    let gateway = RecordingGateway::default();

    post_support_channel_welcome(
        &gateway,
        &channel_id.to_string(),
        user_id("new.user@example.com"),
        Some(&how_to_guide()),
    )
    .await
    .unwrap();

    let posted = gateway.posted.lock().unwrap();
    let [welcome, reply, feedback] = posted.as_slice() else {
        panic!(
            "expected exactly three posted messages, got {}",
            posted.len()
        );
    };
    assert!(
        posted
            .iter()
            .all(|message| message.channel_id == channel_id)
    );

    assert_eq!(welcome.actor.as_user(), Some(&user_id("julia@macro.com")));
    assert_eq!(
        welcome.request.content,
        expected_welcome(
            ", like this: <m-document-mention>{\"documentId\":\"1af9022e-6d0d-4f9c-8bc4-4b1f9a2f47d0\",\"blockName\":\"md\",\"documentName\":\"Macro how to guide\",\"blockParams\":{},\"collapsed\":false}</m-document-mention>"
        )
    );
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

    assert_eq!(reply.actor, Sender::new_from_bot(MACRO_AI_BOT_ID));
    assert_eq!(reply.request.content, expected_assistant_reply());
    assert!(reply.request.mentions.is_empty());
    assert_eq!(reply.request.thread_id, Some(welcome.id));
    assert_eq!(
        reply.request.triggered_by,
        Some("macro|julia@macro.com".to_string())
    );
    assert_eq!(
        reply.request.notification_policy,
        PostMessageNotificationPolicy::Default
    );

    assert_eq!(feedback.actor.as_user(), Some(&user_id("julia@macro.com")));
    assert_eq!(
        feedback.request.content,
        "If you have any feedback or find any bugs let us know here."
    );
    assert!(feedback.request.mentions.is_empty());
    assert_eq!(feedback.request.thread_id, None);
    assert_eq!(feedback.request.triggered_by, None);
}

#[tokio::test]
async fn omits_the_document_example_when_the_guide_is_missing() {
    let channel_id = Uuid::new_v4();
    let gateway = RecordingGateway::default();

    post_support_channel_welcome(
        &gateway,
        &channel_id.to_string(),
        user_id("new.user@example.com"),
        None,
    )
    .await
    .unwrap();

    let posted = gateway.posted.lock().unwrap();
    assert_eq!(posted.len(), 3);
    assert_eq!(posted[0].request.content, expected_welcome(""));
}

#[tokio::test]
async fn rejects_an_invalid_channel_id_without_posting() {
    let gateway = RecordingGateway::default();

    let error = post_support_channel_welcome(
        &gateway,
        "not-a-uuid",
        user_id("new.user@example.com"),
        None,
    )
    .await
    .unwrap_err();

    assert_eq!(
        error.downcast_current_context::<&str>().copied(),
        Some("support channel returned an invalid id")
    );
    assert!(gateway.posted.lock().unwrap().is_empty());
}
