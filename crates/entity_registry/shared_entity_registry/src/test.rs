use model_entity::EntityType;
use model_owner::OwnerType;
use uuid::Uuid;

use super::*;

#[test]
fn registered_kinds_round_trip_and_match_check_spellings() {
    let expected = [
        (RegisteredEntityType::Project, "project"),
        (RegisteredEntityType::Document, "document"),
        (RegisteredEntityType::Chat, "chat"),
        (RegisteredEntityType::AgentSession, "agent_session"),
        (RegisteredEntityType::ScheduledAction, "scheduled_action"),
    ];
    assert_eq!(
        RegisteredEntityType::ALL,
        [
            RegisteredEntityType::Project,
            RegisteredEntityType::Document,
            RegisteredEntityType::Chat,
            RegisteredEntityType::AgentSession,
            RegisteredEntityType::ScheduledAction,
        ]
    );
    for (kind, spelling) in expected {
        assert_eq!(kind.as_str(), spelling);
        assert_eq!(kind.to_string(), spelling);
        let wide = EntityType::from(kind);
        assert_eq!(wide.as_ref(), spelling);
        assert_eq!(RegisteredEntityType::try_from(wide), Ok(kind));
    }
}

#[test]
fn try_from_rejects_every_unregistered_entity_type() {
    let unregistered = [
        EntityType::User,
        EntityType::Channel,
        EntityType::ChannelMessage,
        EntityType::EmailThread,
        EntityType::CalendarEvent,
        EntityType::Team,
        EntityType::Call,
        EntityType::ForeignEntity,
        EntityType::StaticFile,
        EntityType::CrmCompany,
        EntityType::CrmContact,
        EntityType::Reminder,
        EntityType::Skill,
        EntityType::Initiative,
    ];
    for ty in unregistered {
        assert_eq!(
            RegisteredEntityType::try_from(ty),
            Err(UnregisteredEntityType(ty))
        );
    }
}

#[test]
fn try_new_accepts_chat_and_rejects_initiative() {
    let owner = Owner::parse(OwnerType::User, "macro|hutch@macro.com").unwrap();
    let id = Uuid::from_u128(1);

    let record = NewEntityRecord::try_new(id, EntityType::Chat, owner.clone()).unwrap();
    assert_eq!(record.id, id);
    assert_eq!(record.entity_type, RegisteredEntityType::Chat);
    assert_eq!(record.owner, owner);
    assert_eq!(record.created_at, None);
    assert_eq!(record.updated_at, None);

    assert_eq!(
        NewEntityRecord::try_new(id, EntityType::Initiative, owner),
        Err(UnregisteredEntityType(EntityType::Initiative))
    );
}
