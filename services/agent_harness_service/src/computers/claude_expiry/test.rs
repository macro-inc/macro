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
    for computer in [signed_in, on_credits] {
        sqlx::query!(
            r#"
            INSERT INTO hosted_runtime
                (id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, state, created_by, price_id)
            VALUES ($1, $2, 'Build box', 'standard', 4, 8, 100, 'standard@2026-11', '{}', 'macro|owner@example.com', 'price_standard')
            "#,
            computer.as_uuid(),
            TEAM,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let harness_id =
        HarnessId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0c0c));
    sqlx::query!(
        r#"
        INSERT INTO harnesses (
            id, name, owner_user_id, created_by, computer_id, capabilities, capabilities_reported_at
        )
        VALUES (
            $1, 'Build box', 'macro|owner@example.com', 'macro|owner@example.com', $2,
            '{"screen": true, "claude": {"status": "signed_in", "account_id": "acct-1", "account": "team@example.com", "expires_at": "2026-11-25T12:00:00Z"}}',
            '2026-11-01T12:01:00Z'
        )
        "#,
        harness_id.as_uuid(),
        signed_in.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    // The login row, not the capability report, holds the expiry to warn about.
    let login_id = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_1001);
    sqlx::query!(
        r#"
        WITH account AS (
            INSERT INTO provider_accounts (id, provider, external_account_id, display_email)
            VALUES ($3, 'claude', 'acct-1', 'team@example.com')
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
        report: Some(ClaudeReport::SignedIn {
            expires_at: Some(at(20, 12)),
        }),
        reported_at: Some(at(1, 12) + chrono::Duration::minutes(1)),
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

#[test]
fn every_delivery_of_a_notice_has_one_notification_id_and_each_stage_its_own() {
    let soon = ClaudeSignInExpiry {
        computer_id: ComputerId::new_from_uuid(Uuid::from_u128(1)),
        harness_id: HarnessId::new_from_uuid(Uuid::from_u128(
            0x0000_0000_0000_7000_8000_0000_0000_0c0c,
        )),
        computer_name: "Build box".to_owned(),
        notice: ClaudeSignInNotice {
            signed_in_at: Utc.with_ymd_and_hms(2026, 11, 1, 12, 0, 0).unwrap(),
            stage: ClaudeSignInStage::ExpiresSoon,
            expires_at: Some(Utc.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap()),
        },
    };
    let renamed = ClaudeSignInExpiry {
        computer_name: "Renamed box".to_owned(),
        ..soon.clone()
    };
    let today = ClaudeSignInExpiry {
        notice: ClaudeSignInNotice {
            stage: ClaudeSignInStage::ExpiresToday,
            ..soon.notice
        },
        ..soon.clone()
    };

    assert_eq!(notification_id(&soon), notification_id(&renamed));
    assert_ne!(notification_id(&soon), notification_id(&today));
}
