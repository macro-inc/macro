use super::*;

const GRANT: Uuid = Uuid::from_u128(0x6b000000000000000000000000000001);

enum Scenario {
    Disabled,
    Create,
    Reconnect,
    SameGrant,
    Delegate,
    Sharing,
    Promote,
    IdentityConflict,
    Disconnecting,
    Payment,
    WrongOwner,
    ZeroGeneration,
    EmptyTenant,
    EmptyMailbox,
    InvalidEmail,
    GrantForbidden,
    GrantMissing,
    GrantMalformed,
    CompletedFailure,
    InspectFailure,
    CommitFailure,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local verified Outlook grant and mailbox fixtures"
)]
async fn run(pool: PgPool, name: &'static str, shard: u32, scenario: Scenario) {
    let (mut lab, _redis) =
        start_rollout(pool, name, shard, !matches!(scenario, Scenario::Disabled)).await;
    lab.transcript.normalizer.symbol(GRANT, "<grant>");
    let reconnect = matches!(
        scenario,
        Scenario::Reconnect
            | Scenario::SameGrant
            | Scenario::IdentityConflict
            | Scenario::Disconnecting
    );
    let delegated = matches!(scenario, Scenario::Delegate);
    let shared = matches!(scenario, Scenario::Sharing | Scenario::Promote);
    let payment = matches!(scenario, Scenario::Payment);
    let actor = if reconnect || payment { 0 } else { 2 };
    if reconnect {
        professional(&lab, 0).await;
    }
    let email = if reconnect {
        "parity-a@example.com".to_owned()
    } else if delegated {
        "parity-b@example.com".to_owned()
    } else if shared {
        format!("parity-{shard}-A2@example.com")
    } else {
        "outlook-new@example.com".to_owned()
    };
    let mut grant = json!({"calendar_requested":true,"grant_id":GRANT,"generation":1,
        "owner":lab.fixture.fusion[actor],"email":email,"tenant_id":"tenant-1","mailbox_id":"mailbox-1",
        "scopes":["Mail.ReadWrite","Mail.Send","Calendars.ReadWrite"]});
    if reconnect || delegated || shared {
        let index = if reconnect {
            0
        } else if delegated {
            1
        } else {
            2
        };
        sqlx::query("UPDATE email_links SET provider='OUTLOOK',provider_tenant_id='tenant-1',provider_mailbox_id=$2 WHERE id=$1")
            .bind(lab.fixture.links[index]).bind(if matches!(scenario,Scenario::IdentityConflict) {"another-mailbox"} else {"mailbox-1"})
            .execute(&lab.db).await.expect("existing Outlook mailbox");
        if matches!(scenario, Scenario::SameGrant) {
            sqlx::query("UPDATE email_links SET grant_id=$2,grant_generation=1 WHERE id=$1")
                .bind(lab.fixture.links[index])
                .bind(GRANT)
                .execute(&lab.db)
                .await
                .expect("same Outlook grant");
        }
        if matches!(scenario, Scenario::Disconnecting) {
            sqlx::query("UPDATE email_links SET disconnect_requested_at='2026-01-01' WHERE id=$1")
                .bind(lab.fixture.links[index])
                .execute(&lab.db)
                .await
                .expect("disconnecting Outlook mailbox");
        }
    }
    let status = match scenario {
        Scenario::IdentityConflict | Scenario::Disconnecting | Scenario::Sharing => 409,
        Scenario::Payment => 402,
        Scenario::WrongOwner => {
            grant["owner"] = json!(lab.fixture.fusion[1]);
            400
        }
        Scenario::ZeroGeneration => {
            grant["generation"] = json!(0);
            400
        }
        Scenario::EmptyTenant => {
            grant["tenant_id"] = json!("");
            400
        }
        Scenario::EmptyMailbox => {
            grant["mailbox_id"] = json!("");
            400
        }
        Scenario::InvalidEmail => {
            grant["email"] = json!("invalid");
            400
        }
        Scenario::GrantForbidden => 400,
        Scenario::Disabled
        | Scenario::GrantMissing
        | Scenario::GrantMalformed
        | Scenario::CompletedFailure
        | Scenario::InspectFailure
        | Scenario::CommitFailure => 503,
        _ => 200,
    };
    attempt(&lab, actor, Some(&email), "OUTLOOK", &[], &[]).await;
    match scenario {
        Scenario::GrantForbidden => {
            lab.stub
                .reply("GET", "/internal/microsoft_grant", 403, json!({}))
        }
        Scenario::GrantMissing => {
            lab.stub
                .reply("GET", "/internal/microsoft_grant", 404, json!({}))
        }
        Scenario::GrantMalformed => {
            lab.stub
                .reply("GET", "/internal/microsoft_grant", 200, json!({}))
        }
        _ => lab
            .stub
            .reply("GET", "/internal/microsoft_grant", 200, grant),
    }
    match scenario {
        Scenario::CompletedFailure => lab.sql_fault.fail_acquisition(2),
        Scenario::InspectFailure => lab.sql_fault.fail_acquisition(3),
        Scenario::CommitFailure => {
            fail_write(&lab, "email_link_initializations", "INSERT", false).await
        }
        _ => {}
    }
    let query = if matches!(scenario, Scenario::Promote) {
        format!("{}&force_share=true", query())
    } else {
        query()
    };
    init(
        &mut lab,
        "verified Outlook grant",
        Auth::User(actor),
        &query,
        status,
    )
    .await;
    if matches!(
        scenario,
        Scenario::Create
            | Scenario::Reconnect
            | Scenario::SameGrant
            | Scenario::Delegate
            | Scenario::Promote
    ) {
        init(
            &mut lab,
            "completed Outlook attempt is idempotent",
            Auth::User(actor),
            &query,
            200,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_create(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_create", 52800, Scenario::Create).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_reconnect(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_reconnect", 52803, Scenario::Reconnect).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_same_grant(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_same_grant", 52806, Scenario::SameGrant).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_delegate(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_delegate", 52809, Scenario::Delegate).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_sharing(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_sharing", 52812, Scenario::Sharing).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_promote(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_promote", 52815, Scenario::Promote).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_identity_conflict(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "outlook_identity_conflict",
        52818,
        Scenario::IdentityConflict,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_disconnecting(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "outlook_disconnecting",
        52821,
        Scenario::Disconnecting,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_payment(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_payment", 52824, Scenario::Payment).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_wrong_owner(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_wrong_owner", 52827, Scenario::WrongOwner).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_zero_generation(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "outlook_zero_generation",
        52830,
        Scenario::ZeroGeneration,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_empty_tenant(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_empty_tenant", 52833, Scenario::EmptyTenant).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_empty_mailbox(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_empty_mailbox", 52836, Scenario::EmptyMailbox).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_invalid_email(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_invalid_email", 52839, Scenario::InvalidEmail).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_grant_forbidden(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "outlook_grant_forbidden",
        52842,
        Scenario::GrantForbidden,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_grant_missing(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_grant_missing", 52845, Scenario::GrantMissing).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_grant_malformed(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "outlook_grant_malformed",
        52848,
        Scenario::GrantMalformed,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_completed_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "outlook_completed_failure",
        52851,
        Scenario::CompletedFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_inspect_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "outlook_inspect_failure",
        52854,
        Scenario::InspectFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_commit_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "outlook_commit_failure",
        52857,
        Scenario::CommitFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn outlook_disabled(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "outlook_disabled", 52900, Scenario::Disabled).await;
}
