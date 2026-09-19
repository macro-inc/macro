use std::sync::{Arc, Mutex};

use chrono::{TimeDelta, Utc};

use super::*;

#[derive(Default)]
struct Authorizer {
    calls: Mutex<Vec<(MacroUserIdStr<'static>, Uuid)>>,
    fail: bool,
}

impl ChannelContextAuthorizer for Authorizer {
    async fn authorize_member(
        &self,
        actor: &MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<()> {
        self.calls.lock().unwrap().push((actor.clone(), channel_id));
        if self.fail {
            return Err(HarnessError::PromptContext(rootcause::report!(
                "not a channel member"
            )));
        }
        Ok(())
    }
}

#[derive(Default)]
struct Source {
    messages: Vec<ChannelContextMessage>,
    calls: Mutex<Vec<(Uuid, Uuid, i64)>>,
}

impl ChannelContextSource for Source {
    async fn message_context(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        before: i64,
    ) -> Result<Vec<ChannelContextMessage>> {
        self.calls
            .lock()
            .unwrap()
            .push((channel_id, message_id, before));
        let Some(target) = self
            .messages
            .iter()
            .position(|message| message.id == message_id)
        else {
            return Ok(Vec::new());
        };
        let start = target.saturating_sub(before as usize);
        Ok(self.messages[start..=target].to_vec())
    }
}

fn message(id: u128, sender: &str, content: &str, deleted: bool) -> ChannelContextMessage {
    let created_at = Utc::now() + TimeDelta::seconds(id as i64);
    ChannelContextMessage {
        id: Uuid::from_u128(id),
        channel_id: Uuid::from_u128(1),
        thread_id: None,
        sender_id: sender.to_owned(),
        triggered_by: None,
        bot_profile: None,
        content: content.to_owned(),
        created_at,
        updated_at: created_at,
        edited_at: None,
        deleted_at: deleted.then_some(created_at),
    }
}

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("actor@example.com").unwrap()
}

#[tokio::test]
async fn adapter_authorizes_and_returns_only_live_preceding_messages_in_order() {
    let channel_id = Uuid::from_u128(1);
    let trigger_id = Uuid::from_u128(4);
    let source = Arc::new(Source {
        messages: vec![
            message(1, "first", "one", false),
            message(2, "deleted", "two", true),
            message(3, "third", "three", false),
            message(4, "actor", "trigger", false),
        ],
        calls: Mutex::default(),
    });
    let authorizer = Arc::new(Authorizer::default());
    let adapter = ChannelPromptContextAdapter::new(source.clone(), authorizer.clone());

    adapter
        .authorize_member(&actor(), channel_id)
        .await
        .unwrap();
    let messages = adapter
        .preceding_messages(channel_id, trigger_id)
        .await
        .unwrap();

    assert_eq!(
        messages,
        vec![
            PriorChannelMessage {
                sender: "first".to_owned(),
                content: "one".to_owned(),
            },
            PriorChannelMessage {
                sender: "third".to_owned(),
                content: "three".to_owned(),
            },
        ]
    );
    assert_eq!(
        source.calls.lock().unwrap().as_slice(),
        &[(channel_id, trigger_id, 10)]
    );
    assert_eq!(
        authorizer.calls.lock().unwrap().as_slice(),
        &[(actor(), channel_id)]
    );
}

#[tokio::test]
async fn deleted_rows_do_not_consume_the_ten_message_limit() {
    let channel_id = Uuid::from_u128(1);
    let trigger_id = Uuid::from_u128(13);
    let source = Arc::new(Source {
        messages: (1..=13)
            .map(|id| {
                message(
                    id,
                    &format!("sender-{id}"),
                    &format!("message-{id}"),
                    id == 10,
                )
            })
            .collect(),
        calls: Mutex::default(),
    });
    let adapter = ChannelPromptContextAdapter::new(source.clone(), Arc::new(Authorizer::default()));

    adapter
        .authorize_member(&actor(), channel_id)
        .await
        .unwrap();
    let messages = adapter
        .preceding_messages(channel_id, trigger_id)
        .await
        .unwrap();

    assert_eq!(messages.len(), 10);
    assert_eq!(messages.first().unwrap().content, "message-2");
    assert_eq!(messages.last().unwrap().content, "message-12");
    assert_eq!(
        source.calls.lock().unwrap().as_slice(),
        &[(channel_id, trigger_id, 10), (channel_id, trigger_id, 20)]
    );
}

#[tokio::test]
async fn denied_membership_prevents_the_channel_fetch() {
    let source = Arc::new(Source::default());
    let authorizer = Arc::new(Authorizer {
        fail: true,
        ..Default::default()
    });
    let adapter = ChannelPromptContextAdapter::new(source.clone(), authorizer);

    let result = adapter.authorize_member(&actor(), Uuid::from_u128(1)).await;

    assert!(matches!(result, Err(HarnessError::PromptContext(_))));
    assert!(source.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn bot_authored_prompts_use_the_observed_channel_without_user_authorization() {
    let channel_id = Uuid::from_u128(1);
    let trigger_id = Uuid::from_u128(2);
    let source = Arc::new(Source {
        messages: vec![
            message(1, "user", "context", false),
            message(2, "bot", "trigger", false),
        ],
        calls: Mutex::default(),
    });
    let authorizer = Arc::new(Authorizer::default());
    let adapter = ChannelPromptContextAdapter::new(source, authorizer.clone());

    let messages = adapter
        .preceding_messages(channel_id, trigger_id)
        .await
        .unwrap();

    assert_eq!(messages.len(), 1);
    assert!(authorizer.calls.lock().unwrap().is_empty());
}
