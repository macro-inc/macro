//! Durable receipts and exact requests for subscription item changes.

use super::*;

#[cfg(test)]
mod test;

#[derive(Clone, Copy, PartialEq, Eq, sqlx::Type)]
#[sqlx(
    type_name = "subscription_item_change_outcome",
    rename_all = "snake_case"
)]
pub(super) enum ItemChangeOutcome {
    Pending,
    Succeeded,
    PaymentFailed,
    /// Given up while its outcome was unknown; never sent again.
    Abandoned,
}

pub(super) struct ItemChange {
    subscription_id: String,
    path: String,
    request: serde_json::Value,
    outcome: ItemChangeOutcome,
}

impl CustomerRepositoryImpl {
    pub(super) async fn item_change(&self, key: &str) -> Result<Option<ItemChange>, CustomerError> {
        sqlx::query_as!(
            ItemChange,
            r#"SELECT subscription_id, path, request, outcome AS "outcome: ItemChangeOutcome" FROM subscription_item_change WHERE idempotency_key = $1"#,
            key,
        ).fetch_optional(&self.pool).await.map_err(|error| CustomerError::StorageLayerError(error.into()))
    }

    async fn finish_item_change(
        &self,
        key: &str,
        outcome: ItemChangeOutcome,
    ) -> Result<(), CustomerError> {
        sqlx::query!(
            "UPDATE subscription_item_change SET outcome = $2 WHERE idempotency_key = $1",
            key,
            outcome as ItemChangeOutcome,
        )
        .execute(&self.pool)
        .await
        .map_err(|error| CustomerError::StorageLayerError(error.into()))?;
        Ok(())
    }

    /// Called while holding the subscription guard. Unknown outcomes keep the
    /// guard's durable pending record, blocking later mutations until replay.
    async fn submit_item_change(&self, key: &str, change: ItemChange) -> Result<(), CustomerError> {
        match change.outcome {
            ItemChangeOutcome::Succeeded => return Ok(()),
            ItemChangeOutcome::PaymentFailed => return Err(CustomerError::PaymentFailed),
            ItemChangeOutcome::Abandoned => return Err(CustomerError::ItemChangeAbandoned),
            ItemChangeOutcome::Pending => {}
        }
        let client = self
            .client
            .as_ref()
            .clone()
            .with_strategy(stripe::RequestStrategy::Idempotent(key.to_owned()));
        let result = client
            .post_form::<serde_json::Value, _>(&change.path, &change.request)
            .await;
        match result {
            Ok(_) => {
                self.finish_item_change(key, ItemChangeOutcome::Succeeded)
                    .await
            }
            Err(error) => {
                let error_if_incomplete = change
                    .request
                    .get("payment_behavior")
                    .and_then(serde_json::Value::as_str)
                    == Some("error_if_incomplete");
                let error = update_error(error, error_if_incomplete);
                if matches!(error, CustomerError::PaymentFailed) {
                    self.finish_item_change(key, ItemChangeOutcome::PaymentFailed)
                        .await?;
                }
                Err(error)
            }
        }
    }

    /// Recover a lost response from the atomic provider marker before sending
    /// the immutable original request again. A different mutation cannot replace
    /// that marker while this operation is pending.
    pub(super) async fn replay_item_change_locked(
        &self,
        key: &str,
        change: ItemChange,
    ) -> Result<(), CustomerError> {
        if change.outcome != ItemChangeOutcome::Pending {
            return self.submit_item_change(key, change).await;
        }
        let current = self
            .client
            .get::<serde_json::Value>(&change.path)
            .await
            .map_err(storage)?;
        if current
            .get("metadata")
            .and_then(|metadata| metadata.get(ITEM_CHANGE_KEY))
            .and_then(serde_json::Value::as_str)
            == Some(key)
        {
            return self
                .finish_item_change(key, ItemChangeOutcome::Succeeded)
                .await;
        }
        self.submit_item_change(key, change).await
    }

    /// Persist the exact endpoint and request before the first charge attempt.
    pub(super) async fn send_item_change(
        &self,
        subscription: &stripe::SubscriptionId,
        key: &str,
        path: String,
        request: serde_json::Value,
    ) -> Result<(), CustomerError> {
        sqlx::query!(
            "INSERT INTO subscription_item_change (idempotency_key, subscription_id, path, request) VALUES ($1, $2, $3, $4)",
            key, subscription.as_str(), path, request,
        ).execute(&self.pool).await.map_err(|error| CustomerError::StorageLayerError(error.into()))?;
        self.submit_item_change(
            key,
            ItemChange {
                subscription_id: subscription.to_string(),
                path,
                request,
                outcome: ItemChangeOutcome::Pending,
            },
        )
        .await
    }

