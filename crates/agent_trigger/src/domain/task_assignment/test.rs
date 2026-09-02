use bots::domain::models::{Agent, AgentChannelScope, Bot, BotKind, BotOwner};
use chrono::{DateTime, Utc};
use macro_event_broker::MacroEvent as _;
use macro_uuid::Uuid as PropertyUuid;
use models_properties::EntityReference;
use properties::domain::events::EntityPropertyUpdatedMetadata;

use super::*;
use crate::domain::broker_events::AgentTriggerTopicEvent;
use crate::domain::service::{MockAgentBotLookup, MockTeamMembershipLookup};

const TASK_ID: PropertyUuid = PropertyUuid::from_u128(7);

fn owner_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("valid user id")
}

fn other_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("other@example.com").expect("valid user id")
}

fn owned_bot(owner: Option<BotOwner>) -> Bot {
    Bot {
        id: BotId::TEST_A,
        kind: BotKind::Owned,
        owner,
        name: "Sweeper".to_owned(),
        handle: "sweeper".to_owned(),
        description: None,
        avatar_url: None,
        created_by: None,
        created_at: DateTime::UNIX_EPOCH,
        updated_at: DateTime::UNIX_EPOCH,
        deleted_at: None,
        has_agent: true,
    }
}

fn agent(owner: Option<BotOwner>) -> Agent {
    Agent {
        bot: owned_bot(owner),
        instructions: String::new(),
        harness: "opencode".to_owned(),
        harness_id: None,
        default_model: "claude".to_owned(),
        channel_scope: AgentChannelScope::All,
        channel_ids: Vec::new(),
    }
}

fn refs(ids: &[&str]) -> PropertyValue {
    PropertyValue::EntityRef(
        ids.iter()
            .map(|id| EntityReference::new(*id, EntityType::User))
            .collect(),
    )
}

fn assignees_update(
    actor: Option<MacroUserIdStr<'static>>,
    previous: Option<PropertyValue>,
    value: Option<PropertyValue>,
) -> PropertyTopicEvent {
    PropertyTopicEvent::EntityPropertyUpdated(EntityPropertyUpdatedMetadata {
        entity_property_id: PropertyUuid::from_u128(1),
        entity_id: TASK_ID.to_string(),
        entity_type: EntityType::Task,
        property_definition_id: SystemPropertyKey::ASSIGNEES_UUID,
        actor_user_id: actor,
        actor: None,
        on_behalf_of: None,
        value,
        previous_value: previous,
        updated_at: Utc::now(),
    })
}

fn bot_ref() -> String {
    BotId::TEST_A.into_storage_id().to_string()
}

fn service(
    bots: MockAgentBotLookup,
    teams: MockTeamMembershipLookup,
) -> TaskAssignmentTriggerService<MockAgentBotLookup, MockTeamMembershipLookup, MockTaskDirectory> {
    let mut tasks = MockTaskDirectory::new();
    tasks
        .expect_task_title()
        .returning(|_| Box::pin(async { Ok(Some("Fix the flaky test".to_owned())) }));
    TaskAssignmentTriggerService::new(bots, teams, tasks)
}

#[tokio::test]
async fn assigning_an_owned_agent_yields_a_new_session_event() {
    let mut bots = MockAgentBotLookup::new();
    let owner = owner_id();
    bots.expect_get_agent().returning(move |_| {
        let owner = owner.clone();
        Box::pin(async move {
            Ok(Some(agent(Some(BotOwner::User {
                user_id: owner.to_string(),
            }))))
        })
    });
    let trigger = service(bots, MockTeamMembershipLookup::new());

    let events = trigger
        .evaluate(&assignees_update(
            Some(owner_id()),
            Some(refs(&["macro|owner@example.com"])),
            Some(refs(&["macro|owner@example.com", &bot_ref()])),
        ))
        .await
        .expect("evaluation succeeds");

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].key(), BotId::TEST_A.to_string());
    let AgentTriggerTopicEvent::New(NewAgentSessionEvent::TaskAssigned(assigned)) =
        &events[0].event().event
    else {
        panic!("expected a task-assigned event");
    };
    assert_eq!(assigned.bot_id, BotId::TEST_A);
    assert_eq!(assigned.task_id, TASK_ID);
    assert_eq!(assigned.assigned_by, owner_id());
    assert_eq!(assigned.task_title.as_deref(), Some("Fix the flaky test"));
}

