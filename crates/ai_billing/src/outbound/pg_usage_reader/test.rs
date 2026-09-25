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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn quota_exempt_usage_is_recorded_but_not_billed(pool: PgPool) {
    let user =
        MacroUserIdStr::try_from("macro|projection-billing@example.com".to_string()).unwrap();
    let usage_repo = PgUsageRepo::new(pool.clone());
    usage_repo
        .insert_usage(&completion(user.clone(), AiFeature::Chat, 4.0))
        .await
        .unwrap();
    for feature in [
        AiFeature::AiProjection,
        AiFeature::AiEditing,
        AiFeature::Dictation,
    ] {
        let mut recorded = completion(user.clone(), feature, 8.0);
        if feature == AiFeature::Dictation {
            recorded.cost.amount = UsageAmount::Audio {
                duration: std::time::Duration::from_secs(60),
            };
            recorded.cost.price = Some(Price {
                pricing: ModelPricing::Audio { per_minute: 8.0 },
                total: 8.0,
            });
        }
        usage_repo.insert_usage(&recorded).await.unwrap();

        let stored = usage_repo
            .query_usage(&UsageApiParams {
                include_users: vec![user.clone()],
                features: vec![feature],
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].feature, feature);
        assert_eq!(stored[0].cost.amount, recorded.cost.amount);
        assert_eq!(stored[0].cost.price, recorded.cost.price);
    }

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
    let mut expected_features = vec![
        AiFeature::Chat,
        AiFeature::AiProjection,
        AiFeature::AiEditing,
        AiFeature::Dictation,
    ];
    expected_features.sort();
    assert_eq!(stored_features, expected_features);

    let now = Utc::now();
    let usage = PgUsageReader::new(pool)
        .list_rate_usage_cents_by_user(
            std::slice::from_ref(&user),
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn exempt_only_usage_contributes_no_billed_cents_even_without_pricing(pool: PgPool) {
    let user = MacroUserIdStr::try_from("macro|exempt-only@example.com".to_string()).unwrap();
    let usage_repo = PgUsageRepo::new(pool.clone());
    for feature in [
        AiFeature::AiProjection,
        AiFeature::AiEditing,
        AiFeature::Dictation,
    ] {
        usage_repo
            .insert_usage(&completion(user.clone(), feature, 8.0))
            .await
            .unwrap();
        let mut unpriced = completion(user.clone(), feature, 8.0);
        unpriced.cost.price = None;
        usage_repo.insert_usage(&unpriced).await.unwrap();
    }

    let now = Utc::now();
    let usage = PgUsageReader::new(pool)
        .list_rate_usage_cents_by_user(
            std::slice::from_ref(&user),
            BillingPeriod {
                start: now - Duration::minutes(1),
                end: now + Duration::minutes(1),
            },
        )
        .await
        .unwrap();
    assert!(usage.is_empty());

    let stored = usage_repo
        .query_usage(&UsageApiParams {
            include_users: vec![user],
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(stored.len(), 6);
    assert_eq!(
        stored.iter().filter(|row| row.cost.price.is_none()).count(),
        3
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn billing_period_includes_start_and_excludes_end(pool: PgPool) {
    let user = MacroUserIdStr::try_from("macro|period@example.com".to_string()).unwrap();
    let usage_repo = PgUsageRepo::new(pool.clone());
    usage_repo
        .insert_usage(&completion(user.clone(), AiFeature::Chat, 4.0))
        .await
        .unwrap();
    let stored = usage_repo
        .query_usage(&UsageApiParams {
            include_users: vec![user.clone()],
            ..Default::default()
        })
        .await
        .unwrap();
    let created_at = stored[0].cost.created_at;
    let reader = PgUsageReader::new(pool);

    for period in [
        BillingPeriod {
            start: created_at - Duration::minutes(1),
            end: created_at,
        },
        BillingPeriod {
            start: created_at + Duration::microseconds(1),
            end: created_at + Duration::minutes(1),
        },
    ] {
        assert!(
            reader
                .list_rate_usage_cents_by_user(std::slice::from_ref(&user), period)
                .await
                .unwrap()
                .is_empty()
        );
    }
    let period = BillingPeriod {
        start: created_at,
        end: created_at + Duration::minutes(1),
    };
    assert_eq!(
        reader
            .list_rate_usage_cents_by_user(std::slice::from_ref(&user), period)
            .await
            .unwrap(),
        vec![SeatUsage {
            user,
            used_cents: 1_000,
        }]
    );
    assert!(
        reader
            .list_rate_usage_cents_by_user(&[], period)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn aggregates_requested_seats_separately_with_unknown_model_fallback(pool: PgPool) {
    let first = MacroUserIdStr::try_from("macro|first-seat@example.com".to_string()).unwrap();
    let second = MacroUserIdStr::try_from("macro|second-seat@example.com".to_string()).unwrap();
    let other = MacroUserIdStr::try_from("macro|other-team@example.com".to_string()).unwrap();
    let usage_repo = PgUsageRepo::new(pool.clone());
    for user in [&first, &second, &other] {
        usage_repo
            .insert_usage(&completion(user.clone(), AiFeature::Chat, 4.0))
            .await
            .unwrap();
        usage_repo
            .insert_usage(&completion(user.clone(), AiFeature::AiEditing, 8.0))
            .await
            .unwrap();
    }
    let mut unpriced = completion(first.clone(), AiFeature::Chat, 0.0);
    unpriced.cost.model = "unknown-token-model".to_string();
    unpriced.cost.price = None;
    unpriced.cost.amount = UsageAmount::Tokens {
        input: 1_000_000,
        output: 1_000_000,
    };
    usage_repo.insert_usage(&unpriced).await.unwrap();

    let now = Utc::now();
    let mut usage = PgUsageReader::new(pool)
        .list_rate_usage_cents_by_user(
            &[first.clone(), second.clone()],
            BillingPeriod {
                start: now - Duration::minutes(1),
                end: now + Duration::minutes(1),
            },
        )
        .await
        .unwrap();
    usage.sort_by(|a, b| a.user.as_ref().cmp(b.user.as_ref()));
    assert_eq!(
        usage,
        vec![
            SeatUsage {
                user: first,
                // $4 recorded + $5 input fallback + $25 output fallback, at 2.5x.
                used_cents: 8_500,
            },
            SeatUsage {
                user: second,
                used_cents: 1_000,
            },
        ]
    );
}
