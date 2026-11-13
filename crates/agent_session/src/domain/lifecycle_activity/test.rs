use ::activity::{Activity, Actor, EntityType, Ingest};
use bots::domain::models::BotId;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use uuid::Uuid;

use super::*;
use crate::domain::{
    events::{SessionDeletedMetadata, SessionIdentity, SessionOpenedMetadata, TurnStartedMetadata},
    model::{AgentSessionId, TurnId},
};

#[test]
fn a_person_opening_a_session_is_their_own_work_from_the_moment_it_opens() {
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com")
        .expect("valid user id")
        .into_owned();
    let event_id = Uuid::now_v7();
    let opened = AgentSessionLifecycleEvent::Opened(SessionOpenedMetadata {
        identity: SessionIdentity {
            session_id: AgentSessionId::TEST_A,
            session_name: "Fix the flaky test".to_owned(),
            bot_id: BotId::TEST_A,
            bot_name: "Macro Coder".to_owned(),
            owner_id: owner.clone(),
            visibility: messages::domain::models::MessageVisibility::Public,
            origin: None,
            audience: vec![owner.clone()],
            source: SessionSource::User,
        },
        model: "claude".to_owned(),
        harness: "claude_code".to_owned(),
    });

    assert_eq!(
        opened.ingest(event_id),
        Ingest::Insert(vec![Activity::common(
            event_id,
            0,
            Actor::new_from_user(owner),
            None,
            EntityType::AgentSession,
            AgentSessionId::TEST_A.to_string(),
            CommonAction::Created,
            event_time(event_id),
        )])
    );
}

#[test]
fn sessions_started_by_an_agent_or_a_routine_are_nobodys_work() {
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com")
        .expect("valid user id")
        .into_owned();
    for source in [SessionSource::Agent, SessionSource::Routine] {
        let opened = AgentSessionLifecycleEvent::Opened(SessionOpenedMetadata {
            identity: SessionIdentity {
                session_id: AgentSessionId::TEST_A,
                session_name: "Nightly triage".to_owned(),
                bot_id: BotId::TEST_A,
                bot_name: "Macro Coder".to_owned(),
                owner_id: owner.clone(),
                visibility: messages::domain::models::MessageVisibility::Public,
                origin: None,
                audience: vec![owner.clone()],
                source,
            },
            model: "claude".to_owned(),
            harness: "claude_code".to_owned(),
        });

        assert_eq!(opened.ingest(Uuid::now_v7()), Ingest::Ignore);
    }
}

#[test]
fn prompts_leave_own_work_alone_and_deleting_a_session_purges_it() {
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com")
        .expect("valid user id")
        .into_owned();
    let identity = SessionIdentity {
        session_id: AgentSessionId::TEST_A,
        session_name: "Fix the flaky test".to_owned(),
        bot_id: BotId::TEST_A,
        bot_name: "Macro Coder".to_owned(),
        owner_id: owner.clone(),
        visibility: messages::domain::models::MessageVisibility::Public,
        origin: None,
        audience: vec![owner.clone()],
        source: SessionSource::User,
    };

    let started = AgentSessionLifecycleEvent::TurnStarted(TurnStartedMetadata {
        identity: identity.clone(),
        turn: TurnId(0),
        action_id: agent_runtime_protocol::domain::action::AgentActionId::mint(),
        actor: Some(owner),
        announcement_message_id: None,
    });
    assert_eq!(started.ingest(Uuid::now_v7()), Ingest::Ignore);

    let deleted = AgentSessionLifecycleEvent::Deleted(SessionDeletedMetadata { identity });
    let Ingest::Purge(purged) = deleted.ingest(Uuid::now_v7()) else {
        panic!("deleting a session purges its activity");
    };
    assert_eq!(
        purged,
        vec![(EntityType::AgentSession, AgentSessionId::TEST_A.to_string())]
    );
}
