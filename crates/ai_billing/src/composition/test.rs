use super::*;
use crate::{AiAdmissionError, AiFeature};
use macro_user_id::user_id::MacroUserIdStr;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn configured_recorders_preserve_analytics_and_count_only_enabled_billable_usage(
    pool: PgPool,
) {
    use crate::domain::{BillingPeriod, UsageReader, list_rate_cents};
    use ai_usage::{UsageApiParams, UsageContext, UsageRepo};
    use std::time::Duration;

    let user = MacroUserIdStr::try_from("macro|quota@example.com".to_owned()).unwrap();
    let disabled =
        ai_usage::pg_recorder_with_enforcement(pool.clone(), AiUsageEnforcement::Disabled);
    let enabled = ai_usage::pg_recorder_with_enforcement(pool.clone(), AiUsageEnforcement::Enabled);
    for (recorder, context) in [
        (
            ai_usage::pg_recorder(pool.clone()),
            UsageContext::new(AiFeature::Chat, user.clone()),
        ),
        (disabled, UsageContext::new(AiFeature::Chat, user.clone())),
        (
            enabled.clone(),
            UsageContext::new(AiFeature::Chat, user.clone()),
        ),
        (
            enabled.clone(),
            UsageContext::new(AiFeature::Memory, user.clone()),
        ),
        (enabled, UsageContext::system(AiFeature::Chat)),
    ] {
        assert!(recorder.tracking().is_some());
        recorder.record(context.into_event("claude-opus-5".into(), 1_000_000, 0));
    }

    let analytics = ai_usage::outbound::PgUsageRepo::new(pool.clone());
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if analytics
                .query_usage(&UsageApiParams::default())
                .await
                .unwrap()
                .len()
                == 5
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("all analytics writes must finish, including uncounted usage");

    let usage = PgUsageReader::new(pool)
        .list_rate_usage_cents_by_user(
            &[user.clone(), ai_usage::SYSTEM_USER_ID.clone()],
            BillingPeriod::current(None, chrono::Utc::now()),
        )
        .await
        .unwrap();
    assert_eq!(usage.len(), 1);
    assert_eq!(usage[0].user, user);
    assert_eq!(usage[0].used_cents, list_rate_cents(5.0));
}

#[tokio::test]
async fn configured_composition_skips_billing_only_for_disabled_or_exempt_work() {
    // A closed pool makes every billing access fail immediately, without relying
    // on a database, network port, or the process environment.
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://localhost/unused")
        .unwrap();
    pool.close().await;
    let auth = Arc::new(AuthServiceClient::new(
        "unused".to_string(),
        "http://127.0.0.1:9".to_string(),
    ));
    let user = MacroUserIdStr::try_from("macro|quota@example.com".to_owned()).unwrap();
    let disabled = pg_admission_service(pool.clone(), AiUsageEnforcement::Disabled, auth.clone());
    assert_eq!(disabled.admit(&user, AiFeature::Chat).await, Ok(()));

    let enabled = pg_admission_service(pool.clone(), AiUsageEnforcement::Enabled, auth);
    for feature in ai_usage::NON_BILLABLE_AI_FEATURES {
        assert_eq!(enabled.admit(&user, feature).await, Ok(()));
    }
    assert_eq!(
        enabled
            .admit(&ai_usage::SYSTEM_USER_ID, AiFeature::Chat)
            .await,
        Ok(())
    );
    assert_eq!(
        enabled.admit(&user, AiFeature::Chat).await,
        Err(AiAdmissionError::Unavailable)
    );
}
