use super::*;

fn bot_id() -> BotId {
    BotId::new_from_uuid(uuid::uuid!("00000000-0000-0000-0000-000000000123"))
}

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("bot-user@example.com").unwrap()
}

fn document() -> Entity {
    Entity {
        entity_id: "document-1".to_string(),
        entity_type: EntityType::Document,
    }
}

fn user_receipt_scope() -> BotReceiptScope {
    BotReceiptScope::User {
        acting_user: user_id(),
    }
}

fn team_receipt_scope() -> BotReceiptScope {
    BotReceiptScope::Team {
        team_id: uuid::uuid!("00000000-0000-0000-0000-000000000456"),
    }
}

#[test]
fn user_access_scope_preserves_organization_and_converts_to_receipt_scope() {
    let user_id = user_id();
    let access_scope = BotAccessScope::User {
        user_id: user_id.clone(),
        user_org_id: Some(42),
    };

    assert_eq!(access_scope.user_id(), Some(&user_id));
    assert_eq!(access_scope.user_org_id(), Some(42));
    assert_eq!(access_scope.team_id(), None);

    let receipt_scope = BotReceiptScope::from(&access_scope);

    assert_eq!(receipt_scope.acting_user_id(), Some(&user_id));
    assert_eq!(receipt_scope.team_id(), None);
    assert_eq!(
        serde_json::to_value(receipt_scope).unwrap(),
        serde_json::json!({
            "scope": "user",
            "acting_user": "macro|bot-user@example.com"
        })
    );
}

#[test]
fn team_access_scope_converts_to_serializable_receipt_scope() {
    let team_id = uuid::uuid!("00000000-0000-0000-0000-000000000456");
    let access_scope = BotAccessScope::Team { team_id };

    assert_eq!(access_scope.user_id(), None);
    assert_eq!(access_scope.user_org_id(), None);
    assert_eq!(access_scope.team_id(), Some(team_id));

    let receipt_scope = BotReceiptScope::from(&access_scope);

    assert_eq!(receipt_scope.acting_user_id(), None);
    assert_eq!(receipt_scope.team_id(), Some(team_id));
    assert_eq!(
        serde_json::to_value(receipt_scope).unwrap(),
        serde_json::json!({
            "scope": "team",
            "team_id": "00000000-0000-0000-0000-000000000456"
        })
    );
}

#[test]
fn any_entity_permission_accepts_every_permission() {
    let permissions = [
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Comment,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
        EntityPermission::ChannelViewOnly,
        EntityPermission::ChannelRole {
            role: ParticipantRole::Member,
        },
        EntityPermission::ChannelRole {
            role: ParticipantRole::Admin,
        },
        EntityPermission::ChannelRole {
            role: ParticipantRole::Owner,
        },
        EntityPermission::TeamRole {
            role: TeamRole::Member,
        },
        EntityPermission::TeamRole {
            role: TeamRole::Admin,
        },
        EntityPermission::TeamRole {
            role: TeamRole::Owner,
        },
    ];

    for permission in permissions {
        assert!(permission.satisfies::<AnyEntityPermission>());
    }
}

#[test]
fn user_scoped_bot_auth_serializes_bot_scope_and_acting_user() {
    let bot_auth = BotReceiptAuth::new(bot_id().into_storage_id(), user_receipt_scope());
    let serialized = serde_json::to_value(EntityAccessAuth::Bot(bot_auth)).unwrap();

    assert_eq!(
        serialized,
        serde_json::json!({
            "bot_id": "bot|00000000-0000-0000-0000-000000000123",
            "scope": "user",
            "acting_user": "macro|bot-user@example.com"
        })
    );
}

#[test]
fn team_scoped_bot_auth_serializes_bot_scope_and_team() {
    let bot_auth = BotReceiptAuth::new(bot_id().into_storage_id(), team_receipt_scope());
    let serialized = serde_json::to_value(EntityAccessAuth::Bot(bot_auth)).unwrap();

    assert_eq!(
        serialized,
        serde_json::json!({
            "bot_id": "bot|00000000-0000-0000-0000-000000000123",
            "scope": "team",
            "team_id": "00000000-0000-0000-0000-000000000456"
        })
    );
}

