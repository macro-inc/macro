use super::*;
use crate::domain::{AiFeature, CompletionUsage, SYSTEM_USER_ID, Usage, UsageApiParams};
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

fn completion(feature: AiFeature, model: &str, input: u32, output: u32) -> CompletionUsage {
    CompletionUsage {
        feature,
        user: SYSTEM_USER_ID.clone(),
        entity: None,
        cost: Usage {
            input_tokens: input,
            output_tokens: output,
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
    assert_eq!(price, Some((5.0, 25.0)));
    assert_eq!(repo.get_pricing("nonexistent-model").await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_and_query_roundtrips(pool: PgPool) {
    let repo = PgUsageRepo::new(pool);

    let mut row = completion(AiFeature::Chat, "claude-opus-4-8", 1_000_000, 1_000_000);
    row.cost.price = Some(Price::compute(5.0, 25.0, &row.cost));
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

    repo.set_pricing("brand-new-model", 2.0, 8.0).await.unwrap();

    let after = repo.query_usage(&UsageApiParams::default()).await.unwrap();
    let price = after[0].cost.price.as_ref().unwrap();
    assert!((price.total - 2.0).abs() < 1e-3); // 1M input * $2/1M = $2
    assert_eq!(
        repo.get_pricing("brand-new-model").await.unwrap(),
        Some((2.0, 8.0))
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
