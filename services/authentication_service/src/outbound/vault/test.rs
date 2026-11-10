use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use passwords::domain::{models::*, ports::Repository};
use sqlx::PgPool;
use teams::{domain::team_repo::TeamRepository, outbound::team_repo::TeamRepositoryImpl};
struct Fixture {
    pool: PgPool,
    team: TeamId,
    member: MacroUserIdStr<'static>,
    owner: MacroUserIdStr<'static>,
    private: ItemId,
    shared: ItemId,
    pending: ItemId,
}
impl Fixture {
    async fn new(pool: PgPool) -> Self {
        let team = TeamId(Uuid::now_v7());
        for email in [
            "owner@example.test",
            "member@example.test",
            "viewer@example.test",
        ] {
            let account = Uuid::now_v7();
            let user = MacroUserIdStr::try_from_email(email).unwrap();
            sqlx::query!(
                "INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES($1,$2,$2,$3)",
                account,
                email,
                format!("fixture-{account}")
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query!(
                r#"INSERT INTO "User"(id,email,macro_user_id) VALUES($1,$2,$3)"#,
                user.as_ref(),
                email,
                account
            )
            .execute(&pool)
            .await
            .unwrap();
        }
        let owner = MacroUserIdStr::try_from_email("owner@example.test")
            .unwrap()
            .into_owned();
        let member = MacroUserIdStr::try_from_email("member@example.test")
            .unwrap()
            .into_owned();
        sqlx::query!(
            "INSERT INTO team(id,name,owner_id,seat_count) VALUES($1,'Fixture',$2,3)",
            team.0,
            owner.as_ref()
        )
        .execute(&pool)
        .await
        .unwrap();
        for (user, role) in [
            (owner.as_ref(), "owner"),
            (member.as_ref(), "member"),
            ("macro|viewer@example.test", "member"),
        ] {
            sqlx::query!("INSERT INTO team_user(team_id,user_id,team_role) VALUES($1,$2,$3::text::team_role)",team.0,user,role).execute(&pool).await.unwrap();
        }
        let private = ItemId(Uuid::now_v7());
        let shared = ItemId(Uuid::now_v7());
        let pending = ItemId(Uuid::now_v7());
        let repository = PgRepository::new(pool.clone()).unwrap();
        let now = chrono::Utc::now();
        for item in [private, shared, pending] {
            let grants = if item == private {
                vec![]
            } else {
                vec![
                    Grant {
                        kind: GranteeKind::User,
                        id: member.to_string(),
                        permission: Permission::Edit,
                    },
                    Grant {
                        kind: GranteeKind::User,
                        id: "macro|viewer@example.test".into(),
                        permission: Permission::View,
                    },
                ]
            };
            let record = Record {
                user_id: member.clone(),
                grants,
                deleting: false,
                member_removal_pending: false,
                revision: 0,
                totp_key_id: None,
                metadata: ItemMetadata {
                    id: item,
                    team_id: team,
                    name: "Credential".into(),
                    kind: ItemKind::Login,
                    url: None,
                    folder_id: None,
                    favorite: false,
                    version: 1,
                    has_totp: false,
                    shared: item != private,
                    share_count: 0,
                    created_at: now,
                    updated_at: now,
                    last_used_at: None,
                },
            };
            if item == pending {
                repository.stage(item.0, &record).await.unwrap();
            } else {
                repository.save(&record, None).await.unwrap();
            }
        }
        Self {
            pool,
            team,
            member,
            owner,
            private,
            shared,
            pending,
        }
    }
    async fn membership_exists(&self) -> bool {
        sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM team_user WHERE team_id=$1 AND user_id=$2)",
            self.team.0,
            self.member.as_ref()
        )
        .fetch_one(&self.pool)
        .await
        .unwrap()
        .unwrap()
    }
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn voluntary_leave_preserves_membership_and_private_values_until_owned_items_are_disposed(
    pool: PgPool,
) {
    let f = Fixture::new(pool).await;
    let repo = TeamRepositoryImpl::new(f.pool.clone()).with_member_vault(PasswordMemberVault);
    assert!(matches!(
        repo.leave_user_from_team(&f.team.0, &f.member).await,
        Err(RemoveUserFromTeamError::VaultItemsOwned)
    ));
    assert!(f.membership_exists().await);
    assert!(
        !PgRepository::new(f.pool.clone())
            .unwrap()
            .get(f.team, f.private)
            .await
            .unwrap()
            .deleting
    );
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admin_removal_atomically_revokes_membership_fences_private_and_preserves_only_committed_shares(
    pool: PgPool,
) {
    let f = Fixture::new(pool).await;
    let vault = PgRepository::new(f.pool.clone()).unwrap();
    let stale = vault.get(f.team, f.shared).await.unwrap();
    let repo = TeamRepositoryImpl::new(f.pool.clone()).with_member_vault(PasswordMemberVault);
    repo.remove_user_from_team(&f.team.0, &f.member)
        .await
        .unwrap();
    assert!(!f.membership_exists().await);
    assert!(
        vault
            .get(f.team, f.private)
            .await
            .unwrap()
            .member_removal_pending
    );
    assert!(!vault.get(f.team, f.private).await.unwrap().deleting);
    assert!(vault.item_cleanup_due().await.unwrap().is_empty());
    repo.finish_user_removal(&f.team.0, &f.member)
        .await
        .unwrap();
    repo.finish_user_removal(&f.team.0, &f.member)
        .await
        .unwrap();
    assert_eq!(vault.item_cleanup_due().await.unwrap().len(), 2);
    for id in [f.private, f.pending] {
        let record = vault.get(f.team, id).await.unwrap();
        assert!(record.deleting);
        assert_eq!(record.user_id, f.member);
        assert!(
            record.grants.is_empty(),
            "pending intents are not committed sharing decisions"
        );
    }
    let shared = vault.get(f.team, f.shared).await.unwrap();
    assert!(!shared.deleting);
    assert_eq!(shared.user_id, f.owner);
    assert_eq!(shared.grants.len(), 1);
    assert_eq!(shared.grants[0].id, "macro|viewer@example.test");
    assert!(matches!(shared.grants[0].permission, Permission::View));
    assert!(
        matches!(vault.save(&stale, Some(1)).await, Err(Error::Conflict)),
        "stale writes cannot restore old ownership or grants"
    );
}
struct FailAfterFence;
impl MemberVault for FailAfterFence {
    fn finish<'a>(&'a self, c: &'a mut PgConnection, t: Uuid, u: &'a str) -> MemberVaultFuture<'a> {
        PasswordMemberVault.finish(c, t, u)
    }
    fn rollback<'a>(
        &'a self,
        c: &'a mut PgConnection,
        t: Uuid,
        u: &'a str,
    ) -> MemberVaultFuture<'a> {
        PasswordMemberVault.rollback(c, t, u)
    }
    fn prepare<'a>(
        &'a self,
        connection: &'a mut PgConnection,
        team: Uuid,
        user: &'a str,
        owner: &'a str,
        mode: MemberRemovalMode,
    ) -> MemberVaultFuture<'a> {
        Box::pin(async move {
            PasswordMemberVault
                .prepare(connection, team, user, owner, mode)
                .await?;
            Err(RemoveUserFromTeamError::VaultUnavailable)
        })
    }
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_metadata_transaction_does_not_partially_remove_or_transfer_values(pool: PgPool) {
    let f = Fixture::new(pool).await;
    let repo = TeamRepositoryImpl::new(f.pool.clone()).with_member_vault(FailAfterFence);
    assert!(matches!(
        repo.remove_user_from_team(&f.team.0, &f.member).await,
        Err(RemoveUserFromTeamError::VaultUnavailable)
    ));
    assert!(f.membership_exists().await);
    let vault = PgRepository::new(f.pool.clone()).unwrap();
    assert!(!vault.get(f.team, f.private).await.unwrap().deleting);
    assert_eq!(vault.get(f.team, f.shared).await.unwrap().user_id, f.member);
    assert!(matches!(
        vault.get(f.team, f.pending).await,
        Err(Error::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn account_cleanup_closes_admission_scrubs_acknowledged_private_metadata_and_keeps_anonymous_fences(
    pool: PgPool,
) {
    let f = Fixture::new(pool).await;
    let vault = PgRepository::new(f.pool.clone()).unwrap();
    let actor = Actor {
        user_id: f.member.clone(),
        session_token: None,
    };
    assert_eq!(vault.teams(&actor).await.unwrap(), vec![f.team]);
    vault.close_user(&f.member).await.unwrap();
    assert!(vault.teams(&actor).await.unwrap().is_empty());
    let key = TotpKeyId(Uuid::now_v7());
    vault.stage_totp(f.team, f.private, key).await.unwrap();
    TeamRepositoryImpl::new(f.pool.clone())
        .with_member_vault(PasswordMemberVault)
        .remove_user_from_team(&f.team.0, &f.member)
        .await
        .unwrap();
    TeamRepositoryImpl::new(f.pool.clone())
        .with_member_vault(PasswordMemberVault)
        .finish_user_removal(&f.team.0, &f.member)
        .await
        .unwrap();
    let due = vault.retired_user_items(f.team, &f.member).await.unwrap();
    assert_eq!(due.len(), 2);
    for item in due {
        vault.delete(f.team, item).await.unwrap();
    }
    vault.scrub_user_metadata(f.team, &f.member).await.unwrap();
    for id in [f.private, f.pending] {
        let record = vault.get(f.team, id).await.unwrap();
        assert!(record.deleting);
        assert_eq!(record.user_id.as_ref(), "macro|deleted@example.invalid");
        assert!(record.metadata.name.is_empty());
        assert!(record.grants.is_empty());
    }
    assert_eq!(vault.get(f.team, f.shared).await.unwrap().user_id, f.owner);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM password_totp_enrollments WHERE team_id=$1 AND key_id=$2",
            f.team.0,
            key.0
        )
        .fetch_one(&f.pool)
        .await
        .unwrap(),
        Some(1)
    );
    assert!(vault.user_vault_teams(&f.member).await.unwrap().is_empty());
    let old_account = sqlx::query_scalar!(
        r#"DELETE FROM "User" WHERE id=$1 RETURNING macro_user_id"#,
        f.member.as_ref()
    )
    .fetch_one(&f.pool)
    .await
    .unwrap();
    sqlx::query!("DELETE FROM macro_user WHERE id=$1", old_account)
        .execute(&f.pool)
        .await
        .unwrap();
    let account = Uuid::now_v7();
    sqlx::query!("INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES($1,'member@example.test','member@example.test',$2)",account,format!("fixture-{account}")).execute(&f.pool).await.unwrap();
    sqlx::query!(
        r#"INSERT INTO "User"(id,email,macro_user_id) VALUES($1,'member@example.test',$2)"#,
        f.member.as_ref(),
        account
    )
    .execute(&f.pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user(team_id,user_id,team_role) VALUES($1,$2,'member')",
        f.team.0,
        f.member.as_ref()
    )
    .execute(&f.pool)
    .await
    .unwrap();
    assert_eq!(
        vault.teams(&actor).await.unwrap(),
        vec![f.team],
        "a new account reusing an address must not inherit the old account closure"
    );
    assert!(
        vault.get(f.team, f.private).await.unwrap().deleting,
        "old values remain fenced"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn later_saga_failure_restores_membership_with_private_values_unfenced_and_no_erasure_enqueued(
    pool: PgPool,
) {
    let f = Fixture::new(pool).await;
    let repo = TeamRepositoryImpl::new(f.pool.clone()).with_member_vault(PasswordMemberVault);
    let removed = repo
        .remove_user_from_team(&f.team.0, &f.member)
        .await
        .unwrap();
    repo.rollback_remove_user_from_team(&removed).await.unwrap();
    assert!(f.membership_exists().await);
    let vault = PgRepository::new(f.pool.clone()).unwrap();
    let private = vault.get(f.team, f.private).await.unwrap();
    assert!(
        !private.deleting,
        "a later saga failure must not erase a restored member's private values"
    );
    assert!(!private.member_removal_pending);
    assert!(vault.item_cleanup_due().await.unwrap().is_empty());
    let shared = vault.get(f.team, f.shared).await.unwrap();
    assert_eq!(shared.user_id, f.member);
    assert_eq!(shared.grants.len(), 2);
    assert!(matches!(
        vault.get(f.team, f.pending).await,
        Err(Error::NotFound)
    ));
}