#[test]
fn try_new_bot_enforces_required_permission() {
    let result = EntityAccessReceipt::<EditAccessLevel>::try_new_bot(
        bot_id().into_storage_id(),
        user_receipt_scope(),
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
        user_receipt_scope(),
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
    let bot_auth = receipt.get_authenticated_bot_auth().unwrap();
    assert_eq!(bot_auth.bot_id(), bot_id());
    assert_eq!(bot_auth.to_string(), bot_id().into_storage_id().to_string());
    assert_eq!(bot_auth.scope(), &user_receipt_scope());
    assert_eq!(receipt.acting_user_id(), Some(&user_id()));
    assert!(matches!(
        receipt.get_authenticated_user(),
        Err(AccessError::Unauthorized)
    ));
}

#[test]
fn acting_user_id_returns_direct_authenticated_user() {
    let user_id = user_id();
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::try_new_authenticated_user(
        user_id.clone(),
        document(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap();

    assert_eq!(receipt.acting_user_id(), Some(&user_id));
    assert!(matches!(
        receipt.get_authenticated_bot_auth(),
        Err(AccessError::Unauthorized)
    ));
}

#[test]
fn dangerously_assert_bot_creates_owner_level_test_receipt() {
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_bot(
        bot_id().into_storage_id(),
        team_receipt_scope(),
        "document-1",
        EntityType::Document,
    );

    assert_eq!(
        receipt.get_authenticated_bot().unwrap(),
        &bot_id().into_storage_id()
    );
    assert_eq!(receipt.acting_user_id(), None);
    assert_eq!(
        receipt.get_authenticated_bot_auth().unwrap().scope(),
        &team_receipt_scope()
    );
    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    ));
}

#[test]
fn an_anonymous_caller_with_a_public_grant_above_view_holds_view() {
    for grant in [
        AccessLevel::View,
        AccessLevel::Comment,
        AccessLevel::Edit,
        AccessLevel::Owner,
    ] {
        let receipt = EntityAccessReceipt::<ViewAccessLevel>::try_new(
            EntityAccessAuth::Unauthenticated,
            document(),
            EntityPermission::AccessLevel {
                access_level: grant,
            },
        )
        .unwrap();

        assert_eq!(
            receipt.entity_permission(),
            &EntityPermission::AccessLevel {
                access_level: AccessLevel::View
            },
            "grant: {grant:?}"
        );
    }
}

#[test]
fn an_anonymous_receipt_with_no_requirement_holds_view() {
    let receipt = EntityAccessReceipt::<AnyEntityPermission>::try_new(
        EntityAccessAuth::Unauthenticated,
        document(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap();

    assert_eq!(
        receipt.entity_permission(),
        &EntityPermission::AccessLevel {
            access_level: AccessLevel::View
        }
    );
}

#[test]
fn an_anonymous_caller_never_meets_comment_edit_or_owner() {
    let owner = EntityPermission::AccessLevel {
        access_level: AccessLevel::Owner,
    };

    assert!(matches!(
        EntityAccessReceipt::<CommentAccessLevel>::try_new(
            EntityAccessAuth::Unauthenticated,
            document(),
            owner,
        ),
        Err(AccessError::Unauthorized)
    ));
    assert!(matches!(
        EntityAccessReceipt::<EditAccessLevel>::try_new(
            EntityAccessAuth::Unauthenticated,
            document(),
            owner,
        ),
        Err(AccessError::Unauthorized)
    ));
    assert!(matches!(
        EntityAccessReceipt::<OwnerAccessLevel>::try_new(
            EntityAccessAuth::Unauthenticated,
            document(),
            owner,
        ),
        Err(AccessError::Unauthorized)
    ));
}

#[test]
fn re_tagging_an_anonymous_receipt_cannot_regain_its_grant() {
    let view = EntityAccessReceipt::<ViewAccessLevel>::try_new(
        EntityAccessAuth::Unauthenticated,
        document(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap();

    assert!(matches!(
        view.try_into_requirement::<EditAccessLevel>(),
        Err(AccessError::Unauthorized)
    ));
}

#[test]
fn an_anonymous_channel_role_becomes_view_only() {
    let owner = EntityPermission::ChannelRole {
        role: ParticipantRole::Owner,
    };

    let receipt = EntityAccessReceipt::<ViewOnly>::try_new(
        EntityAccessAuth::Unauthenticated,
        document(),
        owner,
    )
    .unwrap();

    assert_eq!(
        receipt.entity_permission(),
        &EntityPermission::ChannelViewOnly
    );
    assert!(matches!(
        EntityAccessReceipt::<MemberParticipantRole>::try_new(
            EntityAccessAuth::Unauthenticated,
            document(),
            owner,
        ),
        Err(AccessError::Unauthorized)
    ));
}

#[test]
fn an_anonymous_caller_holds_no_team_role() {
    assert!(matches!(
        EntityAccessReceipt::<AnyEntityPermission>::try_new(
            EntityAccessAuth::Unauthenticated,
            document(),
            EntityPermission::TeamRole {
                role: TeamRole::Member,
            },
        ),
        Err(AccessError::Unauthorized)
    ));
}

#[test]
fn signed_in_and_internal_callers_keep_their_grant() {
    let edit = EntityAccessReceipt::<EditAccessLevel>::try_new_authenticated_user(
        user_id(),
        document(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap();
    assert_eq!(
        edit.entity_permission(),
        &EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit
        }
    );

    let internal = EntityAccessReceipt::<OwnerAccessLevel>::try_new(
        EntityAccessAuth::Internal,
        document(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap();
    assert_eq!(
        internal.entity_permission(),
        &EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    );
}

#[test]
fn try_new_for_user_caps_only_the_caller_with_no_account() {
    let edit_grant = EntityPermission::AccessLevel {
        access_level: AccessLevel::Edit,
    };

    let signed_in = EntityAccessReceipt::<EditAccessLevel>::try_new_for_user(
        Some(user_id()),
        document(),
        edit_grant,
    )
    .unwrap();
    assert!(matches!(
        signed_in.auth(),
        EntityAccessAuth::Authenticated(user) if user == &user_id()
    ));
    assert_eq!(signed_in.entity_permission(), &edit_grant);

    let signed_out =
        EntityAccessReceipt::<ViewAccessLevel>::try_new_for_user(None, document(), edit_grant)
            .unwrap();
    assert!(matches!(
        signed_out.auth(),
        EntityAccessAuth::Unauthenticated
    ));
    assert_eq!(
        signed_out.entity_permission(),
        &EntityPermission::AccessLevel {
            access_level: AccessLevel::View
        }
    );
    assert!(matches!(
        EntityAccessReceipt::<EditAccessLevel>::try_new_for_user(None, document(), edit_grant),
        Err(AccessError::Unauthorized)
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
