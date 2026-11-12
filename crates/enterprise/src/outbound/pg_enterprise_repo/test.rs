use super::*;
use crate::audit::AuditResult;
use crate::domain::RuntimePresetAllowlist;
use sqlx::{PgPool, Row};

static TEST_MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../macro_db_client/migrations");

async fn migrate_for_test(pool: &PgPool) {
    // The integrated source currently has two migrations at 20261110150956.
    // Give the mailbox migration a later version only in this isolated test
    // database so both real migration bodies run in their original order.
    let migrations = TEST_MIGRATOR
        .iter()
        .map(|migration| {
            let mut migration = migration.clone();
            if migration.version == 20261110150956 && migration.description == "rox mailbox handles"
            {
                migration.version = 20261110150959;
            }
            migration
        })
        .collect::<Vec<_>>();
    sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(migrations),
        ..sqlx::migrate::Migrator::DEFAULT
    }
    .run(pool)
    .await
    .unwrap();
}

async fn create_user(pool: &PgPool, email: &str) -> MacroUserIdStr<'static> {
    let macro_uuid = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $4)",
    )
    .bind(macro_uuid)
    .bind(email)
    .bind(email)
    .bind(format!("cus_{macro_uuid}"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO \"User\" (id, email, name, macro_user_id) VALUES ($1, $2, $3, $4)")
        .bind(format!("macro|{email}"))
        .bind(email)
        .bind(email)
        .bind(macro_uuid)
        .execute(pool)
        .await
        .unwrap();
    MacroUserIdStr::try_from_email(email).unwrap()
}

async fn create_team(pool: &PgPool, owner: &MacroUserIdStr<'_>) -> Uuid {
    let team_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO team (id, name, owner_id, enterprise) VALUES ($1, 'enterprise', $2, true)",
    )
    .bind(team_id)
    .bind(owner.as_ref())
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner')")
        .bind(team_id)
        .bind(owner.as_ref())
        .execute(pool)
        .await
        .unwrap();
    team_id
}

#[sqlx::test(migrations = false)]
async fn identity_binding_enforces_all_three_unique_keys(pool: PgPool) {
    migrate_for_test(&pool).await;
    let repository = PgEnterpriseRepository::new(pool.clone());
    let member = create_user(&pool, "member@example.com").await;
    let other = create_user(&pool, "other@example.com").await;
    let identity = VerifiedRoxIdentity::new("rox-account", "member").unwrap();

    repository
        .bind_verified(&member, identity.clone())
        .await
        .unwrap();
    repository
        .bind_verified(&member, identity.clone())
        .await
        .unwrap();
    assert!(
        repository
            .bind_verified(&other, identity.clone())
            .await
            .is_err()
    );
    assert!(
        repository
            .bind_verified(
                &other,
                VerifiedRoxIdentity::new("other-account", "member").unwrap()
            )
            .await
            .is_err()
    );

    let bindings =
        sqlx::query("SELECT macro_user_id, rox_account_id, handle FROM rox_identity_binding")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(bindings.len(), 1);
    assert_eq!(
        bindings[0].get::<String, _>("macro_user_id"),
        member.as_ref()
    );
    assert_eq!(
        bindings[0].get::<String, _>("rox_account_id"),
        "rox-account"
    );
    assert_eq!(bindings[0].get::<String, _>("handle"), "member");

    let secret_columns: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'rox_identity_binding' AND column_name IN ('token', 'password', 'access_token', 'mailbox_password')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(secret_columns, 0);
}

#[sqlx::test(migrations = false)]
async fn login_audit_persists_only_the_credential_free_record(pool: PgPool) {
    migrate_for_test(&pool).await;
    let repository = PgEnterpriseRepository::new(pool.clone());
    let member = create_user(&pool, "member@example.com").await;

    repository
        .record(crate::audit::AuditRecord::new(
            &member,
            crate::audit::AuditAction::Login,
            member.as_ref(),
            AuditResult::Success,
        ))
        .await
        .unwrap();

    let audit = sqlx::query(
        "SELECT actor_id, action, resource_id, result, created_at FROM enterprise_audit",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.get::<String, _>("actor_id"), member.as_ref());
    assert_eq!(audit.get::<String, _>("action"), "login");
    assert_eq!(audit.get::<String, _>("resource_id"), member.as_ref());
    assert_eq!(audit.get::<String, _>("result"), "success");
    let _: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> = audit.get("created_at");
    let forbidden_columns: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'enterprise_audit' AND column_name IN ('token', 'password', 'access_token', 'content', 'payload')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(forbidden_columns, 0);
}

#[sqlx::test(migrations = false)]
async fn member_transitions_commit_single_audits_and_audit_rejects_mutation(pool: PgPool) {
    migrate_for_test(&pool).await;
    let repository = PgEnterpriseRepository::new(pool.clone());
    let admin = create_user(&pool, "admin@example.com").await;
    let member = create_user(&pool, "member@example.com").await;

    repository
        .commit_member_state(&admin, &member, true, AuditResult::MailSuspendGap)
        .await
        .unwrap();
    assert!(repository.member_disabled(&member).await.unwrap());

    let audit = sqlx::query(
        "SELECT actor_id, action, resource_id, result, created_at FROM enterprise_audit",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.get::<String, _>("actor_id"), admin.as_ref());
    assert_eq!(audit.get::<String, _>("action"), "member_disable");
    assert_eq!(audit.get::<String, _>("resource_id"), member.as_ref());
    assert_eq!(audit.get::<String, _>("result"), "mail_suspend_gap");
    let _: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> = audit.get("created_at");
    assert!(
        sqlx::query("DELETE FROM enterprise_audit")
            .execute(&pool)
            .await
            .is_err()
    );

    repository
        .commit_member_state(&admin, &member, false, AuditResult::Success)
        .await
        .unwrap();
    assert!(!repository.member_disabled(&member).await.unwrap());
    let actions: Vec<String> =
        sqlx::query_scalar("SELECT action FROM enterprise_audit ORDER BY created_at, id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(actions, ["member_disable", "member_enable"]);
}

#[sqlx::test(migrations = false)]
async fn allowlist_absence_presence_and_clear_round_trip(pool: PgPool) {
    migrate_for_test(&pool).await;
    let repository = PgEnterpriseRepository::new(pool.clone());
    let owner = create_user(&pool, "owner@example.com").await;
    let team_id = create_team(&pool, &owner).await;

    assert!(
        repository
            .runtime_allowlist(team_id)
            .await
            .unwrap()
            .is_none()
    );
    let allowlist = RuntimePresetAllowlist {
        preset_ids: vec![RuntimePreset::Opencode],
    };
    repository
        .set_runtime_allowlist(team_id, Some(&allowlist))
        .await
        .unwrap();
    let stored = repository
        .runtime_allowlist(team_id)
        .await
        .unwrap()
        .unwrap();
    assert!(stored.permits("opencode"));
    assert!(!stored.permits("codex"));
    assert!(!stored.permits("codex-cloud"));

    repository
        .set_runtime_allowlist(team_id, None)
        .await
        .unwrap();
    assert!(
        repository
            .runtime_allowlist(team_id)
            .await
            .unwrap()
            .is_none()
    );
    let enterprise: bool = sqlx::query_scalar("SELECT enterprise FROM team WHERE id = $1")
        .bind(team_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(enterprise);
}
