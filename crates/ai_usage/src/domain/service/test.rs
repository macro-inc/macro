use super::*;
use macro_user_id::user_id::MacroUserIdStr;

fn user() -> MacroUserIdStr<'static> {
    SYSTEM_USER_ID.clone()
}

fn completion(feature: AiFeature, total: Option<f32>) -> CompletionUsage {
    CompletionUsage {
        feature,
        user: user(),
        entity: None,
        cost: Usage {
            amount: UsageAmount::Tokens {
                input: 1000,
                output: 500,
            },
            model: "claude-opus-4-8".to_string(),
            price: total.map(|t| Price {
                pricing: ModelPricing::Tokens {
                    input: 5.0,
                    output: 25.0,
                },
                total: t,
            }),
            created_at: Utc::now(),
        },
    }
}

#[test]
fn price_compute_uses_per_million_rates() {
    let usage = Usage {
        amount: UsageAmount::Tokens {
            input: 1_000_000,
            output: 1_000_000,
        },
        model: "m".to_string(),
        price: None,
        created_at: Utc::now(),
    };
    let price = Price::compute(
        ModelPricing::Tokens {
            input: 5.0,
            output: 25.0,
        },
        usage.amount,
    )
    .unwrap();
    assert!((price.total - 30.0).abs() < 1e-3);
}

#[test]
fn summarize_groups_by_feature_and_totals() {
    let rows = vec![
        completion(AiFeature::Chat, Some(1.0)),
        completion(AiFeature::Chat, Some(2.5)),
        completion(AiFeature::Memory, Some(0.5)),
        completion(AiFeature::Memory, None), // unpriced rows contribute 0
    ];

    let summary = summarize(rows);

    assert_eq!(summary.entries.len(), 2);
    assert!((summary.total - 4.0).abs() < 1e-4);

    let chat = summary
        .entries
        .iter()
        .find(|f| f.feature == AiFeature::Chat)
        .unwrap();
    assert_eq!(chat.entries.len(), 2);
    assert!((chat.total - 3.5).abs() < 1e-4);

    let memory = summary
        .entries
        .iter()
        .find(|f| f.feature == AiFeature::Memory)
        .unwrap();
    assert_eq!(memory.entries.len(), 2);
    assert!((memory.total - 0.5).abs() < 1e-4);
}

#[test]
fn ai_feature_roundtrips_through_snake_case() {
    assert_eq!(
        AiFeature::DynamicCompletionsApi.to_string(),
        "dynamic_completions_api"
    );
    assert_eq!(
        "channel_bot".parse::<AiFeature>().unwrap(),
        AiFeature::ChannelBot
    );
}

#[test]
fn system_user_is_valid() {
    assert_eq!(SYSTEM_USER_ID.as_ref(), "macro|ai-system@macro.com");
}

#[derive(Clone, Default)]
struct FakeRepo {
    pricing: std::sync::Arc<std::sync::Mutex<Option<ModelPricing>>>,
    rows: std::sync::Arc<std::sync::Mutex<Vec<CompletionUsage>>>,
}

impl UsageRepo for FakeRepo {
    async fn insert_usage(&self, usage: &CompletionUsage) -> Result<()> {
        self.rows.lock().unwrap().push(usage.clone());
        Ok(())
    }

    async fn get_pricing(&self, _model: &str) -> Result<Option<ModelPricing>> {
        Ok(*self.pricing.lock().unwrap())
    }

    async fn set_pricing(&self, _model: &str, pricing: ModelPricing) -> Result<()> {
        *self.pricing.lock().unwrap() = Some(pricing);
        Ok(())
    }

    async fn query_usage(&self, _params: &UsageApiParams) -> Result<Vec<CompletionUsage>> {
        Ok(self.rows.lock().unwrap().clone())
    }
}

#[tokio::test]
async fn records_duration_with_the_model_rate_and_user_attribution() {
    let repo = FakeRepo::default();
    *repo.pricing.lock().unwrap() = Some(ModelPricing::Audio { per_minute: 0.006 });
    let event = UsageContext::new(AiFeature::Dictation, user())
        .into_audio_event("whisper-1".into(), std::time::Duration::from_millis(90_500));
    UsageServiceImpl::record_event(&repo, event).await.unwrap();
    let rows = repo.rows.lock().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user, user());
    assert_eq!(rows[0].feature, AiFeature::Dictation);
    assert_eq!(rows[0].cost.model, "whisper-1");
    assert_eq!(
        rows[0].cost.amount,
        UsageAmount::Audio {
            duration: std::time::Duration::from_millis(90_500)
        }
    );
    let price = rows[0].cost.price.unwrap();
    assert_eq!(price.pricing, ModelPricing::Audio { per_minute: 0.006 });
    assert!((price.total - 0.00905).abs() < 1e-7);
}

#[tokio::test]
async fn missing_audio_rate_keeps_usage_unpriced() {
    for rates in [
        None,
        Some(ModelPricing::Tokens {
            input: 0.0,
            output: 0.0,
        }),
    ] {
        let repo = FakeRepo::default();
        *repo.pricing.lock().unwrap() = rates;
        let event = UsageContext::new(AiFeature::Dictation, user()).into_audio_event(
            "unpriced-audio-model".into(),
            std::time::Duration::from_secs(60),
        );
        UsageServiceImpl::record_event(&repo, event).await.unwrap();
        let rows = repo.rows.lock().unwrap();
        assert_eq!(
            rows[0].cost.amount,
            UsageAmount::Audio {
                duration: std::time::Duration::from_secs(60)
            }
        );
        assert!(rows[0].cost.price.is_none());
    }
}

#[tokio::test]
async fn admin_policy_protects_usage_and_price_changes() {
    let repo = FakeRepo::default();
    let service = UsageServiceImpl::new(repo.clone());
    let other = MacroUserIdStr::try_from("macro|someone@example.com".to_owned()).unwrap();
    assert!(matches!(
        service
            .get_usage(other.clone(), UsageApiParams::default())
            .await,
        Err(UsageError::Forbidden)
    ));
    assert!(matches!(
        service
            .set_pricing(
                other,
                "whisper-1".into(),
                ModelPricing::Tokens {
                    input: 0.0,
                    output: 0.0
                }
            )
            .await,
        Err(UsageError::Forbidden)
    ));
    assert!(repo.pricing.lock().unwrap().is_none());
    service
        .set_pricing(
            user(),
            "whisper-1".into(),
            ModelPricing::Tokens {
                input: 0.0,
                output: 0.0,
            },
        )
        .await
        .unwrap();
    assert!(
        service
            .get_usage(user(), UsageApiParams::default())
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn rejects_invalid_prices_before_writing() {
    let repo = FakeRepo::default();
    let service = UsageServiceImpl::new(repo.clone());
    for price in [-0.001, f32::NAN, f32::INFINITY] {
        let pricing = ModelPricing::Audio { per_minute: price };
        assert!(matches!(
            service
                .set_pricing(user(), "whisper-1".into(), pricing)
                .await,
            Err(UsageError::InvalidPricing)
        ));
    }
    assert!(repo.pricing.lock().unwrap().is_none());
}
