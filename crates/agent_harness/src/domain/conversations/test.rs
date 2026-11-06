use super::*;
use agent_session::domain::{error::Result as SessionResult, model::AgentSessionId};
use bot_id::BotId;
use bots::domain::ports::MockBotRepo;
use channels::domain::ports::ChannelMutationErr;
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

struct Channels(Vec<ChannelAgent>);
impl ChannelAgentRepo for Channels {
    async fn agents_in(&self, channel_id: Uuid) -> Result<Vec<ChannelAgent>, ChannelMutationErr> {
        Ok(self
            .0
            .iter()
            .filter(|agent| agent.channel_id == channel_id)
            .cloned()
            .collect())
    }
    async fn find(
        &self,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> Result<Option<ChannelAgent>, ChannelMutationErr> {
        Ok(self
            .0
            .iter()
            .find(|agent| agent.channel_id == channel_id && agent.bot_id == bot_id)
            .cloned())
    }
}

struct Eligibility {
    available: bool,
    calls: Arc<AtomicUsize>,
}
impl AgentDmEligibility for Eligibility {
    async fn authorize_agent_dm(
        &self,
        _: MacroUserIdStr<'static>,
        _: BotId,
    ) -> Result<(), BotError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.available {
            Ok(())
        } else {
            Err(BotError::Unauthorized)
        }
    }
}

struct Sessions;
impl AgentConversationRepo for Sessions {
    async fn current_or_create(&self, _: AgentConversation) -> SessionResult<AgentSessionId> {
        panic!("read allocates no runtime")
    }
    async fn current(&self, _: AgentConversation) -> SessionResult<Option<AgentSessionId>> {
        Ok(Some(AgentSessionId::TEST_A))
    }
    async fn start_fresh(&self, _: AgentConversation) -> SessionResult<AgentSessionId> {
        panic!("read does not reset")
    }
    async fn conversation_for_session(
        &self,
        _: AgentSessionId,
    ) -> SessionResult<Option<AgentConversation>> {
        Ok(Some(AgentConversation {
            channel_id: channel(),
            bot_id: BotId::TEST_A,
        }))
    }
    async fn sessions(&self, _: AgentConversation) -> SessionResult<Vec<ConversationSession>> {
        Ok(vec![session()])
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}
fn channel() -> Uuid {
    Uuid::from_u128(1)
}
fn direct() -> ChannelAgent {
    ChannelAgent {
        channel_id: channel(),
        bot_id: BotId::TEST_A,
        kind: ChannelAgentKind::Direct { user_id: owner() },
    }
}
fn session() -> ConversationSession {
    ConversationSession {
        session_id: AgentSessionId::TEST_A,
        created_at: chrono::DateTime::from_timestamp(1, 0).unwrap(),
        is_current: true,
    }
}

#[tokio::test]
async fn a_teammate_cannot_read_the_personas_conversation_with_its_owner() {
    let calls = Arc::new(AtomicUsize::new(0));
    let service = AgentConversationsService::new(
        Channels(vec![direct()]),
        Eligibility {
            available: true,
            calls: calls.clone(),
        },
        MockBotRepo::new(),
        Sessions,
    );
    let teammate = MacroUserIdStr::try_from_email("teammate@example.com").unwrap();
    assert!(
        service
            .list(teammate.clone(), channel())
            .await
            .unwrap()
            .is_empty()
    );
    let conversation = AgentConversation {
        channel_id: channel(),
        bot_id: BotId::TEST_A,
    };
    assert!(matches!(
        service
            .start_fresh(teammate, conversation, AgentSessionId::TEST_A)
            .await,
        Err(ConversationError::NotFound)
    ));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn revoked_personas_keep_their_history_and_profile_but_cannot_be_prompted() {
    let mut bots = MockBotRepo::new();
    bots.expect_get_bot_profiles()
        .withf(|ids| ids == [BotId::TEST_A])
        .times(1)
        .returning(|_| {
            Box::pin(async {
                Ok(HashMap::from([(
                    BotId::TEST_A,
                    BotProfile {
                        id: BotId::TEST_A,
                        name: "Researcher".to_owned(),
                        avatar_url: Some("avatar.png".to_owned()),
                    },
                )]))
            })
        });
    let service = AgentConversationsService::new(
        Channels(vec![direct()]),
        Eligibility {
            available: false,
            calls: Default::default(),
        },
        bots,
        Sessions,
    );
    let [overview] = service
        .list(owner(), channel())
        .await
        .unwrap()
        .try_into()
        .unwrap_or_else(|_| panic!("expected the owner's one conversation"));
    assert!(!overview.available);
    assert_eq!(overview.persona.name, "Researcher");
    assert_eq!(overview.sessions, vec![session()]);
}

#[tokio::test]
async fn ordinary_channels_have_no_agent_conversation() {
    let calls = Arc::new(AtomicUsize::new(0));
    let service = AgentConversationsService::new(
        Channels(Vec::new()),
        Eligibility {
            available: true,
            calls: calls.clone(),
        },
        MockBotRepo::new(),
        Sessions,
    );
    assert!(service.list(owner(), channel()).await.unwrap().is_empty());
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_shared_channel_member_has_no_controls_and_takes_no_prompts_yet() {
    let calls = Arc::new(AtomicUsize::new(0));
    let service = AgentConversationsService::new(
        Channels(vec![ChannelAgent {
            kind: ChannelAgentKind::Member,
            ..direct()
        }]),
        Eligibility {
            available: true,
            calls: calls.clone(),
        },
        MockBotRepo::new(),
        Sessions,
    );
    assert!(service.list(owner(), channel()).await.unwrap().is_empty());
    let prompt = service
        .authorize_prompt(AgentSessionId::TEST_A, BotId::TEST_A, Some(&owner()))
        .await;
    assert!(matches!(prompt, Err(AgentSessionError::Forbidden)));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn dispatch_rechecks_persona_access_and_the_exact_owner() {
    let calls = Arc::new(AtomicUsize::new(0));
    let service = AgentConversationsService::new(
        Channels(vec![direct()]),
        Eligibility {
            available: false,
            calls: calls.clone(),
        },
        MockBotRepo::new(),
        Sessions,
    );
    let teammate = MacroUserIdStr::try_from_email("teammate@example.com").unwrap();
    let wrong_actor = service
        .authorize_prompt(AgentSessionId::TEST_A, BotId::TEST_A, Some(&teammate))
        .await;
    assert!(matches!(wrong_actor, Err(AgentSessionError::Forbidden)));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let wrong_persona = service
        .authorize_prompt(AgentSessionId::TEST_A, BotId::TEST_B, Some(&owner()))
        .await;
    assert!(matches!(wrong_persona, Err(AgentSessionError::Forbidden)));
    let revoked = service
        .authorize_prompt(AgentSessionId::TEST_A, BotId::TEST_A, Some(&owner()))
        .await;
    assert!(matches!(revoked, Err(AgentSessionError::Forbidden)));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(
        service
            .is_conversation_session(AgentSessionId::TEST_A)
            .await
            .unwrap()
    );
}
