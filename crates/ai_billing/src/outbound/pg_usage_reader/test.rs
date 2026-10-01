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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn aggregates_only_persisted_counted_rows_for_requested_seats(pool: PgPool) {
    let first = MacroUserIdStr::try_from("macro|first@example.com".to_string()).unwrap();
    let second = MacroUserIdStr::try_from("macro|second@example.com".to_string()).unwrap();
    let outside = MacroUserIdStr::try_from("macro|outside@example.com".to_string()).unwrap();
    let empty = MacroUserIdStr::try_from("macro|empty@example.com".to_string()).unwrap();
    let repo = PgUsageRepo::new(pool.clone());
    for (user, total, counted) in [
        (&first, 1.0, true),
        (&first, 3.0, true),
        (&first, 100.0, false),
        (&second, 2.0, true),
        (&second, 200.0, false),
        (&outside, 300.0, true),
        (&empty, 400.0, false),
    ] {
        repo.insert_usage(&completion(user.clone(), AiFeature::Chat, total), counted)
            .await
            .unwrap();
    }
    // The stored decision, not today's feature classification, is authoritative.
    repo.insert_usage(&completion(second.clone(), AiFeature::Memory, 1.0), true)
        .await
        .unwrap();
    let mut unpriced = completion(second.clone(), AiFeature::Chat, 0.0);
    unpriced.cost.price = None;
    unpriced.cost.amount = UsageAmount::Tokens {
        input: 1_000_000,
        output: 1_000_000,
    };
    repo.insert_usage(&unpriced, true).await.unwrap(); // $5 input + $25 output
    repo.insert_usage(&unpriced, false).await.unwrap();

    // A default-false legacy write must never acquire debt via fallback pricing.
    sqlx::query!(
        r#"INSERT INTO ai_usage (id, feature, user_id, model, input_tokens, output_tokens)
           VALUES ($1, 'chat', $2, 'legacy-model', 1000000, 1000000)"#,
        macro_uuid::generate_uuid_v7(),
        first.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let reader = PgUsageReader::new(pool);
    let mut usage = reader
        .list_rate_usage_cents_by_user(&[first.clone(), second.clone(), empty], current_period())
        .await
        .unwrap();
    usage.sort_by(|a, b| a.user.as_ref().cmp(b.user.as_ref()));
    assert_eq!(
        usage,
        vec![
            SeatUsage {
                user: first.clone(),
                used_cents: 1_000
            },
            SeatUsage {
                user: second,
                used_cents: 8_250
            },
        ]
    );
    assert!(
        reader
            .list_rate_usage_cents_by_user(&[], current_period())
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        reader
            .list_rate_usage_cents_by_user(std::slice::from_ref(&first), current_period())
            .await
            .unwrap(),
        vec![SeatUsage {
            user: first,
            used_cents: 1_000
        }]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn billing_period_includes_start_and_excludes_end(pool: PgPool) {
    let user = MacroUserIdStr::try_from("macro|boundary@example.com".to_string()).unwrap();
    let start = chrono::DateTime::from_timestamp(1_800_000_000, 0).unwrap();
    let end = start + Duration::days(30);
    for (created_at, count_usage) in [
        (start - Duration::microseconds(1), true),
        (start, true),
        (end - Duration::microseconds(1), true),
        (end, true),
        (end + Duration::microseconds(1), true),
        (start, false),
    ] {
        sqlx::query!(
            r#"INSERT INTO ai_usage (id, feature, user_id, model, input_tokens, output_tokens,
                                    total, created_at, count_usage)
               VALUES ($1, 'chat', $2, 'test-model', 0, 0, 1.0, $3, $4)"#,
            macro_uuid::generate_uuid_v7(),
            user.as_ref(),
            created_at,
            count_usage,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let usage = PgUsageReader::new(pool)
        .list_rate_usage_cents_by_user(std::slice::from_ref(&user), BillingPeriod { start, end })
        .await
        .unwrap();
    assert_eq!(
        usage,
        vec![SeatUsage {
            user,
            used_cents: 500
        }]
    );
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
    for (usage, count_usage) in free_completions(user.clone())
        .into_iter()
        .map(|usage| (usage, false))
        .chain([
            (completion(user.clone(), AiFeature::Chat, 4.0), true),
            (completion(user.clone(), AiFeature::AiEditing, 2.0), true),
        ])
    {
        usage_repo.insert_usage(&usage, count_usage).await.unwrap();
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
        .list_rate_usage_cents_by_user(std::slice::from_ref(&user), current_period())
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
        usage_repo.insert_usage(&usage, false).await.unwrap();
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
    for (mut usage, count_usage) in free_completions(user.clone())
        .into_iter()
        .map(|usage| (usage, false))
        .chain([
            (completion(user.clone(), AiFeature::Chat, 4.0), true),
            (completion(user.clone(), AiFeature::AiEditing, 2.0), true),
        ])
    {
        usage.cost.price = None;
        usage_repo.insert_usage(&usage, count_usage).await.unwrap();
    }

    let usage = PgUsageReader::new(pool)
        .list_rate_usage_cents_by_user(std::slice::from_ref(&user), current_period())
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
