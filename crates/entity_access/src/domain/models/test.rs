use super::*;

fn bot_id() -> BotId {
    BotId::new_from_uuid(uuid::uuid!("00000000-0000-0000-0000-000000000123"))
}

fn document() -> Entity {
    Entity {
        entity_id: "document-1".to_string(),
        entity_type: EntityType::Document,
    }
}

#[test]
fn bot_auth_serializes_as_canonical_storage_principal() {
    let serialized =
        serde_json::to_value(EntityAccessAuth::Bot(bot_id().into_storage_id())).unwrap();

    assert_eq!(
        serialized,
        serde_json::json!("bot|00000000-0000-0000-0000-000000000123")
    );
}

#[test]
fn try_new_bot_enforces_required_permission() {
    let result = EntityAccessReceipt::<EditAccessLevel>::try_new_bot(
        bot_id().into_storage_id(),
        document(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    );

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[test]
fn bot_receipt_returns_bot_and_rejects_authenticated_user() {
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::try_new_bot(
        bot_id().into_storage_id(),
        document(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap();

    assert_eq!(
        receipt.get_authenticated_bot().unwrap(),
        &bot_id().into_storage_id()
    );
    assert!(matches!(
        receipt.get_authenticated_user(),
        Err(AccessError::Unauthorized)
    ));
}

#[test]
fn dangerously_assert_bot_creates_owner_level_test_receipt() {
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_bot(
        bot_id().into_storage_id(),
        "document-1",
        EntityType::Document,
    );

    assert_eq!(
        receipt.get_authenticated_bot().unwrap(),
        &bot_id().into_storage_id()
    );
    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    ));
}

#[test]
fn channel_view_only_satisfies_only_view_only_requirement() {
    let permission = EntityPermission::ChannelViewOnly;

    assert!(permission.satisfies::<ViewOnly>());
    assert!(!permission.satisfies::<MemberParticipantRole>());
    assert!(!permission.satisfies::<AdminParticipantRole>());
    assert!(!permission.satisfies::<OwnerParticipantRole>());
    assert!(!permission.satisfies::<ViewAccessLevel>());
}

#[test]
fn all_channel_participant_roles_satisfy_view_only_requirement() {
    for role in [
        ParticipantRole::Member,
        ParticipantRole::Admin,
        ParticipantRole::Owner,
    ] {
        let permission = EntityPermission::ChannelRole { role };

        assert!(permission.satisfies::<ViewOnly>());
    }
}
