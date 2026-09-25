use super::*;
use ai_usage::outbound::PgUsageRepo;
use ai_usage::{
    AiFeature, CompletionUsage, ModelPricing, Price, Usage, UsageAmount, UsageApiParams, UsageRepo,
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

fn free_completions(user: MacroUserIdStr<'static>) -> [CompletionUsage; 4] {
    let mut dictation = completion(user.clone(), AiFeature::Dictation, 8.0);
    dictation.cost.model = "test-audio-model".to_string();
    dictation.cost.amount = UsageAmount::Audio {
        duration: std::time::Duration::from_secs(60),
    };
    dictation.cost.price = Some(Price {
        pricing: ModelPricing::Audio { per_minute: 8.0 },
        total: 8.0,
    });
    [
        completion(user.clone(), AiFeature::Memory, 8.0),
        completion(user.clone(), AiFeature::AiProjection, 8.0),
        completion(user, AiFeature::CallSummary, 8.0),
        dictation,
    ]
}

fn current_period() -> BillingPeriod {
    let now = Utc::now();
    BillingPeriod {
        start: now - Duration::minutes(1),
        end: now + Duration::minutes(1),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn free_features_are_recorded_but_only_chat_and_editing_are_metered(pool: PgPool) {
    let user = MacroUserIdStr::try_from("macro|billing@example.com".to_string()).unwrap();
    let usage_repo = PgUsageRepo::new(pool.clone());
    for usage in free_completions(user.clone()).into_iter().chain([
        completion(user.clone(), AiFeature::Chat, 4.0),
        completion(user.clone(), AiFeature::AiEditing, 2.0),
    ]) {
        usage_repo.insert_usage(&usage).await.unwrap();
    }

    let stored_usage = usage_repo
        .query_usage(&UsageApiParams {
            include_users: vec![user.clone()],
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(stored_usage.len(), 6);
    assert!(
        stored_usage
            .iter()
            .all(|usage| { usage.cost.price.is_some_and(|price| price.total > 0.0) })
    );
    let mut stored_features: Vec<_> = stored_usage.iter().map(|usage| usage.feature).collect();
    stored_features.sort();
    let mut expected_features = vec![
        AiFeature::Chat,
        AiFeature::Memory,
        AiFeature::CallSummary,
        AiFeature::AiProjection,
        AiFeature::AiEditing,
        AiFeature::Dictation,
    ];
    expected_features.sort();
    assert_eq!(stored_features, expected_features);

    let usage = PgUsageReader::new(pool)
        .list_rate_usage_cents_by_user(&[user.clone()], current_period())
        .await
        .unwrap();

    assert_eq!(
        usage,
        vec![SeatUsage {
            user,
            used_cents: 1_500,
        }]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn free_features_alone_do_not_produce_billable_usage(pool: PgPool) {
    let user = MacroUserIdStr::try_from("macro|billing@example.com".to_string()).unwrap();
    let usage_repo = PgUsageRepo::new(pool.clone());
    for usage in free_completions(user.clone()) {
        usage_repo.insert_usage(&usage).await.unwrap();
    }

    let usage = PgUsageReader::new(pool)
        .list_rate_usage_cents_by_user(&[user], current_period())
        .await
        .unwrap();
    assert!(usage.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unpriced_free_features_are_excluded_from_fallback_billing(pool: PgPool) {
    let user = MacroUserIdStr::try_from("macro|billing@example.com".to_string()).unwrap();
    let usage_repo = PgUsageRepo::new(pool.clone());
    for mut usage in free_completions(user.clone()).into_iter().chain([
        completion(user.clone(), AiFeature::Chat, 4.0),
        completion(user.clone(), AiFeature::AiEditing, 2.0),
    ]) {
        usage.cost.price = None;
        usage_repo.insert_usage(&usage).await.unwrap();
    }

    let usage = PgUsageReader::new(pool)
        .list_rate_usage_cents_by_user(&[user.clone()], current_period())
        .await
        .unwrap();

    // Chat and editing each fall back to $5 per million input tokens, with
    // the 2.5x list-rate markup. Unpriced free features add nothing.
    assert_eq!(
        usage,
        vec![SeatUsage {
            user,
            used_cents: 2_500,
        }]
    );
}
