use super::*;
use crate::domain::sources::{ChannelTriggerEvents, MessageTriggerEvents, TriggerEvents};
use chrono::Utc;
use macro_event_broker::{Event, MacroEvent, MacroEventCollection};
use messages::domain::ports::MessageError;
use models_properties::EntityReference;
use properties::domain::events::{PropertyMacroEvent, PropertyTopicEvent};

fn brief() -> TaskBrief {
    TaskBrief {
        title: "Fix export".to_owned(),
        markdown: "Include archived rows in CSV exports.".to_owned(),
    }
}

fn value(ids: &[&str]) -> Option<PropertyValue> {
    Some(PropertyValue::EntityRef(
        ids.iter()
            .map(|id| EntityReference::new(*id, EntityType::User))
            .collect(),
    ))
}

fn update() -> EntityPropertyUpdatedMetadata {
    EntityPropertyUpdatedMetadata {
        entity_property_id: Uuid::now_v7(),
        entity_id: "task-1".to_owned(),
        entity_type: EntityType::Task,
        property_definition_id: SystemPropertyKey::Assignees.uuid(),
        actor_user_id: Some(MacroUserIdStr::try_from_email("assigner@example.com").unwrap()),
        actor: None,
        on_behalf_of: None,
        value: value(&["bot|00000000-0000-0000-0000-00000000b07a"]),
        previous_value: None,
        updated_at: Utc::now(),
    }
}

#[test]
fn creation_and_new_assignments_include_only_added_agents() {
    let mut updated = update();
    let event_id = Uuid::now_v7();
    let assignment = TaskAssignment::from_update(event_id, &updated).unwrap();
    assert_eq!(assignment.event_id, event_id);
    assert_eq!(
        assignment.parent,
        MessageParent::parse("document", "task-1").unwrap()
    );
    assert_eq!(assignment.bots, vec![BotId::TEST_A]);

    updated.previous_value = updated.value.clone();
    updated.value = value(&[
        "macro|human@example.com",
        "bot|00000000-0000-0000-0000-00000000b07a",
        "bot|00000000-0000-0000-0000-00000000b07b",
        "bot|00000000-0000-0000-0000-00000000b07b",
    ]);
    assert_eq!(
        TaskAssignment::from_update(event_id, &updated)
            .unwrap()
            .bots,
        vec![BotId::TEST_B]
    );
}

#[test]
fn unchanged_saves_removals_and_human_only_assignments_do_not_start_work() {
    let mut updated = update();
    updated.previous_value = updated.value.clone();
    assert!(TaskAssignment::from_update(Uuid::now_v7(), &updated).is_none());
    updated.value = None;
    assert!(TaskAssignment::from_update(Uuid::now_v7(), &updated).is_none());
    updated.value = value(&["macro|human@example.com", "bot|invalid"]);
    assert!(TaskAssignment::from_update(Uuid::now_v7(), &updated).is_none());
    updated.previous_value = None;
    assert!(TaskAssignment::from_update(Uuid::now_v7(), &updated).is_none());
}

#[test]
fn only_task_assignees_with_an_invoking_user_trigger() {
    let mut updated = update();
    updated.entity_type = EntityType::Document;
    assert!(TaskAssignment::from_update(Uuid::now_v7(), &updated).is_none());
    updated = update();
    updated.property_definition_id = SystemPropertyKey::Status.uuid();
    assert!(TaskAssignment::from_update(Uuid::now_v7(), &updated).is_none());
    updated = update();
    updated.actor_user_id = None;
    assert!(TaskAssignment::from_update(Uuid::now_v7(), &updated).is_none());
    updated.on_behalf_of = Some(MacroUserIdStr::try_from_email("delegator@example.com").unwrap());
    assert_eq!(
        TaskAssignment::from_update(Uuid::now_v7(), &updated)
            .unwrap()
            .actor,
        updated.on_behalf_of.unwrap()
    );
}

