use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::StatusCode;

use super::*;

fn record(owner: Owner) -> EntityRecord {
    EntityRecord {
        id: Uuid::from_u128(0xc4a7),
        entity_type: RegisteredEntityType::Chat,
        owner,
        created_at: DateTime::<Utc>::UNIX_EPOCH,
        updated_at: DateTime::<Utc>::UNIX_EPOCH,
        deleted_at: Some(DateTime::<Utc>::UNIX_EPOCH),
    }
}

#[test]
fn only_no_content_counts_as_purged() {
    assert_eq!(route_purge_outcome(StatusCode::NO_CONTENT), Ok(()));
    assert_eq!(
        route_purge_outcome(StatusCode::CONFLICT),
        Err(RoutePurgeError::OwnedElsewhere)
    );
    assert_eq!(
        route_purge_outcome(StatusCode::NOT_FOUND),
        Err(RoutePurgeError::UnexpectedResponse { status: 404 })
    );
    assert_eq!(
        route_purge_outcome(StatusCode::OK),
        Err(RoutePurgeError::UnexpectedResponse { status: 200 })
    );
    assert_eq!(
        route_purge_outcome(StatusCode::INTERNAL_SERVER_ERROR),
        Err(RoutePurgeError::UnexpectedResponse { status: 500 })
    );
}

#[test]
fn registry_rows_of_teams_and_bots_become_purgeable_and_a_users_row_is_refused() {
    let bot = BotId::new_from_uuid(Uuid::from_u128(0xb07));
    let team = Uuid::from_u128(0x7ea);

    assert_eq!(
        owned_entity_ref(record(Owner::Bot(bot))).unwrap(),
        OwnedEntityRef {
            id: Uuid::from_u128(0xc4a7),
            entity_type: RegisteredEntityType::Chat,
            owner: TeamDeletionOwner::Bot(bot),
        }
    );
    assert_eq!(
        owned_entity_ref(record(Owner::Team(team))).unwrap(),
        OwnedEntityRef {
            id: Uuid::from_u128(0xc4a7),
            entity_type: RegisteredEntityType::Chat,
            owner: TeamDeletionOwner::Team(team),
        }
    );
    let user = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    assert!(owned_entity_ref(record(Owner::User(user))).is_err());
}
