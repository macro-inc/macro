//! Subscription mutation locking, schedules, and Stripe request construction.

use super::*;

impl CustomerRepositoryImpl {
    pub(super) async fn billing_guard(
        locks: &sqlx::PgPool,
        key: &str,
    ) -> Result<sqlx::Transaction<'static, sqlx::Postgres>, CustomerError> {
        let mut guard = locks
            .begin()
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
            .execute(&mut *guard)
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;
        Ok(guard)
    }

    pub(super) async fn subscription_guard(
        &self,
        id: &stripe::SubscriptionId,
        operation: Option<&str>,
    ) -> Result<sqlx::Transaction<'static, sqlx::Postgres>, CustomerError> {
        let guard = Self::billing_guard(
            &self.subscription_locks,
            &format!("subscription-billing:{id}"),
        )
        .await?;
        let pending = sqlx::query_scalar!(
            "SELECT idempotency_key FROM subscription_item_change WHERE subscription_id = $1 AND outcome = 'pending'",
            id.as_str(),
        ).fetch_optional(&self.pool).await.map_err(|error| CustomerError::StorageLayerError(error.into()))?;
        if let Some(pending) = pending
            && Some(pending.as_str()) != operation
        {
            return Err(SubscriptionDataError::UnresolvedItemChange.into());
        }
        Ok(guard)
    }

    pub(super) async fn read_pending(
        &self,
        subscription: &str,
        record: &str,
    ) -> Result<PendingChanges, CustomerError> {
        let id: uuid::Uuid = record
            .parse()
            .map_err(|e| CustomerError::StorageLayerError(anyhow::Error::from(e)))?;
        let row = sqlx::query!("SELECT effective_at, member_plans FROM subscription_plan_schedule WHERE id = $1 AND subscription_id = $2", id, subscription).fetch_one(&self.pool).await.map_err(|e| CustomerError::StorageLayerError(e.into()))?;
        Ok(PendingChanges {
            at: row.effective_at.timestamp(),
            members: serde_json::from_value(row.member_plans)
                .map_err(|e| CustomerError::StorageLayerError(e.into()))?,
        })
    }
    pub(super) async fn pending_changes(
        &self,
        schedule: &stripe::SubscriptionSchedule,
        subscription: &stripe::Subscription,
    ) -> Result<PendingChanges, CustomerError> {
        match schedule.metadata.as_ref().and_then(|m| m.get(PENDING_KEY)) {
            Some(record) => self.read_pending(subscription.id.as_str(), record).await,
            None => Ok(PendingChanges {
                at: subscription.current_period_end,
                members: HashMap::new(),
            }),
        }
    }

    pub(super) async fn read_scheduled_seat_plans(
        &self,
        subscription: &stripe::SubscriptionId,
        schedule: &stripe::SubscriptionScheduleId,
    ) -> Result<HashMap<String, ScheduledSeatPlan>, CustomerError> {
        let schedule = stripe::SubscriptionSchedule::retrieve(&self.client, schedule, &[])
            .await
            .map_err(storage)?;
        if schedule
            .metadata
            .as_ref()
            .and_then(|m| m.get(OWNED_KEY))
            .map(String::as_str)
            != Some("1")
            || !matches!(
                schedule.status,
                stripe::SubscriptionScheduleStatus::Active
                    | stripe::SubscriptionScheduleStatus::NotStarted
            )
        {
            return Ok(HashMap::new());
        }
        let Some(record) = schedule.metadata.as_ref().and_then(|m| m.get(PENDING_KEY)) else {
            return Ok(HashMap::new());
        };
        let changes = self.read_pending(subscription.as_str(), record).await?;
        let effective_at =
            chrono::DateTime::from_timestamp(changes.at, 0).context("invalid scheduled renewal")?;
        Ok(changes
            .members
            .into_iter()
            .map(|(user, plan)| (user, ScheduledSeatPlan { plan, effective_at }))
            .collect())
    }

    pub(super) async fn release_schedule(
        &self,
        id: &stripe::SubscriptionScheduleId,
    ) -> Result<(), CustomerError> {
        self.client
            .post::<stripe::SubscriptionSchedule>(&format!("/subscription_schedules/{id}/release"))
            .await
            .map_err(storage)?;
        Ok(())
    }

    pub(super) async fn write_schedule(
        &self,
        schedule: &stripe::SubscriptionSchedule,
        subscription: &stripe::Subscription,
        mut current: serde_json::Value,
        pending: PendingChanges,
        proration: &str,
        idempotency_key: Option<&str>,
    ) -> Result<(), CustomerError> {
        current["end_date"] = pending.at.into();
        let mut next = current.clone();
        next["start_date"] = pending.at.into();
        next.as_object_mut().unwrap().remove("end_date");
        next.as_object_mut().unwrap().remove("trial_end");
        next.as_object_mut().unwrap().remove("add_invoice_items");
        next["iterations"] = 1.into();
        next["proration_behavior"] = "none".into();
        let mut quantities = phase_quantities(&current)?;
        let max = self.seat_prices.price_id(SeatPlan::Max)?.to_string();
        let pro = self.seat_prices.price_id(SeatPlan::Premium)?.to_string();
        let count = pending.members.len() as u64;
        let source = quantities.get(&max).copied().unwrap_or(0);
        if source < count {
            return Err(CustomerError::StorageLayerError(anyhow::anyhow!(
                "scheduled downgrades exceed active Max seats"
            )));
        }
        // A new lower-price item retains the seat's item-level tax and billing
        // settings as well as the phase-wide settings copied above.
        let source_item = next["items"]
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item["price"].as_str() == Some(max.as_str()))
            })
            .cloned();
        if let Some(mut item) = source_item
            && !next["items"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["price"].as_str() == Some(pro.as_str()))
        {
            item["price"] = pro.clone().into();
            next["items"].as_array_mut().unwrap().push(item);
        }
        quantities.insert(max, source - count);
        *quantities.entry(pro).or_default() += count;
        replace_quantities(&mut next, &quantities);
        if next.get("metadata").is_none() {
            next["metadata"] = serde_json::json!({});
        }
        let record_id = macro_uuid::generate_uuid_v7();
        let effective_at =
            chrono::DateTime::from_timestamp(pending.at, 0).context("invalid scheduled renewal")?;
        let members = serde_json::to_value(&pending.members)
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;
        sqlx::query!("INSERT INTO subscription_plan_schedule (id, subscription_id, effective_at, member_plans) VALUES ($1, $2, $3, $4)", record_id, subscription.id.as_str(), effective_at, members).execute(&self.pool).await.map_err(|e| CustomerError::StorageLayerError(e.into()))?;
        let encoded = record_id.to_string();
        next["metadata"][APPLIED_KEY] = encoded.clone().into();
        let mut request = ScheduleUpdate {
            phases: vec![current, next],
            proration_behavior: proration,
            end_behavior: "release",
            metadata: HashMap::from([
                (OWNED_KEY.to_string(), "1".to_string()),
                (PENDING_KEY.to_string(), encoded),
            ]),
        };
        if let Some(key) = idempotency_key {
            request
                .metadata
                .insert(ITEM_CHANGE_KEY.to_owned(), key.to_owned());
            let request = serde_json::to_value(request)
                .map_err(|error| CustomerError::StorageLayerError(error.into()))?;
            return self
                .send_item_change(
                    &subscription.id,
                    key,
                    format!("/subscription_schedules/{}", schedule.id),
                    request,
                )
                .await;
        }
        self.client
            .post_form::<stripe::SubscriptionSchedule, _>(
                &format!("/subscription_schedules/{}", schedule.id),
                &request,
            )
            .await
            .map_err(storage)?;
        Ok(())
    }

    /// Creates a new instance of CustomerRepositoryImpl
    pub fn new(stripe_client: stripe::Client, seat_prices: SeatPrices, pool: sqlx::PgPool) -> Self {
        // Guards hold connections across provider and repository calls. Separate
        // pools keep waiters from exhausting the pool those calls need, and keep
        // the team -> subscription lock order from exhausting its own capacity.
        let lock_pool = || {
            sqlx::postgres::PgPoolOptions::new()
                .max_connections(pool.options().get_max_connections().min(4))
                .idle_timeout(std::time::Duration::from_secs(60))
                .connect_lazy_with(
                    pool.connect_options()
                        .as_ref()
                        .clone()
                        .options([("lock_timeout", "30000")]),
                )
        };
        let team_locks = lock_pool();
        let subscription_locks = lock_pool();
        Self {
            client: Arc::new(stripe_client),
            seat_prices,
            pool,
            team_locks,
            subscription_locks,
        }
    }

    /// The active subscription's seat items, keyed by plan.
    pub(super) async fn get_seat_items(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> Result<HashMap<SeatPlan, SeatItem>, CustomerError> {
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        if subscription.status != stripe::SubscriptionStatus::Active
            && subscription.status != stripe::SubscriptionStatus::Trialing
        {
            return Err(CustomerError::SubscriptionNotActive);
        }

        let items: HashMap<SeatPlan, SeatItem> = subscription
            .items
            .data
            .iter()
            .filter_map(|item| {
                let price = item.price.as_ref()?;
                let plan = self.seat_prices.plan_for_price(price.id.as_str())?;
                Some((
                    plan,
                    SeatItem {
                        id: item.id.to_string(),
                        quantity: item.quantity.unwrap_or(1),
                    },
                ))
            })
            .collect();

        if items.is_empty() {
            return Err(CustomerError::NoMatchingLineItem);
        }

        Ok(items)
    }

    /// The item update that leaves `plan` with `quantity` seats: a new item
    /// when the plan had none, a deletion when it drops to zero.
    pub(super) fn seat_item_update(
        &self,
        plan: SeatPlan,
        existing: Option<&SeatItem>,
        quantity: u64,
    ) -> Result<UpdateSubscriptionItems, CustomerError> {
        Ok(match existing {
            Some(item) if quantity == 0 => UpdateSubscriptionItems {
                id: Some(item.id.clone()),
                deleted: Some(true),
                ..Default::default()
            },
            Some(item) => UpdateSubscriptionItems {
                id: Some(item.id.clone()),
                quantity: Some(quantity),
                ..Default::default()
            },
            None => UpdateSubscriptionItems {
                price: Some(self.seat_prices.price_id(plan)?.to_string()),
                quantity: Some(quantity),
                ..Default::default()
            },
        })
    }

    pub(super) async fn update_items(
        &self,
        subscription_id: &stripe::SubscriptionId,
        items: Vec<UpdateSubscriptionItems>,
        options: ItemUpdateOptions<'_>,
    ) -> Result<(), CustomerError> {
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(storage)?;
        self.update_retrieved_items(subscription, items, options)
            .await
    }

    pub(super) async fn update_retrieved_items(
        &self,
        subscription: stripe::Subscription,
        items: Vec<UpdateSubscriptionItems>,
        options: ItemUpdateOptions<'_>,
    ) -> Result<(), CustomerError> {
        let subscription_id = &subscription.id;
        let end_trial = subscription.status == stripe::SubscriptionStatus::Trialing
            && self.adds_first_max_seat(&subscription, &items)?;
        if let Some(schedule_id) = subscription.schedule.as_ref().map(|s| s.id()) {
            let schedule = stripe::SubscriptionSchedule::retrieve(&self.client, &schedule_id, &[])
                .await
                .map_err(storage)?;
            require_owned_schedule(&schedule)?;
            let pending = self.pending_changes(&schedule, &subscription).await?;
            // A Pro trial gaining Max ends now. With no Max seat before, no seat
            // is waiting to downgrade, so release the schedule and bill directly.
            if !end_trial && pending.at > subscription.current_period_start {
                let current = current_phase(&schedule, &subscription)?;
                let mut phase = phase_parameters(current)?;
                let mut quantities = subscription
                    .items
                    .data
                    .iter()
                    .filter_map(|i| {
                        i.price
                            .as_ref()
                            .map(|p| (p.id.to_string(), i.quantity.unwrap_or(1)))
                    })
                    .collect::<HashMap<_, _>>();
                for update in &items {
                    let price = update
                        .price
                        .clone()
                        .or_else(|| {
                            subscription
                                .items
                                .data
                                .iter()
                                .find(|i| Some(i.id.as_str()) == update.id.as_deref())
                                .and_then(|i| i.price.as_ref())
                                .map(|p| p.id.to_string())
                        })
                        .context("missing item price")?;
                    if update.deleted == Some(true) {
                        quantities.remove(&price);
                    } else {
                        quantities.insert(price, update.quantity.unwrap_or(1));
                    }
                }
                replace_quantities(&mut phase, &quantities);
                self.write_schedule(
                    &schedule,
                    &subscription,
                    phase,
                    pending,
                    "always_invoice",
                    options.idempotency_key,
                )
                .await?;
                return Ok(());
            }
            // The scheduled phase already became effective. Release it before
            // an immediate upgrade; acknowledging old metadata cannot undo it.
            self.release_schedule(&schedule.id).await?;
        }
        let mut update_params = UpdateSubscription {
            items: Some(items),
            proration_behavior: Some(
                stripe::generated::billing::subscription::SubscriptionProrationBehavior::AlwaysInvoice,
            ),
            ..Default::default()
        };
        if end_trial {
            // A trial has no paid remainder to prorate. Reset the cycle so Max
            // bills a full period today instead of inheriting the trial end.
            update_params.trial_end = Some(stripe::Scheduled::now());
            update_params.billing_cycle_anchor = Some(stripe::SubscriptionBillingCycleAnchor::Now);
        }
        if options.error_if_incomplete {
            update_params.payment_behavior =
                Some(stripe::generated::billing::subscription::SubscriptionPaymentBehavior::ErrorIfIncomplete);
        }
        if let Some(key) = options.idempotency_key {
            update_params.metadata = Some(HashMap::from([(
                ITEM_CHANGE_KEY.to_owned(),
                key.to_owned(),
            )]));
            let request = serde_json::to_value(update_params)
                .map_err(|error| CustomerError::StorageLayerError(error.into()))?;
            return self
                .send_item_change(
                    subscription_id,
                    key,
                    format!("/subscriptions/{subscription_id}"),
                    request,
                )
                .await;
        }

        stripe::Subscription::update(&self.client, subscription_id, update_params)
            .await
            .map_err(|error| update_error(error, options.error_if_incomplete))?;

        Ok(())
    }

    /// Whether the seat update gives a subscription without Max seats its first
    /// one. A subscription already trialing on Max keeps its trial terms, and
    /// its scheduled downgrades, through other seat changes.
    fn adds_first_max_seat(
        &self,
        subscription: &stripe::Subscription,
        items: &[UpdateSubscriptionItems],
    ) -> Result<bool, CustomerError> {
        let Ok(max) = self.seat_prices.price_id(SeatPlan::Max) else {
            return Ok(false);
        };
        let max_items: Vec<_> = subscription
            .items
            .data
            .iter()
            .filter(|item| {
                item.price
                    .as_ref()
                    .is_some_and(|price| price.id.as_str() == max.as_str())
            })
            .collect();
        let mut quantity = max_items
            .iter()
            .map(|item| item.quantity.unwrap_or(1))
            .sum::<u64>();
        if quantity > 0 {
            return Ok(false);
        }
        for update in items {
            if let Some(price) = &update.price {
                if price.as_str() == max.as_str() {
                    quantity = quantity.saturating_add(update.quantity.unwrap_or(1));
                }
                continue;
            }
            let Some(id) = &update.id else {
                continue;
            };
            let Some(existing) = max_items.iter().find(|item| item.id.as_str() == id) else {
                continue;
            };
            quantity = quantity.saturating_sub(existing.quantity.unwrap_or(1));
            if update.deleted != Some(true) {
                quantity = quantity.saturating_add(
                    update
                        .quantity
                        .unwrap_or_else(|| existing.quantity.unwrap_or(1)),
                );
            }
        }
        Ok(quantity > 0)
    }
}
