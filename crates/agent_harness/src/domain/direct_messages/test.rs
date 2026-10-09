use super::*;
use agent_session::domain::{error::Result as SessionResult, model::AgentSessionId};
use bot_id::BotId;
use bots::domain::ports::MockBotRepo;
use channels::domain::{
    agent_dm::{AgentDm, EnsuredAgentDm},
    ports::ChannelMutationErr,
};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

struct Channels(Option<AgentDm>);
impl AgentDmRepo for Channels {
    async fn ensure(
        &self,
        _: MacroUserIdStr<'static>,
        _: BotId,
    ) -> Result<EnsuredAgentDm, ChannelMutationErr> {
        panic!("a read must never create a DM")
    }
    async fn find(&self, _: Uuid) -> Result<Option<AgentDm>, ChannelMutationErr> {
        Ok(self.0.clone())
    }
    async fn for_user(
        &self,
        _: MacroUserIdStr<'static>,
    ) -> Result<Vec<AgentDm>, ChannelMutationErr> {
        panic!("a detail read must not enumerate conversations")
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
impl AgentDmConversationRepo for Sessions {
    async fn current_or_create(&self, _: Uuid) -> SessionResult<AgentSessionId> {
        panic!("read allocates no runtime")
    }
    async fn current(&self, _: Uuid) -> SessionResult<Option<AgentSessionId>> {
        Ok(Some(AgentSessionId::TEST_A))
    }
    async fn start_fresh(&self, _: Uuid) -> SessionResult<AgentSessionId> {
        panic!("read does not reset")
    }
    async fn channel_for_session(&self, _: AgentSessionId) -> SessionResult<Option<Uuid>> {
        Ok(Some(dm().channel_id))
    }
    async fn segments(&self, _: Uuid) -> SessionResult<Vec<AgentDmSegment>> {
        Ok(vec![segment()])
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}
fn dm() -> AgentDm {
    AgentDm {
        channel_id: Uuid::from_u128(1),
        user_id: owner(),
        bot_id: BotId::TEST_A,
    }
}
fn segment() -> AgentDmSegment {
    AgentDmSegment {
        session_id: AgentSessionId::TEST_A,
        created_at: chrono::DateTime::from_timestamp(1, 0).unwrap(),
        is_current: true,
    }
}

#[tokio::test]
async fn a_teammate_cannot_read_the_personas_dm_with_its_owner() {
    let calls = Arc::new(AtomicUsize::new(0));
    let service = AgentDmConversationsService::new(
        Channels(Some(dm())),
        Eligibility {
            available: true,
            calls: calls.clone(),
        },
        MockBotRepo::new(),
        Sessions,
    );
    let result = service
        .get(
            MacroUserIdStr::try_from_email("teammate@example.com").unwrap(),
            dm().channel_id,
        )
        .await;
    assert!(matches!(result, Err(AgentDmError::NotFound)));
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
    let service = AgentDmConversationsService::new(
        Channels(Some(dm())),
        Eligibility {
            available: false,
            calls: Default::default(),
        },
        bots,
        Sessions,
    );
    let result = service
        .get(owner(), dm().channel_id)
        .await
        .unwrap()
        .unwrap();
    assert!(!result.available);
    assert_eq!(result.persona.name, "Researcher");
    assert_eq!(result.segments, vec![segment()]);
}

#[tokio::test]
async fn ordinary_channels_have_no_agent_conversation() {
    let calls = Arc::new(AtomicUsize::new(0));
    let service = AgentDmConversationsService::new(
        Channels(None),
        Eligibility {
            available: true,
            calls: calls.clone(),
        },
        MockBotRepo::new(),
        Sessions,
    );
    assert!(
        service
            .get(owner(), dm().channel_id)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn dispatch_rechecks_persona_access_and_the_exact_dm_owner() {
    let calls = Arc::new(AtomicUsize::new(0));
    let service = AgentDmConversationsService::new(
        Channels(Some(dm())),
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
    let revoked = service
        .authorize_prompt(AgentSessionId::TEST_A, BotId::TEST_A, Some(&owner()))
        .await;
    assert!(matches!(revoked, Err(AgentSessionError::Forbidden)));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(service.is_dm_session(AgentSessionId::TEST_A).await.unwrap());
}