    /// End an item change whose outcome stayed unknown. Under the
    /// subscription guard, a pending change is applied iff the provider
    /// object carries its marker; otherwise it is abandoned for good. With no
    /// receipt, an abandoned one is written on `fence`, so a send that has
    /// not taken the guard yet finds it and never charges.
    #[tracing::instrument(skip(self), err)]
    pub(super) async fn settle_item_change(
        &self,
        key: &str,
        fence: Option<&stripe::SubscriptionId>,
    ) -> Result<ItemChangeSettlement, CustomerError> {
        let subscription = match self.item_change(key).await? {
            Some(change) if change.outcome != ItemChangeOutcome::Pending => {
                return Ok(settlement(change.outcome));
            }
            Some(change) => change
                .subscription_id
                .parse()
                .map_err(|error| CustomerError::StorageLayerError(anyhow::Error::from(error)))?,
            None => match fence {
                Some(subscription) => subscription.clone(),
                // The receipt is written before the first attempt: none was made.
                None => return Ok(ItemChangeSettlement::NotApplied),
            },
        };
        let _billing = self.subscription_guard(&subscription, Some(key)).await?;
        match self.item_change(key).await? {
            Some(change) => Ok(settlement(self.settle_pending_locked(key, change).await?)),
            None => {
                sqlx::query!(
                    "INSERT INTO subscription_item_change (idempotency_key, subscription_id, path, request, outcome) VALUES ($1, $2, $3, '{}', 'abandoned')",
                    key,
                    subscription.as_str(),
                    format!("/subscriptions/{subscription}"),
                )
                .execute(&self.pool)
                .await
                .map_err(|error| CustomerError::StorageLayerError(error.into()))?;
                Ok(ItemChangeSettlement::NotApplied)
            }
        }
    }

    /// Called while holding the subscription guard, so nothing of ours is
    /// still sending `change`: a pending change is applied iff the provider
    /// object carries its marker, and abandoned otherwise.
    pub(super) async fn settle_pending_locked(
        &self,
        key: &str,
        change: ItemChange,
    ) -> Result<ItemChangeOutcome, CustomerError> {
        if change.outcome != ItemChangeOutcome::Pending {
            return Ok(change.outcome);
        }
        let current = self
            .client
            .get::<serde_json::Value>(&change.path)
            .await
            .map_err(storage)?;
        let applied = current
            .get("metadata")
            .and_then(|metadata| metadata.get(ITEM_CHANGE_KEY))
            .and_then(serde_json::Value::as_str)
            == Some(key);
        let outcome = if applied {
            ItemChangeOutcome::Succeeded
        } else {
            ItemChangeOutcome::Abandoned
        };
        tracing::info!(
            idempotency_key = key,
            applied,
            "settled an unresolved item change"
        );
        self.finish_item_change(key, outcome).await?;
        Ok(outcome)
    }

    /// Called while holding the subscription guard, for a pending change
    /// sent less than [`super::billing::PENDING_SETTLE_AFTER`] ago whose
    /// sender let go of the guard. Its first request may still be running at
    /// the provider, so marking it abandoned now could miss a change that
    /// lands later. Instead the exact stored request is sent again under the
    /// same `Idempotency-Key`, which the provider runs at most once: a
    /// finished first request answers with its saved result, one still
    /// running answers 409, and one that never arrived runs now. Only a
    /// definite outcome lets the caller go ahead; anything else is
    /// [`CustomerError::ItemChangeInFlight`], as before.
    pub(super) async fn finish_in_flight_locked(
        &self,
        key: &str,
        change: ItemChange,
    ) -> Result<(), CustomerError> {
        match self.replay_item_change_locked(key, change).await {
            // A decline is recorded on the receipt: that change is over.
            Ok(()) | Err(CustomerError::PaymentFailed) => {
                tracing::info!(
                    idempotency_key = key,
                    "finished an item change its sender left in flight"
                );
                Ok(())
            }
            Err(error) => {
                tracing::info!(idempotency_key = key, error = ?error,
                    "an item change is still in flight; refusing for now");
                Err(CustomerError::ItemChangeInFlight)
            }
        }
    }

    /// Where the change keyed `key` stands; `None` when it was never sent.
    pub(super) async fn item_change_status(
        &self,
        key: &str,
    ) -> Result<Option<ItemChangeStatus>, CustomerError> {
        Ok(self
            .item_change(key)
            .await?
            .map(|change| match change.outcome {
                ItemChangeOutcome::Pending => ItemChangeStatus::Pending,
                ItemChangeOutcome::Succeeded => ItemChangeStatus::Applied,
                ItemChangeOutcome::PaymentFailed | ItemChangeOutcome::Abandoned => {
                    ItemChangeStatus::NotApplied
                }
            }))
    }

    #[tracing::instrument(skip(self), err)]
    pub(super) async fn replay_item_change(&self, key: &str) -> Result<bool, CustomerError> {
        let Some(change) = self.item_change(key).await? else {
            return Ok(false);
        };
        if change.outcome != ItemChangeOutcome::Pending {
            self.submit_item_change(key, change).await?;
            return Ok(true);
        }
        let subscription = change
            .subscription_id
            .parse()
            .map_err(|error| CustomerError::StorageLayerError(anyhow::Error::from(error)))?;
        let _billing = self.subscription_guard(&subscription, Some(key)).await?;
        // Another replay may have finished while this call waited for the guard.
        let change = self
            .item_change(key)
            .await?
            .context("item change receipt disappeared")?;
        self.replay_item_change_locked(key, change).await?;
        Ok(true)
    }
}

fn settlement(outcome: ItemChangeOutcome) -> ItemChangeSettlement {
    match outcome {
        ItemChangeOutcome::Succeeded => ItemChangeSettlement::Applied,
        ItemChangeOutcome::Pending
        | ItemChangeOutcome::PaymentFailed
        | ItemChangeOutcome::Abandoned => ItemChangeSettlement::NotApplied,
    }
}
