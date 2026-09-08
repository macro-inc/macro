use super::*;
use entity_access::domain::models::{EntityAccessAuth, EntityPermission};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_permissions::share_permission::access_level::AccessLevel;
use std::sync::Mutex;

const THREAD: &str = "20000000-0000-0000-0000-000000000004";
const OWNER: &str = "macro|owner@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn receipt(auth: EntityAccessAuth) -> EntityAccessReceipt<OwnerAccessLevel> {
    EntityAccessReceipt::try_new(
        auth,
        entity_access::domain::models::Entity {
            entity_id: THREAD.to_owned(),
            entity_type: EntityType::EmailThread,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap()
}

fn policy(level: Option<Option<AccessLevel>>) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        team_share_access_level: level,
        link_share: None,
        link_share_access_level: None,
        channel_share_permissions: None,
    }
}

struct FakeRepository {
    facts: TeamShareFacts,
    writes: Mutex<Vec<Option<AuthorizedTeamShareCommand>>>,
}

impl ThreadShareRepository for FakeRepository {
    async fn owner_facts(&self, _: uuid::Uuid) -> Result<TeamShareFacts, ThreadShareError> {
        Ok(self.facts.clone())
    }

    async fn persist(
        &self,
        _: uuid::Uuid,
        _: UpdateSharePermissionRequestV2,
        command: Option<AuthorizedTeamShareCommand>,
    ) -> Result<(), ThreadShareError> {
        self.writes.lock().unwrap().push(command);
        Ok(())
    }
}

fn service(team: bool) -> ThreadSharePolicyService<FakeRepository> {
    ThreadSharePolicyService::new(FakeRepository {
        facts: TeamShareFacts {
            entity: EntityType::EmailThread.with_entity_string(THREAD.to_owned()),
            owner: user(OWNER),
            owner_team_id: team.then_some(uuid::Uuid::nil()),
            current: None,
            revision: 0,
        },
        writes: Mutex::new(Vec::new()),
    })
}

#[tokio::test]
async fn effective_owner_and_identityless_receipts_cannot_supply_team_updates() {
    for auth in [
        EntityAccessAuth::Authenticated(user("macro|other@example.com")),
        EntityAccessAuth::Internal,
    ] {
        for level in [Some(None), Some(Some(AccessLevel::View))] {
            let service = service(true);
            assert!(matches!(
                service
                    .update_share_policy(receipt(auth.clone()), policy(level))
                    .await,
                Err(ThreadShareError::Policy(
                    TeamSharePolicyError::NotOwner | TeamSharePolicyError::MissingActor
                ))
            ));
            assert!(service.repository.writes.lock().unwrap().is_empty());
        }
    }
}

#[tokio::test]
async fn omitted_field_preserves_legacy_owner_receipt_requirement_without_actual_owner_check() {
    let service = service(false);
    service
        .update_share_policy(
            receipt(EntityAccessAuth::Authenticated(user(
                "macro|other@example.com",
            ))),
            policy(None),
        )
        .await
        .unwrap();
    assert_eq!(*service.repository.writes.lock().unwrap(), vec![None]);
    assert!(
        EntityAccessReceipt::<OwnerAccessLevel>::try_new(
            EntityAccessAuth::Authenticated(user(OWNER)),
            receipt(EntityAccessAuth::Internal).entity().clone(),
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Edit
            },
        )
        .is_err()
    );
}

#[tokio::test]
async fn owner_clear_needs_no_team_but_enable_and_invalid_owner_level_fail_without_writes() {
    let service = service(false);
    for (level, expected) in [
        (AccessLevel::View, TeamSharePolicyError::MissingTeam),
        (AccessLevel::Owner, TeamSharePolicyError::InvalidLevel),
    ] {
        assert!(
            matches!(service.update_share_policy(receipt(EntityAccessAuth::Authenticated(user(OWNER))), policy(Some(Some(level)))).await, Err(ThreadShareError::Policy(error)) if error == expected)
        );
        assert!(service.repository.writes.lock().unwrap().is_empty());
    }
    service
        .update_share_policy(
            receipt(EntityAccessAuth::Authenticated(user(OWNER))),
            policy(Some(None)),
        )
        .await
        .unwrap();
    let writes = service.repository.writes.lock().unwrap();
    let command = writes[0].as_ref().unwrap();
    assert_eq!(command.target(), None);
    assert_eq!(command.next_revision(), 1);
}

#[tokio::test]
async fn verified_bot_scope_must_identify_the_actual_owner() {
    use entity_access::domain::models::{BotId, BotReceiptScope};
    let bot_id = BotId::new_from_uuid(uuid::Uuid::nil()).into_storage_id();
    for (scope, allowed) in [
        (
            BotReceiptScope::User {
                acting_user: user(OWNER),
            },
            true,
        ),
        (
            BotReceiptScope::User {
                acting_user: user("macro|other@example.com"),
            },
            false,
        ),
        (
            BotReceiptScope::Team {
                team_id: uuid::Uuid::nil(),
            },
            false,
        ),
    ] {
        let service = service(true);
        let receipt = EntityAccessReceipt::try_new_bot(
            bot_id.clone(),
            scope,
            receipt(EntityAccessAuth::Internal).entity().clone(),
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
        )
        .unwrap();
        assert_eq!(
            service
                .update_share_policy(receipt, policy(Some(None)))
                .await
                .is_ok(),
            allowed
        );
        assert_eq!(
            service.repository.writes.lock().unwrap().len(),
            usize::from(allowed)
        );
    }
}

#[tokio::test]
async fn wrong_entity_receipt_is_rejected_before_writes() {
    let service = service(true);
    let receipt = EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(user(OWNER)),
        entity_access::domain::models::Entity {
            entity_id: THREAD.to_owned(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap();
    assert!(matches!(
        service.update_share_policy(receipt, policy(None)).await,
        Err(ThreadShareError::InvalidInput)
    ));
    assert!(service.repository.writes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn exact_levels_become_conditional_commands() {
    for level in [AccessLevel::View, AccessLevel::Comment, AccessLevel::Edit] {
        let service = service(true);
        service
            .update_share_policy(
                receipt(EntityAccessAuth::Authenticated(user(OWNER))),
                policy(Some(Some(level))),
            )
            .await
            .unwrap();
        let writes = service.repository.writes.lock().unwrap();
        let command = writes[0].as_ref().unwrap();
        assert_eq!(AccessLevel::from(command.target().unwrap().level), level);
        assert_eq!(command.expected(), &service.repository.facts);
    }
}
