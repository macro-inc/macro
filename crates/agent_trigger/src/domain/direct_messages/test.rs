use super::*;
use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use channels::domain::{
    agent_dm::{AgentDm, EnsuredAgentDm},
    ports::ChannelMutationErr,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

struct Channels(Option<AgentDm>);
impl AgentDmRepo for Channels {
    async fn for_user(
        &self,
        _: MacroUserIdStr<'static>,
    ) -> std::result::Result<Vec<AgentDm>, ChannelMutationErr> {
        unreachable!("routing reads only its channel")
    }
    async fn ensure(
        &self,
        _: MacroUserIdStr<'static>,
        _: BotId,
    ) -> std::result::Result<EnsuredAgentDm, ChannelMutationErr> {
        panic!("routing never creates a channel")
    }
    async fn find(
        &self,
        channel_id: Uuid,
    ) -> std::result::Result<Option<AgentDm>, ChannelMutationErr> {
        Ok(self.0.clone().filter(|dm| dm.channel_id == channel_id))
    }
}

struct Personas(bool);
impl AgentDmEligibility for Personas {
    async fn authorize_agent_dm(
        &self,
        _: MacroUserIdStr<'static>,
        bot: BotId,
    ) -> std::result::Result<(), BotError> {
        assert_eq!(bot, BotId::TEST_A);
        if self.0 {
            Ok(())
        } else {
            Err(BotError::Unauthorized)
        }
    }
}

#[derive(Clone, Default)]
struct Sessions(Arc<AtomicUsize>);
impl AgentDmConversationRepo for Sessions {
    async fn segments(
        &self,
        _: Uuid,
    ) -> Result<Vec<agent_session::domain::agent_dm::AgentDmSegment>> {
        Ok(Vec::new())
    }
    async fn current_or_create(&self, _: Uuid) -> Result<AgentSessionId> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(AgentSessionId::TEST_A)
    }
    async fn current(&self, _: Uuid) -> Result<Option<AgentSessionId>> {
        Ok(Some(AgentSessionId::TEST_A))
    }
    async fn start_fresh(&self, _: Uuid) -> Result<AgentSessionId> {
        panic!("a new message never resets context")
    }
    async fn channel_for_session(&self, _: AgentSessionId) -> Result<Option<Uuid>> {
        Ok(Some(Uuid::from_u128(1)))
    }
}

fn dm() -> AgentDm {
    AgentDm {
        channel_id: Uuid::from_u128(1),
        user_id: MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
        bot_id: BotId::TEST_A,
    }
}
fn message() -> MessagePostedMetadata {
    let dm = dm();
    MessagePostedMetadata {
        parent: MessageParent::Channel(dm.channel_id),
        message_id: Uuid::from_u128(2),
        root_id: Uuid::from_u128(2),
        thread_id: None,
        sender: channel_sender::ChannelSender::new_from_user(dm.user_id),
        triggered_by: None,
        content: "Continue our conversation".to_owned(),
        mentions: vec![],
        attachments: vec![],
        created_at: chrono::Utc::now(),
    }
}

#[tokio::test]
async fn unmentioned_messages_always_address_the_bound_persona_and_session() {
    let router =
        DirectMessageRouter::new(Channels(Some(dm())), Personas(true), Sessions::default());
    let first = message();
    let mut next = first.clone();
    next.message_id = Uuid::from_u128(3);
    next.root_id = next.message_id;
    for post in [first, next] {
        let DirectMessageDecision::Deliver(decision) = router.evaluate(&post).await.unwrap() else {
            panic!("expected direct delivery")
        };
        let TriggerDecision::DirectMessage {
            bot_id,
            session_id,
            message,
        } = *decision
        else {
            panic!("expected direct delivery")
        };
        assert_eq!(bot_id, BotId::TEST_A);
        assert_eq!(session_id, AgentSessionId::TEST_A);
        assert_eq!(message, post);
    }
}

#[tokio::test]
async fn a_bot_or_another_user_cannot_spend_the_dm_owners_credentials() {
    let sessions = Sessions::default();
    let router = DirectMessageRouter::new(Channels(Some(dm())), Personas(true), sessions.clone());
    for sender in [
        channel_sender::ChannelSender::new_from_bot(BotId::TEST_A),
        channel_sender::ChannelSender::new_from_user(
            MacroUserIdStr::try_from_email("other@example.com").unwrap(),
        ),
    ] {
        let mut post = message();
        post.sender = sender;
        assert!(matches!(
            router.evaluate(&post).await.unwrap(),
            DirectMessageDecision::Unavailable
        ));
    }
    assert_eq!(sessions.0.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn revoked_persona_access_never_reserves_a_session_or_falls_back_to_mentions() {
    let sessions = Sessions::default();
    let router = DirectMessageRouter::new(Channels(Some(dm())), Personas(false), sessions.clone());
    assert!(matches!(
        router.evaluate(&message()).await.unwrap(),
        DirectMessageDecision::Unavailable
    ));
    assert_eq!(sessions.0.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn ordinary_channels_keep_the_existing_trigger_path() {
    let sessions = Sessions::default();
    let router = DirectMessageRouter::new(Channels(None), Personas(true), sessions.clone());
    assert!(matches!(
        router.evaluate(&message()).await.unwrap(),
        DirectMessageDecision::NotDirectMessage
    ));
    assert_eq!(sessions.0.load(Ordering::SeqCst), 0);
}