fn access(
    assignment: &TaskAssignment,
) -> entity_access::domain::models::EntityAccessReceipt<MessageWrite> {
    use entity_access::domain::models::{
        AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType,
    };
    EntityAccessReceipt::try_new_authenticated_user(
        assignment.actor.clone(),
        Entity {
            entity_type: EntityType::Document,
            entity_id: assignment.parent.entity_id(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn discussion(assignment: &TaskAssignment) -> messages::domain::models::Message {
    messages::domain::models::Message {
        id: assignment.event_id,
        parent: assignment.parent.clone(),
        thread_id: None,
        sender_id: channel_sender::ChannelSender::new_from_user(assignment.actor.clone()),
        triggered_by: None,
        bot_profile: None,
        imported_author: None,
        content: "Work on this task".to_owned(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments: Vec::new(),
        reactions: Vec::new(),
        mentions: Vec::new(),
    }
}

#[tokio::test]
async fn opens_a_task_discussion_with_a_stable_id_and_no_mention_trigger() {
    use messages::domain::api::MockMessageCommands;
    let assignment = TaskAssignment::from_update(Uuid::now_v7(), &update()).unwrap();
    let event_id = assignment.event_id;
    let mut commands = MockMessageCommands::new();
    let message = discussion(&assignment);
    let expected = message.clone();
    commands
        .expect_post_from_event()
        .once()
        .withf(move |access, id, input| {
            access.entity().entity_id == "task-1"
                && *id == event_id
                && input.id.is_none()
                && input.thread_id.is_none()
                && input.mentions.is_empty()
                && input.content.contains("Fix export")
                && input
                    .content
                    .contains("Include archived rows in CSV exports.")
                && input.content.contains("task-1")
                && input.notification_policy == PostMessageNotificationPolicy::Silent
        })
        .return_once(|_, _, _| Ok(message));
    let posted = assignment_discussion(&assignment, &brief(), access(&assignment), &commands)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(posted.message_id, expected.id);
    assert_eq!(posted.parent, expected.parent);
    assert_eq!(posted.sender, expected.sender_id);
}

#[tokio::test]
async fn a_replayed_assignment_reuses_its_persisted_discussion() {
    use messages::domain::api::MockMessageCommands;
    let assignment = TaskAssignment::from_update(Uuid::now_v7(), &update()).unwrap();
    let message = discussion(&assignment);
    let mut commands = MockMessageCommands::new();
    commands
        .expect_post_from_event()
        .once()
        .return_once(|_, _, _| Ok(message));
    let posted = assignment_discussion(&assignment, &brief(), access(&assignment), &commands)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(posted.message_id, assignment.event_id);
}

#[tokio::test]
async fn deleted_or_unrelated_discussions_cannot_start_a_session() {
    use messages::domain::api::MockMessageCommands;
    let assignment = TaskAssignment::from_update(Uuid::now_v7(), &update()).unwrap();
    for variant in 0..4 {
        let mut message = discussion(&assignment);
        match variant {
            0 => message.deleted_at = Some(Utc::now()),
            1 => message.parent = MessageParent::parse("document", "other-task").unwrap(),
            2 => message.thread_id = Some(Uuid::now_v7()),
            _ => {
                message.sender_id = channel_sender::ChannelSender::new_from_user(
                    MacroUserIdStr::try_from_email("other@example.com").unwrap(),
                )
            }
        }
        let mut commands = MockMessageCommands::new();
        commands
            .expect_post_from_event()
            .once()
            .return_once(|_, _, _| Ok(message));
        assert!(
            assignment_discussion(&assignment, &brief(), access(&assignment), &commands)
                .await
                .unwrap()
                .is_none()
        );
    }
}

#[tokio::test]
async fn a_discussion_failure_does_not_yield_an_opening_message() {
    use messages::domain::api::MockMessageCommands;
    let assignment = TaskAssignment::from_update(Uuid::now_v7(), &update()).unwrap();
    let mut commands = MockMessageCommands::new();
    commands
        .expect_post_from_event()
        .once()
        .returning(|_, _, _| Err(MessageError::Forbidden));
    assert!(matches!(
        assignment_discussion(&assignment, &brief(), access(&assignment), &commands).await,
        Err(ProcessMessageEventError::Discussion(
            MessageError::Forbidden
        ))
    ));
}

#[test]
fn removing_then_reassigning_starts_a_new_assignment() {
    let first = TaskAssignment::from_update(Uuid::now_v7(), &update()).unwrap();
    let second = TaskAssignment::from_update(Uuid::now_v7(), &update()).unwrap();
    assert_ne!(first.event_id, second.event_id);
    assert_eq!(first.bots, second.bots);
}

#[test]
fn both_message_sources_also_decode_task_assignments() {
    let event_id = Uuid::now_v7();
    let event = || {
        PropertyMacroEvent::from_event(
            "task-1".to_owned(),
            Event::with_event_id(
                event_id,
                PropertyTopicEvent::EntityPropertyUpdated(update()),
            ),
        )
    };
    let message = MessageTriggerEvents::PropertyMacroEvent(event()).into_trigger();
    let channel = ChannelTriggerEvents::PropertyMacroEvent(event()).into_trigger();
    assert!(MessageTriggerEvents::topics().contains(&"macro.properties"));
    assert!(ChannelTriggerEvents::topics().contains(&"macro.properties"));
    assert_eq!(message, channel);
    assert!(message.posted.is_none());
    assert_eq!(message.assignment.unwrap().event_id, event_id);
}

#[derive(Default)]
struct RecordedEvents(std::sync::Mutex<Vec<serde_json::Value>>);

impl MacroEventBroker for RecordedEvents {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<
        tokio::task::JoinHandle<Result<(), macro_event_broker::EventBrokerError>>,
        macro_event_broker::EventBrokerError,
    > {
        self.0
            .lock()
            .unwrap()
            .push(serde_json::to_value(event.event())?);
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

#[tokio::test]
async fn authorized_assignment_publishes_the_task_brief_for_toolless_runtimes() {
    use crate::domain::service::*;
    use agent_session::domain::{model::ThreadSession, ports::MockAgentSessionRepo};
    use messages::domain::api::MockMessageCommands;

    let mut assignment = TaskAssignment::from_update(Uuid::now_v7(), &update()).unwrap();
    assignment.bots = vec![bot_id::CODEX_BOT_ID];
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .once()
        .returning(|_| Box::pin(async { Ok(None) }));
    bots.expect_get_bot().once().returning(|id| {
        Box::pin(async move {
            Ok(Some(bots::domain::models::Bot::system(
                bot_id::system_bot(id).unwrap(),
            )))
        })
    });
    let mut history = MockThreadHistory::new();
    let receipt = access(&assignment);
    history
        .expect_authorize_invocation()
        .once()
        .returning(move |_, _, root| {
            let invocation = AuthorizedInvocation::new(receipt.clone(), root);
            Box::pin(async { Ok(Some(invocation)) })
        });
    let mut sessions = MockAgentSessionRepo::new();
    let event_id = assignment.event_id;
    sessions
        .expect_find_for_thread()
        .once()
        .withf(move |root, bot| *root == Some(event_id) && *bot == Some(bot_id::CODEX_BOT_ID))
        .returning(|_, _| Box::pin(async { Ok(ThreadSession::None) }));
    let trigger = AgentTriggerService::new(
        sessions,
        bots,
        MockTeamMembershipLookup::new(),
        MockChannelParticipationLookup::new(),
        MockExplicitReplyExtractor::new(),
        MockImplicitTriggerJudge::new(),
        history,
    );
    let mut context = MockTaskAssignmentContext::new();
    context
        .expect_task_brief()
        .once()
        .withf(|access| access.entity().entity_id == "task-1")
        .returning(|_| Box::pin(async { Ok(Some(brief())) }));
    let mut commands = MockMessageCommands::new();
    let mut message = discussion(&assignment);
    commands
        .expect_post_from_event()
        .once()
        .return_once(move |_, _, input| {
            message.content = input.content;
            Ok(message)
        });
    let broker = RecordedEvents::default();
    process_task_assignment(&trigger, &broker, &commands, &context, &assignment)
        .await
        .unwrap();
    let events = broker.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    let metadata = &events[0]["metadata"];
    assert_eq!(metadata["source"], "assigned_to_task");
    assert_eq!(metadata["bot_id"], bot_id::CODEX_BOT_ID.to_string());
    let prompt = metadata["message"]["content"].as_str().unwrap();
    assert!(prompt.contains("Fix export"));
    assert!(prompt.contains("Include archived rows in CSV exports."));
    assert!(prompt.contains(r#""documentId":"task-1""#));
    assert_eq!(metadata["message"]["parent"]["type"], "document");
}
