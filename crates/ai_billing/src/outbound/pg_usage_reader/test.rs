use super::*;
use ai_usage::outbound::PgUsageRepo;
use ai_usage::{
    CompletionUsage, ModelPricing, Price, Usage, UsageAmount, UsageApiParams, UsageRepo,
};
use chrono::{Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn completion(
    user: MacroUserIdStr<'static>,
    feature: AiFeature,
    provider_cost_usd: f32,
) -> CompletionUsage {
    CompletionUsage {
        feature,
        user,
        entity: None,
        cost: Usage {
            amount: UsageAmount::Tokens {
                input: 1_000_000,
                output: 0,
            },
            model: "test-model".to_string(),
            price: Some(Price {
                pricing: ModelPricing::Tokens {
                    input: provider_cost_usd,
                    output: 0.0,
                },
                total: provider_cost_usd,
            }),
            created_at: Utc::now(),
        },
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ai_projection_usage_is_recorded_but_not_metered(pool: PgPool) {
    let user =
        MacroUserIdStr::try_from("macro|projection-billing@example.com".to_string()).unwrap();
    let usage_repo = PgUsageRepo::new(pool.clone());
    usage_repo
        .insert_usage(&completion(user.clone(), AiFeature::Chat, 4.0))
        .await
        .unwrap();
    usage_repo
        .insert_usage(&completion(user.clone(), AiFeature::AiProjection, 8.0))
        .await
        .unwrap();

    let mut stored_features: Vec<_> = usage_repo
        .query_usage(&UsageApiParams {
            include_users: vec![user.clone()],
            ..Default::default()
        })
        .await
        .unwrap()
        .into_iter()
        .map(|usage| usage.feature)
        .collect();
    stored_features.sort();
    assert_eq!(
        stored_features,
        vec![AiFeature::Chat, AiFeature::AiProjection]
    );

    let now = Utc::now();
    let usage = PgUsageReader::new(pool)
        .list_rate_usage_cents_by_user(
            &[user.clone()],
            BillingPeriod {
                start: now - Duration::minutes(1),
                end: now + Duration::minutes(1),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        usage,
        vec![SeatUsage {
            user,
            used_cents: 1_000,
        }]
    );
}
