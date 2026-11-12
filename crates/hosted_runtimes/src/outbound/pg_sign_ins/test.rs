use chrono::{TimeZone, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_7ea4);

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn signed_in_computers_carry_their_signer_report_and_last_notice(pool: PgPool) {
    let macro_user_id = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0011);
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'owner@example.com', 'owner@example.com', 'stripe_owner')
        "#,
        macro_user_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|owner@example.com', 'owner@example.com', $1)"#,
        macro_user_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Computers', 'macro|owner@example.com')",
        TEAM,
    )
    .execute(&pool)
    .await
    .unwrap();
    let signed_in = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let on_credits = ComputerId::new_from_uuid(Uuid::from_u128(2));
    let host = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0b0b);
    sqlx::query!(
        "INSERT INTO hosted_runtime_host (id, name, awake_capacity_units, sold_capacity_units) VALUES ($1, 'expiry-host', 3, 9)",
        host,
    )
    .execute(&pool)
    .await
    .unwrap();
    for computer in [signed_in, on_credits] {
        sqlx::query!(
            r#"
            INSERT INTO hosted_runtime
                (id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, state, created_by, price_id, purchase_key, host_id)
            VALUES ($1, $2, 'Build box', 'standard', 4, 8, 100, 'standard@2026-11', '{}', 'macro|owner@example.com', 'price_standard', $1::uuid::text, $3)
            "#,
            computer.as_uuid(),
            TEAM,
            host,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let harness_id =
        HarnessId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0c0c));
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by, computer_id)
        VALUES ($1, 'Build box', 'macro|owner@example.com', 'macro|owner@example.com', $2)
        "#,
        harness_id.as_uuid(),
        signed_in.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    // The login row holds the expiry harnessd last reported.
    let login_id = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_1001);
    sqlx::query!(
        r#"
        WITH account AS (
            INSERT INTO provider_accounts (id, provider, external_account_id)
            VALUES ($3, 'claude', 'sha256:0123456789abcdef0123456789abcdef')
            RETURNING id
        )
        INSERT INTO harness_account_logins
            (id, harness_id, provider_account_id, provider, signed_in_by, signed_in_at, expires_at)
        SELECT $1, $2, account.id, 'claude', 'macro|owner@example.com',
               '2026-11-01T12:00:00Z', '2026-11-20T12:00:00Z'
        FROM account
        "#,
        login_id,
        harness_id.as_uuid(),
        Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_2001),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by, computer_id)
        VALUES ($1, 'Spare box', 'macro|owner@example.com', 'macro|owner@example.com', $2)
        "#,
        Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0c0d),
        on_credits.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let sign_ins = PgClaudeSignIns::new(pool);
    let at = |day, hour| Utc.with_ymd_and_hms(2026, 11, day, hour, 0, 0).unwrap();
    let expected = ClaudeSignIn {
        login_id,
        computer_id: signed_in,
        harness_id,
        team_id: TEAM,
        computer_name: "Build box".to_owned(),
        signed_in_by: Some(MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap()),
        signed_in_at: at(1, 12),
        expires_at: Some(at(20, 12)),
        last_notice: None,
    };

    assert_eq!(sign_ins.signed_in().await.unwrap(), vec![expected.clone()]);

    let notice = ClaudeSignInNotice {
        signed_in_at: at(1, 12),
        stage: ClaudeSignInStage::ExpiresSoon,
        expires_at: Some(at(20, 12)),
    };
    sign_ins.record_notice(login_id, notice).await.unwrap();

    assert_eq!(
        sign_ins.signed_in().await.unwrap(),
        vec![ClaudeSignIn {
            last_notice: Some(notice),
            ..expected
        }]
    );
}
