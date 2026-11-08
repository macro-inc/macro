use super::*;
use entity_access::domain::models::{EntityAccessReceipt, EntityType, TeamRole, ViewAccessLevel};

fn company_uuid() -> Uuid {
    Uuid::from_u128(0x1111_1111_1111_1111_1111_1111_1111_1111)
}

fn team_uuid() -> Uuid {
    Uuid::from_u128(0x2222_2222_2222_2222_2222_2222_2222_2222)
}

#[test]
fn company_receipt_exposes_company_id_and_team() {
    let company = company_uuid();
    let team = team_uuid();
    let access = CrmCompanyReceipt::<ViewAccessLevel>::new(
        EntityAccessReceipt::dangerously_assert_internal_user(
            &company.to_string(),
            EntityType::CrmCompany,
        ),
        team,
        TeamRole::Owner,
    );

    assert_eq!(access.company_id().unwrap(), company);
    assert_eq!(access.team_id(), team);
    // dangerously_assert_internal_user grants Owner, which is Edit+.
    assert!(access.include_hidden());
}

#[test]
fn company_receipt_rejects_wrong_entity_type() {
    let access = CrmCompanyReceipt::<ViewAccessLevel>::new(
        EntityAccessReceipt::dangerously_assert_internal_user(
            &company_uuid().to_string(),
            EntityType::Team,
        ),
        team_uuid(),
        TeamRole::Owner,
    );

    assert!(matches!(
        access.company_id(),
        Err(CrmError::InvalidRequest(_))
    ));
}

#[test]
fn contact_receipt_exposes_contact_id() {
    let contact = company_uuid();
    let access = CrmContactReceipt::<ViewAccessLevel>::new(
        EntityAccessReceipt::dangerously_assert_internal_user(
            &contact.to_string(),
            EntityType::CrmContact,
        ),
        team_uuid(),
        TeamRole::Owner,
    );

    assert_eq!(access.contact_id().unwrap(), contact);
}

#[test]
fn team_receipt_from_team_receipt_validates_type_and_id() {
    let team = team_uuid();
    let ok = CrmTeamReceipt::<ViewAccessLevel>::from_team_receipt(
        EntityAccessReceipt::dangerously_assert_internal_user(&team.to_string(), EntityType::Team),
    )
    .unwrap();
    assert_eq!(ok.team_id(), team);

    // Wrong entity type is rejected.
    assert!(
        CrmTeamReceipt::<ViewAccessLevel>::from_team_receipt(
            EntityAccessReceipt::dangerously_assert_internal_user(
                &team.to_string(),
                EntityType::CrmCompany,
            ),
        )
        .is_err()
    );

    // Malformed team id is rejected.
    assert!(matches!(
        CrmTeamReceipt::<ViewAccessLevel>::from_team_receipt(
            EntityAccessReceipt::dangerously_assert_internal_user("not-a-uuid", EntityType::Team),
        ),
        Err(CrmError::InvalidTeamId)
    ));
}

#[test]
fn team_receipt_hidden_gate_derives_from_team_role() {
    use entity_access::domain::models::{Entity, EntityPermission, MemberTeamRole, TeamRole};
    use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

    let team = team_uuid();
    let user = MacroUserIdStr::parse_from_str("macro|user@example.com")
        .unwrap()
        .into_owned();
    let receipt_with_role = |role: TeamRole| {
        CrmTeamReceipt::from_team_receipt(
            EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
                user.clone(),
                Entity {
                    entity_id: team.to_string(),
                    entity_type: EntityType::Team,
                },
                EntityPermission::TeamRole { role },
            )
            .unwrap(),
        )
        .unwrap()
    };

    assert!(!receipt_with_role(TeamRole::Member).include_hidden());
    assert!(receipt_with_role(TeamRole::Admin).include_hidden());
    assert!(receipt_with_role(TeamRole::Owner).include_hidden());
}

#[tokio::test]
async fn acting_user_bots_follow_current_member_access_without_changing_team_bot_scope() {
    use entity_access::domain::models::{
        BotId, BotReceiptScope, Entity, EntityPermission, MemberTeamRole,
    };
    use macro_user_id::user_id::MacroUserIdStr;
    use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};

    struct Membership {
        state: AtomicU8,
        reads: AtomicUsize,
    }
    impl CrmMemberAccess for Membership {
        async fn member_has_crm_access(&self, team: Uuid, user: &str) -> Result<bool, CrmError> {
            assert_eq!(team, team_uuid());
            assert_eq!(user, "macro|user@example.com");
            self.reads.fetch_add(1, Ordering::Relaxed);
            match self.state.load(Ordering::Relaxed) {
                0 => Ok(false),
                1 => Ok(true),
                _ => Err(CrmError::StorageLayerError(anyhow::anyhow!("unavailable"))),
            }
        }
    }
    let membership = Membership {
        state: AtomicU8::new(0),
        reads: AtomicUsize::new(0),
    };
    let receipt = |scope| {
        CrmTeamReceipt::<MemberTeamRole>::from_team_receipt(
            EntityAccessReceipt::try_new_bot(
                BotId::new_from_uuid(Uuid::from_u128(123)).into_storage_id(),
                scope,
                Entity {
                    entity_id: team_uuid().to_string(),
                    entity_type: EntityType::Team,
                },
                EntityPermission::TeamRole {
                    role: TeamRole::Member,
                },
            )
            .unwrap(),
        )
        .unwrap()
    };
    let actor = receipt(BotReceiptScope::User {
        acting_user: MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap(),
    });
    for state in [1, 0, 1] {
        membership.state.store(state, Ordering::Relaxed);
        assert_eq!(actor.check_access(&membership).await.is_ok(), state == 1);
    }
    membership.state.store(2, Ordering::Relaxed);
    assert!(matches!(
        actor.check_access(&membership).await,
        Err(CrmError::StorageLayerError(_))
    ));
    assert!(
        receipt(BotReceiptScope::Team {
            team_id: team_uuid()
        })
        .check_access(&membership)
        .await
        .is_ok()
    );
    for scope in [
        BotReceiptScope::Team {
            team_id: Uuid::from_u128(124),
        },
        BotReceiptScope::Channel {
            channel_id: Uuid::from_u128(125),
        },
    ] {
        assert!(matches!(
            receipt(scope).check_access(&membership).await,
            Err(CrmError::AccessDenied)
        ));
    }
    assert_eq!(membership.reads.load(Ordering::Relaxed), 4);
}
