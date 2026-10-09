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
                cache_read: 0,
                cache_write: 0,
            },
            model: "test-model".to_string(),
            price: Some(Price {
                pricing: ModelPricing::Tokens {
                    input: provider_cost_usd,
                    output: 0.0,
                    cache_read: None,
                    cache_write: None,
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
        cache_read: 0,
        cache_write: 0,
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
        .usage_cost_cents_by_user(&[first.clone(), second.clone(), empty], current_period())
        .await
        .unwrap();
    usage.sort_by(|a, b| a.user.as_ref().cmp(b.user.as_ref()));
    assert_eq!(
        usage,
        vec![
            SeatUsage {
                user: first.clone(),
                used_cents: 400,
                chargeable_cost_cents: None,
            },
            SeatUsage {
                user: second,
                used_cents: 3_300,
                chargeable_cost_cents: None,
            },
        ]
    );
    assert!(
        reader
            .usage_cost_cents_by_user(&[], current_period())
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        reader
            .usage_cost_cents_by_user(std::slice::from_ref(&first), current_period())
            .await
            .unwrap(),
        vec![SeatUsage {
            user: first,
            used_cents: 400,
            chargeable_cost_cents: None,
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
        .usage_cost_cents_by_user(std::slice::from_ref(&user), BillingPeriod { start, end })
        .await
        .unwrap();
    assert_eq!(
        usage,
        vec![SeatUsage {
            user,
            used_cents: 200,
            chargeable_cost_cents: None,
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
        .usage_cost_cents_by_user(std::slice::from_ref(&user), current_period())
        .await
        .unwrap();

    assert_eq!(
        usage,
        vec![SeatUsage {
            user,
            used_cents: 600,
            chargeable_cost_cents: None,
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
        .usage_cost_cents_by_user(&[user], current_period())
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
        .usage_cost_cents_by_user(std::slice::from_ref(&user), current_period())
        .await
        .unwrap();

    // Chat and editing each fall back to $5 per million input tokens, counted
    // at cost. Unpriced free features add nothing.
    assert_eq!(
        usage,
        vec![SeatUsage {
            user,
            used_cents: 1_000,
            chargeable_cost_cents: None,
        }]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn priced_cache_tokens_count_through_the_stored_total(pool: PgPool) {
    let user = MacroUserIdStr::try_from("macro|cache-priced@example.com".to_string()).unwrap();
    let amount = UsageAmount::Tokens {
        input: 1_000_000,
        output: 0,
        cache_read: 1_000_000,
        cache_write: 1_000_000,
    };
    PgUsageRepo::new(pool.clone())
        .insert_usage(
            &CompletionUsage {
                feature: AiFeature::Chat,
                user: user.clone(),
                entity: None,
                cost: Usage {
                    amount,
                    model: "claude-opus-5".to_string(),
                    price: Price::compute(
                        ModelPricing::Tokens {
                            input: 5.0,
                            output: 25.0,
                            cache_read: Some(0.5),
                            cache_write: Some(6.25),
                        },
                        amount,
                    ),
                    created_at: Utc::now(),
                },
            },
            true,
        )
        .await
        .unwrap();

    let usage = PgUsageReader::new(pool)
        .usage_cost_cents_by_user(std::slice::from_ref(&user), current_period())
        .await
        .unwrap();

    // $5 input + $0.50 cache read + $6.25 cache write.
    assert_eq!(
        usage,
        vec![SeatUsage {
            user,
            used_cents: 1_175,
            chargeable_cost_cents: None,
        }]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unpriced_cache_tokens_fall_back_to_the_opus_5_cache_rates(pool: PgPool) {
    let user = MacroUserIdStr::try_from("macro|cache-unpriced@example.com".to_string()).unwrap();
    PgUsageRepo::new(pool.clone())
        .insert_usage(
            &CompletionUsage {
                feature: AiFeature::Chat,
                user: user.clone(),
                entity: None,
                cost: Usage {
                    amount: UsageAmount::Tokens {
                        input: 1_000_000,
                        output: 0,
                        cache_read: 1_000_000,
                        cache_write: 1_000_000,
                    },
                    model: "unpriced-cache-model".to_string(),
                    price: None,
                    created_at: Utc::now(),
                },
            },
            true,
        )
        .await
        .unwrap();

    let usage = PgUsageReader::new(pool)
        .usage_cost_cents_by_user(std::slice::from_ref(&user), current_period())
        .await
        .unwrap();

    // $5 input + $0.50 cache read + $6.25 cache write at the Opus 5 rates.
    assert_eq!(
        usage,
        vec![SeatUsage {
            user,
            used_cents: 1_175,
            chargeable_cost_cents: None,
        }]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upgrade_resets_only_the_seat_and_replays_preserve_new_usage(pool: PgPool) {
    use crate::domain::AiPricing;
    use crate::outbound::PgBillingRepo;
    let first = MacroUserIdStr::try_from("macro|upgraded@example.com").unwrap();
    let second = MacroUserIdStr::try_from("macro|teammate@example.com").unwrap();
    let period = current_period();
    let at = Utc::now();
    for user in [&first, &second] {
        let mut usage = completion(user.clone(), AiFeature::Chat, 15.0);
        usage.cost.created_at = at - Duration::seconds(1);
        insert_upgrade_usage(&pool, &usage).await;
    }
    let billing = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    billing
        .reset_usage(
            &first,
            period.start,
            at,
            Some(2_000),
            crate::domain::PlanTier::Max,
        )
        .await
        .unwrap();
    let reader = PgUsageReader::new(pool.clone());
    assert!(
        reader
            .usage_cost_cents_by_user(std::slice::from_ref(&first), period)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        reader
            .usage_cost_cents_by_user(std::slice::from_ref(&second), period)
            .await
            .unwrap()[0]
            .used_cents,
        1_500
    );
    let mut new_usage = completion(first.clone(), AiFeature::Chat, 2.0);
    new_usage.cost.created_at = at; // Reset includes the boundary instant.
    insert_upgrade_usage(&pool, &new_usage).await;
    for _ in 0..2 {
        billing
            .reset_usage(
                &first,
                period.start,
                at,
                Some(2_000),
                crate::domain::PlanTier::Max,
            )
            .await
            .unwrap();
        assert_eq!(
            reader
                .usage_cost_cents_by_user(std::slice::from_ref(&first), period)
                .await
                .unwrap()[0]
                .used_cents,
            200
        );
    }
    // Audit history and stored counting decisions are untouched.
    assert_eq!(
        PgUsageRepo::new(pool.clone())
            .query_usage(&UsageApiParams {
                include_users: vec![first.clone()],
                ..Default::default()
            })
            .await
            .unwrap()
            .len(),
        2
    );
    let next = BillingPeriod {
        start: period.end,
        end: period.end + Duration::days(30),
    };
    new_usage.cost.created_at = next.start;
    insert_upgrade_usage(&pool, &new_usage).await;
    assert_eq!(
        reader
            .usage_cost_cents_by_user(std::slice::from_ref(&first), next)
            .await
            .unwrap()[0]
            .used_cents,
        200
    );
    // A replay with a newer timestamp cannot replenish an already held Max plan.
    billing
        .reset_usage(
            &first,
            period.start,
            at + Duration::seconds(1),
            Some(2_000),
            crate::domain::PlanTier::Max,
        )
        .await
        .unwrap();
    assert_eq!(
        reader
            .usage_cost_cents_by_user(std::slice::from_ref(&first), period)
            .await
            .unwrap()
            .first()
            .unwrap()
            .used_cents,
        200
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reset_preserves_prior_overage_without_reusing_spent_credits(pool: PgPool) {
    use crate::domain::AiPricing;
    use crate::outbound::PgBillingRepo;
    let user = MacroUserIdStr::try_from("macro|overage@example.com").unwrap();
    let period = current_period();
    let at = Utc::now();
    let mut usage = completion(user.clone(), AiFeature::Chat, 22.0);
    usage.cost.created_at = at - Duration::seconds(1);
    insert_upgrade_usage(&pool, &usage).await;
    let billing = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    billing
        .reset_usage(
            &user,
            period.start,
            at,
            Some(2_000),
            crate::domain::PlanTier::Max,
        )
        .await
        .unwrap();
    let reader = PgUsageReader::new(pool.clone());
    let position = reader
        .usage_cost_cents_by_user(std::slice::from_ref(&user), period)
        .await
        .unwrap();
    assert_eq!(position[0].used_cents, 0);
    assert_eq!(position[0].chargeable_cost_cents, Some(200));
    usage.cost.created_at = at;
    usage.cost.price.as_mut().unwrap().total = 105.0;
    insert_upgrade_usage(&pool, &usage).await;
    let position = reader
        .usage_cost_cents_by_user(std::slice::from_ref(&user), period)
        .await
        .unwrap();
    assert_eq!(position[0].used_cents, 10_500);
    assert_eq!(position[0].chargeable_cost_cents, Some(700));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn free_upgrade_discards_usage_without_creating_billable_overage(pool: PgPool) {
    use crate::domain::AiPricing;
    use crate::outbound::PgBillingRepo;
    let user = MacroUserIdStr::try_from("macro|free-upgrade@example.com").unwrap();
    let period = current_period();
    let at = Utc::now();
    let mut usage = completion(user.clone(), AiFeature::Chat, 22.0);
    usage.cost.created_at = at - Duration::seconds(1);
    insert_upgrade_usage(&pool, &usage).await;
    PgBillingRepo::new(pool.clone(), AiPricing::testing())
        .reset_usage(
            &user,
            period.start,
            at,
            None,
            crate::domain::PlanTier::Premium,
        )
        .await
        .unwrap();
    let reader = PgUsageReader::new(pool.clone());
    assert!(
        reader
            .usage_cost_cents_by_user(std::slice::from_ref(&user), period)
            .await
            .unwrap()
            .is_empty()
    );
    usage.cost.created_at = at;
    usage.cost.price.as_mut().unwrap().total = 2.0;
    insert_upgrade_usage(&pool, &usage).await;
    let position = reader
        .usage_cost_cents_by_user(std::slice::from_ref(&user), period)
        .await
        .unwrap();
    assert_eq!(position[0].used_cents, 200);
    assert_eq!(position[0].chargeable_cost_cents, Some(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sequential_free_pro_max_upgrades_do_not_double_bill_public_funded_usage(pool: PgPool) {
    use crate::domain::{AiPricing, PlanTier};
    use crate::outbound::PgBillingRepo;
    let user = MacroUserIdStr::try_from("macro|sequential-upgrade@example.com").unwrap();
    let period = current_period();
    let at = Utc::now();
    let billing = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    sqlx::query!(
        "INSERT INTO ai_billing_account (user_id) VALUES ($1)",
        user.as_ref()
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO ai_billing_usage_period (user_id, payer_id, subscription_id, period_start, period_end, policy) VALUES ($1, $1, 'sub_test', $2, $3, 'public_allowance_v1')", user.as_ref(), period.start, period.end).execute(&pool).await.unwrap();
    billing
        .reset_usage(
            &user,
            period.start,
            at - Duration::seconds(2),
            None,
            PlanTier::Premium,
        )
        .await
        .unwrap();
    let mut usage = completion(user.clone(), AiFeature::Chat, 22.0);
    usage.cost.created_at = at - Duration::seconds(1);
    insert_upgrade_usage(&pool, &usage).await;
    billing
        .reset_usage(&user, period.start, at, Some(2_000), PlanTier::Max)
        .await
        .unwrap();
    let reader = PgUsageReader::new(pool.clone());
    assert!(
        reader
            .usage_cost_cents_by_user(std::slice::from_ref(&user), period)
            .await
            .unwrap()
            .is_empty()
    );
    usage.cost.created_at = at;
    usage.cost.price.as_mut().unwrap().total = 2.0;
    insert_upgrade_usage(&pool, &usage).await;
    let position = reader
        .usage_cost_cents_by_user(std::slice::from_ref(&user), period)
        .await
        .unwrap();
    assert_eq!(position[0].used_cents, 200);
    assert_eq!(position[0].chargeable_cost_cents, Some(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn batched_usage_preserves_each_change_at_a_shared_boundary(pool: PgPool) {
    use crate::domain::{AiPricing, BillingRepo, PlanTier};
    use crate::outbound::PgBillingRepo;

    let upgraded = MacroUserIdStr::try_from("macro|batched-upgrade@example.com").unwrap();
    let unchanged = MacroUserIdStr::try_from("macro|batched-unchanged@example.com").unwrap();
    let empty = MacroUserIdStr::try_from("macro|batched-empty@example.com").unwrap();
    let outside = MacroUserIdStr::try_from("macro|batched-outside@example.com").unwrap();
    let period = current_period();
    let at = period.start + Duration::seconds(10);
    let billing = PgBillingRepo::new(pool.clone(), AiPricing::testing());

    // Insert in reverse order: both transitions must survive the shared boundary,
    // and neither may turn the earlier Free usage into paid overage.
    for (from, to, old, new) in [
        (PlanTier::Premium, PlanTier::Max, Some(2_000), 10_000),
        (PlanTier::Free, PlanTier::Premium, None, 2_000),
    ] {
        billing
            .record_plan_change(
                &upgraded,
                RecordedPlanChange {
                    change: PlanChange {
                        from,
                        to,
                        at,
                        period,
                    },
                    previous_included_cents: old,
                    new_included_cents: Some(new),
                },
            )
            .await
            .unwrap();
    }
    billing
        .reset_usage(&empty, period.start, at, None, PlanTier::Premium)
        .await
        .unwrap();
    for (user, total, created_at) in [
        (&upgraded, 22.0, at - Duration::seconds(1)),
        (&upgraded, 25.0, at),
        (&unchanged, 1.0, at),
        (&outside, 100.0, at),
    ] {
        let mut usage = completion(user.clone(), AiFeature::Chat, total);
        usage.cost.created_at = created_at;
        insert_upgrade_usage(&pool, &usage).await;
    }

    let mut usage = PgUsageReader::new(pool)
        .usage_cost_cents_by_user(&[unchanged.clone(), empty, upgraded.clone()], period)
        .await
        .unwrap();
    usage.sort_by(|a, b| a.user.as_ref().cmp(b.user.as_ref()));
    assert_eq!(
        usage,
        vec![
            SeatUsage {
                user: unchanged,
                used_cents: 100,
                chargeable_cost_cents: None,
            },
            SeatUsage {
                user: upgraded,
                used_cents: 2_500,
                chargeable_cost_cents: Some(0),
            },
        ]
    );
}

// PgUsageRepo timestamps writes with the database clock. Explicitly locate this
// fixture's newest row on either side of the upgrade instead of relying on sleeps.
async fn insert_upgrade_usage(pool: &PgPool, usage: &CompletionUsage) {
    PgUsageRepo::new(pool.clone())
        .insert_usage(usage, true)
        .await
        .unwrap();
    sqlx::query!("UPDATE ai_usage SET created_at = $2 WHERE id = (SELECT id FROM ai_usage WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1)", usage.user.as_ref(), usage.cost.created_at).execute(pool).await.unwrap();
}

trait UpgradeFixture {
    async fn reset_usage(
        &self,
        user: &MacroUserIdStr<'_>,
        start: chrono::DateTime<Utc>,
        at: chrono::DateTime<Utc>,
        previous: Option<i64>,
        to: crate::domain::PlanTier,
    ) -> crate::domain::Result<()>;
}
impl UpgradeFixture for crate::outbound::PgBillingRepo {
    async fn reset_usage(
        &self,
        user: &MacroUserIdStr<'_>,
        start: chrono::DateTime<Utc>,
        at: chrono::DateTime<Utc>,
        previous: Option<i64>,
        to: crate::domain::PlanTier,
    ) -> crate::domain::Result<()> {
        use crate::domain::{BillingRepo, PlanTier};
        self.record_plan_change(
            user,
            crate::domain::plan_change::RecordedPlanChange {
                change: crate::domain::plan_change::PlanChange {
                    from: if previous.is_some() {
                        PlanTier::Premium
                    } else {
                        PlanTier::Free
                    },
                    to,
                    at,
                    period: crate::domain::BillingPeriod {
                        start,
                        end: start + chrono::Duration::days(30),
                    },
                },
                previous_included_cents: previous,
                new_included_cents: Some(if to == PlanTier::Max { 10_000 } else { 2_000 }),
            },
        )
        .await
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delayed_plan_cycle_retains_max_consumption_without_creating_downgrade_debt(pool: PgPool) {
    use crate::domain::plan_change::{PlanChange, RecordedPlanChange};
    use crate::domain::{AiPricing, BillingRepo, PlanTier};
    let user = MacroUserIdStr::try_from("macro|cycle@example.com").unwrap();
    let period = current_period();
    let at = Utc::now();
    let mut usage = completion(user.clone(), AiFeature::Chat, 80.0);
    usage.cost.created_at = at - Duration::seconds(1);
    insert_upgrade_usage(&pool, &usage).await;
    let billing = crate::outbound::PgBillingRepo::new(pool.clone(), AiPricing::testing());
    // The later event arrives first; readers use occurrence order, not insertion order.
    for (from, to, stamp, old, new) in [
        (
            PlanTier::Premium,
            PlanTier::Max,
            at + Duration::seconds(1),
            2_000,
            10_000,
        ),
        (PlanTier::Max, PlanTier::Premium, at, 10_000, 2_000),
    ] {
        let change = RecordedPlanChange {
            change: PlanChange {
                from,
                to,
                at: stamp,
                period,
            },
            previous_included_cents: Some(old),
            new_included_cents: Some(new),
        };
        billing.record_plan_change(&user, change).await.unwrap();
        billing.record_plan_change(&user, change).await.unwrap();
    }
    let reader = PgUsageReader::new(pool.clone());
    let position = reader
        .usage_cost_cents_by_user(std::slice::from_ref(&user), period)
        .await
        .unwrap();
    assert_eq!(position[0].used_cents, 8_000);
    assert_eq!(position[0].chargeable_cost_cents, Some(0));
    usage.cost.created_at = at + Duration::seconds(2);
    usage.cost.price.as_mut().unwrap().total = 25.0;
    insert_upgrade_usage(&pool, &usage).await;
    let position = reader
        .usage_cost_cents_by_user(std::slice::from_ref(&user), period)
        .await
        .unwrap();
    assert_eq!(position[0].used_cents, 10_500);
    assert_eq!(position[0].chargeable_cost_cents, Some(500));
}
