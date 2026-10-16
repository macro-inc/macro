use super::*;
use ai_usage::outbound::PgUsageRepo;
use ai_usage::{AiFeature, CompletionUsage, ModelPricing, Price, Usage, UsageAmount, UsageRepo};
use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

/// One counted (or not) completion for `user`, backdated to `at`.
async fn usage_row(
    pool: &PgPool,
    user: &MacroUserIdStr<'static>,
    at: DateTime<Utc>,
    counted: bool,
) {
    PgUsageRepo::new(pool.clone())
        .insert_usage(
            &CompletionUsage {
                feature: AiFeature::Chat,
                user: user.clone(),
                entity: None,
                cost: Usage {
                    amount: UsageAmount::Tokens {
                        input: 1_000,
                        output: 0,
                        cache_read: 0,
                        cache_write: 0,
                    },
                    model: "test-model".to_string(),
                    price: Some(Price {
                        pricing: ModelPricing::Tokens {
                            input: 1.0,
                            output: 0.0,
                            cache_read: None,
                            cache_write: None,
                        },
                        total: 0.001,
                    }),
                    created_at: at,
                },
            },
            counted,
        )
        .await
        .unwrap();
    // The insert stamps `NOW()`; the row's own timestamp is what the sweep reads.
    sqlx::query!(
        "UPDATE ai_usage SET created_at = $2 WHERE user_id = $1",
        user.as_ref(),
        at,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn reservation(
    pool: &PgPool,
    user: &MacroUserIdStr<'static>,
    status: &str,
    invoice: Option<&str>,
    updated_at: DateTime<Utc>,
) {
    sqlx::query!(
        r#"
        INSERT INTO ai_credit_reload (id, user_id, amount_cents, stripe_invoice_id, status, updated_at)
        VALUES ($1, $2, 1000, $3, ($4::text)::ai_credit_reload_status, $5)
        "#,
        macro_uuid::generate_uuid_v7(),
        user.as_ref(),
        invoice,
        status,
        updated_at,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A retired direct usage charge, which settlement never retries.
async fn abandoned_overage_charge(
    pool: &PgPool,
    user: &MacroUserIdStr<'static>,
    updated_at: DateTime<Utc>,
) {
    sqlx::query!(
        r#"
        INSERT INTO ai_overage_charge
            (id, user_id, period_start, amount_cents, stripe_invoice_id, status, updated_at)
        VALUES ($1, $2, $3, 1000, NULL, 'pending', $3)
        "#,
        macro_uuid::generate_uuid_v7(),
        user.as_ref(),
        updated_at,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn anchor(
    pool: &PgPool,
    user: &MacroUserIdStr<'static>,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) {
    sqlx::query!(
        "INSERT INTO ai_billing_account (user_id, period_start, period_end) VALUES ($1, $2, $3)",
        user.as_ref(),
        start,
        end,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lists_recent_counted_users_abandoned_reloads_and_period_boundaries(pool: PgPool) {
    let now = Utc::now();
    let since = now - Duration::hours(24);
    let finder = PgSettlementCandidates::new(pool.clone());

    // Usage: only counted rows inside the window qualify.
    let recent_counted = user("recent-counted@example.com");
    let recent_uncounted = user("recent-uncounted@example.com");
    let old_counted = user("old-counted@example.com");
    usage_row(&pool, &recent_counted, now - Duration::hours(1), true).await;
    usage_row(&pool, &recent_counted, now - Duration::hours(2), true).await;
    usage_row(&pool, &recent_uncounted, now - Duration::hours(1), false).await;
    usage_row(&pool, &old_counted, since - Duration::minutes(1), true).await;

    // Reservations: only an uninvoiced pending reload older than the
    // collector window is abandoned. Invoiced ones are with Stripe; failed
    // ones wait for the payer; fresh ones may still be collecting. Direct
    // usage charges are retired and never retried.
    let abandoned_reload = user("abandoned-reload@example.com");
    let invoiced_reload = user("invoiced-reload@example.com");
    let failed_reload = user("failed-reload@example.com");
    let collecting_reload = user("collecting-reload@example.com");
    let abandoned_charge = user("abandoned-charge@example.com");
    let stale = now - Duration::minutes(11);
    reservation(&pool, &abandoned_reload, "pending", None, stale).await;
    reservation(&pool, &invoiced_reload, "pending", Some("in_1"), stale).await;
    reservation(&pool, &failed_reload, "failed", None, stale).await;
    reservation(
        &pool,
        &collecting_reload,
        "pending",
        None,
        now - Duration::minutes(2),
    )
    .await;
    abandoned_overage_charge(&pool, &abandoned_charge, stale).await;

    // Period boundaries: a period that began or ended inside the window.
    let just_rolled = user("just-rolled@example.com");
    let just_ended = user("just-ended@example.com");
    let mid_period = user("mid-period@example.com");
    let long_ago = user("long-ago@example.com");
    let day = Duration::days(1);
    anchor(
        &pool,
        &just_rolled,
        now - Duration::hours(3),
        now + day * 30,
    )
    .await;
    anchor(&pool, &just_ended, now - day * 30, now - Duration::hours(3)).await;
    anchor(&pool, &mid_period, now - day * 10, now + day * 20).await;
    anchor(&pool, &long_ago, now - day * 60, now - day * 30).await;

    let candidates: Vec<String> = finder
        .candidates(since, now)
        .await
        .unwrap()
        .iter()
        .map(ToString::to_string)
        .collect();

    let mut expected: Vec<String> = [recent_counted, abandoned_reload, just_rolled, just_ended]
        .iter()
        .map(ToString::to_string)
        .collect();
    expected.sort_unstable();
    assert_eq!(candidates, expected);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_empty_window_lists_nobody(pool: PgPool) {
    let now = Utc::now();
    let candidates = PgSettlementCandidates::new(pool)
        .candidates(now - Duration::hours(24), now)
        .await
        .unwrap();
    assert!(candidates.is_empty());
}
