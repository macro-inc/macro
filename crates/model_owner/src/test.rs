use super::*;

#[test]
fn user_round_trip() {
    let owner = Owner::parse(OwnerType::User, "macro|hutch@macro.com").unwrap();

    assert_eq!(owner.owner_type(), OwnerType::User);
    assert_eq!(owner.principal_id(), "macro|hutch@macro.com");
    assert_eq!(
        Owner::from_principal_str("macro|hutch@macro.com").unwrap(),
        owner
    );
    assert_eq!(
        serde_json::to_value(&owner).unwrap(),
        serde_json::Value::String("macro|hutch@macro.com".to_string())
    );
}

#[test]
fn bot_round_trip() {
    let owner = Owner::parse(OwnerType::Bot, "bot|00000000-0000-0000-0000-00000000a1a1").unwrap();

    assert_eq!(owner.owner_type(), OwnerType::Bot);
    assert_eq!(
        owner.principal_id(),
        "bot|00000000-0000-0000-0000-00000000a1a1"
    );
    assert_eq!(
        owner,
        Owner::Bot(BotId::new_from_uuid(
            Uuid::parse_str("00000000-0000-0000-0000-00000000a1a1").unwrap()
        ))
    );
    assert_eq!(
        serde_json::to_value(&owner).unwrap(),
        serde_json::Value::String("bot|00000000-0000-0000-0000-00000000a1a1".to_string())
    );
}

#[test]
fn team_round_trip() {
    let owner = Owner::parse(OwnerType::Team, "01234567-89ab-cdef-0123-456789abcdef").unwrap();

    assert_eq!(owner.owner_type(), OwnerType::Team);
    assert_eq!(owner.principal_id(), "01234567-89ab-cdef-0123-456789abcdef");
    assert_eq!(
        serde_json::to_value(&owner).unwrap(),
        serde_json::Value::String("01234567-89ab-cdef-0123-456789abcdef".to_string())
    );
}

#[test]
fn parse_rejects_bot_principal_as_user() {
    assert!(Owner::parse(OwnerType::User, "bot|00000000-0000-0000-0000-00000000a1a1").is_err());
}

#[test]
fn parse_rejects_user_principal_as_bot() {
    assert!(Owner::parse(OwnerType::Bot, "macro|hutch@macro.com").is_err());
}

#[test]
fn parse_rejects_bare_uuid_as_bot() {
    assert!(Owner::parse(OwnerType::Bot, "00000000-0000-0000-0000-00000000a1a1").is_err());
}

#[test]
fn parse_rejects_bot_principal_as_team() {
    assert!(Owner::parse(OwnerType::Team, "bot|00000000-0000-0000-0000-00000000a1a1").is_err());
}

#[test]
fn parse_rejects_malformed_uuids() {
    assert!(Owner::parse(OwnerType::Bot, "bot|not-a-uuid").is_err());
    assert!(Owner::parse(OwnerType::Team, "not-a-uuid").is_err());
}

#[test]
fn parse_rejects_non_canonical_uuids() {
    assert!(Owner::parse(OwnerType::Team, "0123456789abcdef0123456789abcdef").is_err());
    assert!(Owner::parse(OwnerType::Bot, "bot|0123456789abcdef0123456789abcdef").is_err());
}

#[test]
fn owner_type_lowercase_round_trips() {
    for (owner_type, expected) in [
        (OwnerType::User, "user"),
        (OwnerType::Bot, "bot"),
        (OwnerType::Team, "team"),
    ] {
        assert_eq!(owner_type.to_string(), expected);
        assert_eq!(expected.parse::<OwnerType>().unwrap(), owner_type);
        assert_eq!(
            serde_json::to_value(owner_type).unwrap(),
            serde_json::Value::String(expected.to_string())
        );
        assert_eq!(
            serde_json::from_value::<OwnerType>(serde_json::Value::String(expected.to_string()))
                .unwrap(),
            owner_type
        );
    }

    assert!("unknown".parse::<OwnerType>().is_err());
}

#[test]
fn from_principal_str_classifies_by_prefix() {
    assert_eq!(
        Owner::from_principal_str("macro|hutch@macro.com")
            .unwrap()
            .owner_type(),
        OwnerType::User
    );
    assert_eq!(
        Owner::from_principal_str("bot|00000000-0000-0000-0000-00000000a1a1")
            .unwrap()
            .owner_type(),
        OwnerType::Bot
    );
    assert_eq!(
        Owner::from_principal_str("01234567-89ab-cdef-0123-456789abcdef")
            .unwrap()
            .owner_type(),
        OwnerType::Team
    );
}