#[tokio::test]
async fn an_agent_already_assigned_yields_nothing() {
    let trigger = service(MockAgentBotLookup::new(), MockTeamMembershipLookup::new());

    let events = trigger
        .evaluate(&assignees_update(
            Some(owner_id()),
            Some(refs(&[&bot_ref()])),
            Some(refs(&[&bot_ref(), "macro|owner@example.com"])),
        ))
        .await
        .expect("evaluation succeeds");

    assert!(events.is_empty());
}

#[tokio::test]
async fn a_machine_write_yields_nothing() {
    let trigger = service(MockAgentBotLookup::new(), MockTeamMembershipLookup::new());

    let events = trigger
        .evaluate(&assignees_update(None, None, Some(refs(&[&bot_ref()]))))
        .await
        .expect("evaluation succeeds");

    assert!(events.is_empty());
}

#[tokio::test]
async fn user_only_assignees_yield_nothing() {
    let trigger = service(MockAgentBotLookup::new(), MockTeamMembershipLookup::new());

    let events = trigger
        .evaluate(&assignees_update(
            Some(owner_id()),
            None,
            Some(refs(&["macro|owner@example.com"])),
        ))
        .await
        .expect("evaluation succeeds");

    assert!(events.is_empty());
}

#[tokio::test]
async fn another_property_yields_nothing() {
    let trigger = service(MockAgentBotLookup::new(), MockTeamMembershipLookup::new());

    let PropertyTopicEvent::EntityPropertyUpdated(mut update) =
        assignees_update(Some(owner_id()), None, Some(refs(&[&bot_ref()])))
    else {
        unreachable!("assignees_update builds an entity-property update");
    };
    update.property_definition_id = PropertyUuid::from_u128(99);

    let events = trigger
        .evaluate(&PropertyTopicEvent::EntityPropertyUpdated(update))
        .await
        .expect("evaluation succeeds");

    assert!(events.is_empty());
}

#[tokio::test]
async fn an_agent_owned_by_someone_else_is_skipped() {
    let mut bots = MockAgentBotLookup::new();
    let other = other_id();
    bots.expect_get_agent().returning(move |_| {
        let other = other.clone();
        Box::pin(async move {
            Ok(Some(agent(Some(BotOwner::User {
                user_id: other.to_string(),
            }))))
        })
    });
    let trigger = service(bots, MockTeamMembershipLookup::new());

    let events = trigger
        .evaluate(&assignees_update(
            Some(owner_id()),
            None,
            Some(refs(&[&bot_ref()])),
        ))
        .await
        .expect("evaluation succeeds");

    assert!(events.is_empty());
}

#[tokio::test]
async fn a_team_agent_is_assignable_by_a_team_member() {
    let team_id = macro_uuid::Uuid::from_u128(21);
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent().returning(move |_| {
        Box::pin(async move { Ok(Some(agent(Some(BotOwner::Team { team_id })))) })
    });
    let mut teams = MockTeamMembershipLookup::new();
    teams
        .expect_user_has_team()
        .withf(move |caller, team| *team == team_id && caller == &owner_id())
        .returning(|_, _| Box::pin(async { Ok(true) }));
    let trigger = service(bots, teams);

    let events = trigger
        .evaluate(&assignees_update(
            Some(owner_id()),
            None,
            Some(refs(&[&bot_ref()])),
        ))
        .await
        .expect("evaluation succeeds");

    assert_eq!(events.len(), 1);
}

#[tokio::test]
async fn a_system_agent_is_assignable_by_anyone() {
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .returning(|_| Box::pin(async { Ok(None) }));
    bots.expect_get_bot().returning(|_| {
        Box::pin(async {
            Ok(Some(Bot {
                kind: BotKind::System,
                owner: None,
                ..owned_bot(None)
            }))
        })
    });
    let trigger = service(bots, MockTeamMembershipLookup::new());

    let events = trigger
        .evaluate(&assignees_update(
            Some(owner_id()),
            None,
            Some(refs(&[&bot_ref()])),
        ))
        .await
        .expect("evaluation succeeds");

    assert_eq!(events.len(), 1);
}
