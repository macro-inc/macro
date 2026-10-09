use super::*;
use agent_session::domain::{agent_conversation::ConversationSession, model::AgentSessionId};
use bot_id::BotId;
use channels::domain::{channel_agents::ChannelAgent, ports::ChannelMutationErr};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

struct Channels(Vec<ChannelAgent>);
impl ChannelAgentRepo for Channels {
    async fn agents_in(
        &self,
        channel_id: Uuid,
    ) -> std::result::Result<Vec<ChannelAgent>, ChannelMutationErr> {
        Ok(self
            .0
            .iter()
            .filter(|agent| agent.channel_id == channel_id)
            .cloned()
            .collect())
    }
    async fn find(
        &self,
        _: Uuid,
        _: BotId,
    ) -> std::result::Result<Option<ChannelAgent>, ChannelMutationErr> {
        unreachable!("routing lists the channel's agents")
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
impl AgentConversationRepo for Sessions {
    async fn sessions(&self, _: AgentConversation) -> Result<Vec<ConversationSession>> {
        Ok(Vec::new())
    }
    async fn current_or_create(&self, conversation: AgentConversation) -> Result<AgentSessionId> {
        assert_eq!(conversation.bot_id, BotId::TEST_A);
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(AgentSessionId::TEST_A)
    }
    async fn current(&self, _: AgentConversation) -> Result<Option<AgentSessionId>> {
        Ok(Some(AgentSessionId::TEST_A))
    }
    async fn start_fresh(&self, _: AgentConversation) -> Result<AgentSessionId> {
        panic!("a new message never resets context")
    }
    async fn conversation_for_session(
        &self,
        _: AgentSessionId,
    ) -> Result<Option<AgentConversation>> {
        Ok(Some(AgentConversation {
            channel_id: Uuid::from_u128(1),
            bot_id: BotId::TEST_A,
        }))
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

fn direct() -> ChannelAgent {
    ChannelAgent {
        channel_id: Uuid::from_u128(1),
        bot_id: BotId::TEST_A,
        kind: ChannelAgentKind::Direct { user_id: owner() },
    }
}

fn message() -> MessagePostedMetadata {
    MessagePostedMetadata {
        parent: MessageParent::Channel(Uuid::from_u128(1)),
        message_id: Uuid::from_u128(2),
        root_id: Uuid::from_u128(2),
        thread_id: None,
        sender: channel_sender::ChannelSender::new_from_user(owner()),
        triggered_by: None,
        content: "Continue our conversation".to_owned(),
        mentions: vec![],
        attachments: vec![],
        created_at: chrono::Utc::now(),
    }
}

#[tokio::test]
async fn unmentioned_messages_always_address_the_direct_persona_and_session() {
    let router = ConversationRouter::new(
        Channels(vec![direct()]),
        Personas(true),
        Sessions::default(),
    );
    let first = message();
    let mut next = first.clone();
    next.message_id = Uuid::from_u128(3);
    next.root_id = next.message_id;
    for post in [first, next] {
        let ConversationDecision::Deliver(decisions) = router.evaluate(&post).await.unwrap() else {
            panic!("expected delivery")
        };
        let [
            TriggerDecision::ConversationMessage {
                bot_id,
                session_id,
                message,
            },
        ] = decisions.as_slice()
        else {
            panic!("expected one conversation delivery")
        };
        assert_eq!(*bot_id, BotId::TEST_A);
        assert_eq!(*session_id, AgentSessionId::TEST_A);
        assert_eq!(*message, post);
    }
}

#[tokio::test]
async fn a_bot_or_another_user_cannot_spend_the_direct_owners_credentials() {
    let sessions = Sessions::default();
    let router =
        ConversationRouter::new(Channels(vec![direct()]), Personas(true), sessions.clone());
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
            ConversationDecision::Unavailable
        ));
    }
    assert_eq!(sessions.0.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn revoked_persona_access_never_reserves_a_session_or_falls_back_to_mentions() {
    let sessions = Sessions::default();
    let router =
        ConversationRouter::new(Channels(vec![direct()]), Personas(false), sessions.clone());
    assert!(matches!(
        router.evaluate(&message()).await.unwrap(),
        ConversationDecision::Unavailable
    ));
    assert_eq!(sessions.0.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn channels_without_a_conversing_agent_keep_the_existing_trigger_path() {
    let sessions = Sessions::default();
    let member = ChannelAgent {
        kind: ChannelAgentKind::Member,
        ..direct()
    };
    for agents in [Vec::new(), vec![member]] {
        let router = ConversationRouter::new(Channels(agents), Personas(true), sessions.clone());
        assert!(matches!(
            router.evaluate(&message()).await.unwrap(),
            ConversationDecision::NotConversation
        ));
    }
    assert_eq!(sessions.0.load(Ordering::SeqCst), 0);
}
