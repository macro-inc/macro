use super::*;
use crate::domain::{AiFeature, CompletionUsage, SYSTEM_USER_ID, Usage, UsageApiParams};
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

fn completion(feature: AiFeature, model: &str, input: u64, output: u64) -> CompletionUsage {
    CompletionUsage {
        feature,
        user: SYSTEM_USER_ID.clone(),
        entity: None,
        cost: Usage {
            amount: UsageAmount::Tokens { input, output },
            model: model.to_string(),
            price: None,
            created_at: Utc::now(),
        },
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn seeded_pricing_is_available(pool: PgPool) {
    let repo = PgUsageRepo::new(pool);
    let price = repo.get_pricing("claude-opus-4-8").await.unwrap();
    assert_eq!(
        price,
        Some(ModelPricing::Tokens {
            input: 5.0,
            output: 25.0
        })
    );
    let price = repo.get_pricing("claude-opus-5").await.unwrap();
    assert_eq!(
        price,
        Some(ModelPricing::Tokens {
            input: 5.0,
            output: 25.0
        })
    );
    assert_eq!(
        repo.get_pricing("whisper-1").await.unwrap(),
        Some(ModelPricing::Audio { per_minute: 0.006 })
    );
    assert_eq!(repo.get_pricing("nonexistent-model").await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_and_query_roundtrips(pool: PgPool) {
    let repo = PgUsageRepo::new(pool);

    let mut row = completion(AiFeature::Chat, "claude-opus-4-8", 1_000_000, 1_000_000);
    row.cost.price = Price::compute(
        repo.get_pricing("claude-opus-4-8").await.unwrap().unwrap(),
        row.cost.amount,
    );
    repo.insert_usage(&row).await.unwrap();
    repo.insert_usage(&completion(AiFeature::Memory, "unknown-model", 10, 20))
        .await
        .unwrap();

    let all = repo.query_usage(&UsageApiParams::default()).await.unwrap();
    assert_eq!(all.len(), 2);

    let chat_only = repo
        .query_usage(&UsageApiParams {
            features: vec![AiFeature::Chat],
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(chat_only.len(), 1);
    let priced = &chat_only[0];
    assert_eq!(priced.feature, AiFeature::Chat);
    assert!((priced.cost.price.as_ref().unwrap().total - 30.0).abs() < 1e-3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_pricing_recomputes_existing_rows(pool: PgPool) {
    let repo = PgUsageRepo::new(pool);

    // Record with an unknown model so price starts NULL.
    repo.insert_usage(&completion(
        AiFeature::Automation,
        "brand-new-model",
        1_000_000,
        0,
    ))
    .await
    .unwrap();

    let before = repo.query_usage(&UsageApiParams::default()).await.unwrap();
    assert!(before[0].cost.price.is_none());

    repo.set_pricing(
        "brand-new-model",
        ModelPricing::Tokens {
            input: 2.0,
            output: 8.0,
        },
    )
    .await
    .unwrap();

    let after = repo.query_usage(&UsageApiParams::default()).await.unwrap();
    let price = after[0].cost.price.as_ref().unwrap();
    assert!((price.total - 2.0).abs() < 1e-3); // 1M input * $2/1M = $2
    assert_eq!(
        repo.get_pricing("brand-new-model").await.unwrap(),
        Some(ModelPricing::Tokens {
            input: 2.0,
            output: 8.0
        })
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn query_filters_by_user(pool: PgPool) {
    let repo = PgUsageRepo::new(pool);

    let mut other = completion(AiFeature::Chat, "claude-opus-4-8", 1, 1);
    other.user = MacroUserIdStr::try_from("macro|someone@example.com".to_string()).unwrap();
    repo.insert_usage(&other).await.unwrap();
    repo.insert_usage(&completion(AiFeature::Chat, "claude-opus-4-8", 1, 1))
        .await
        .unwrap();

    let only_other = repo
        .query_usage(&UsageApiParams {
            include_users: vec![
                MacroUserIdStr::try_from("macro|someone@example.com".to_string()).unwrap(),
            ],
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(only_other.len(), 1);
    assert_eq!(only_other[0].user.as_ref(), "macro|someone@example.com");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn duration_usage_roundtrips_and_reprices_without_affecting_tokens(pool: PgPool) {
    let repo = PgUsageRepo::new(pool);
    let mut audio = completion(AiFeature::Dictation, "whisper-1", 0, 0);
    let amount = UsageAmount::Audio {
        duration: std::time::Duration::from_millis(90_500),
    };
    audio.cost.amount = amount;
    audio.cost.price = Price::compute(
        repo.get_pricing("whisper-1").await.unwrap().unwrap(),
        audio.cost.amount,
    );
    repo.insert_usage(&audio).await.unwrap();
    repo.insert_usage(&completion(
        AiFeature::Chat,
        "claude-opus-4-8",
        1_000_000,
        0,
    ))
    .await
    .unwrap();

    let query = UsageApiParams {
        features: vec![AiFeature::Dictation],
        ..Default::default()
    };
    let rows = repo.query_usage(&query).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].cost.amount, amount);
    assert!((rows[0].cost.price.unwrap().total - 0.00905).abs() < 1e-7);

    for rate in [None, Some(0.012)] {
        repo.set_pricing(
            "whisper-1",
            match rate {
                Some(per_minute) => ModelPricing::Audio { per_minute },
                None => ModelPricing::Tokens {
                    input: 0.0,
                    output: 0.0,
                },
            },
        )
        .await
        .unwrap();
        let rows = repo.query_usage(&query).await.unwrap();
        assert_eq!(rows[0].cost.amount, amount);
        match rate {
            None => assert!(rows[0].cost.price.is_none()),
            Some(rate) => {
                let price = rows[0].cost.price.unwrap();
                assert_eq!(price.pricing, ModelPricing::Audio { per_minute: rate });
                assert!((price.total - 0.0181).abs() < 1e-7);
            }
        }
    }
    let chat = repo
        .query_usage(&UsageApiParams {
            features: vec![AiFeature::Chat],
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(
        chat[0].cost.amount,
        UsageAmount::Tokens {
            input: 1_000_000,
            output: 0
        }
    );
    assert!(
        chat[0].cost.price.is_none(),
        "repricing another model must not touch chat rows"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repricing_cannot_apply_audio_rates_to_token_usage(pool: PgPool) {
    let repo = PgUsageRepo::new(pool);
    repo.insert_usage(&completion(AiFeature::Chat, "mixed-history", 1_000_000, 0))
        .await
        .unwrap();
    repo.set_pricing("mixed-history", ModelPricing::Audio { per_minute: 0.006 })
        .await
        .unwrap();
    let rows = repo.query_usage(&UsageApiParams::default()).await.unwrap();
    assert!(rows[0].cost.price.is_none());
    repo.set_pricing(
        "mixed-history",
        ModelPricing::Tokens {
            input: 2.0,
            output: 8.0,
        },
    )
    .await
    .unwrap();
    let rows = repo.query_usage(&UsageApiParams::default()).await.unwrap();
    assert_eq!(rows[0].cost.price.unwrap().total, 2.0);
}
