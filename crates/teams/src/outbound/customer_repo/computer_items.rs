//! Per-computer subscription items: each computer bills one item at a price
//! of its own (a subscription cannot hold two items of one price), carrying
//! its `computer_id` in metadata, so items are matched by computer, never by
//! price or count.

use super::*;

#[cfg(test)]
mod test;

/// The `computer_id` metadata key on a computer's item and price.
/// The metadata key naming the computer a subscription item bills.
pub const COMPUTER_ID_KEY: &str = "computer_id";
/// Subscription items read per page.
const ITEM_PAGE: u64 = 100;

/// The one item of an item change that is a computer's own.
#[derive(Debug, Clone, Copy)]
pub(super) struct ComputerItem<'a> {
    pub(super) price_id: &'a stripe::PriceId,
    pub(super) computer_id: &'a str,
}

/// A computer's own price, copied from the catalog price it was bought at.
#[derive(serde::Serialize)]
struct ComputerPrice<'a> {
    currency: stripe::Currency,
    product: String,
    unit_amount: i64,
    recurring: ComputerPriceRecurring,
    #[serde(skip_serializing_if = "Option::is_none")]
    tax_behavior: Option<stripe::PriceTaxBehavior>,
    #[serde(skip_serializing_if = "Option::is_none")]
    nickname: Option<String>,
    metadata: HashMap<&'a str, &'a str>,
}

#[derive(serde::Serialize)]
struct ComputerPriceRecurring {
    interval: stripe::RecurringInterval,
    interval_count: u64,
}

/// The computer a subscription item bills: its own metadata's, else its
/// price's. Purchase and the billing webhook's reconcile both read it here.
pub fn item_computer_id(item: &stripe::SubscriptionItem) -> Option<&str> {
    let on_item = item
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get(COMPUTER_ID_KEY));
    let on_price = item
        .price
        .as_ref()
        .and_then(|price| price.metadata.as_ref())
        .and_then(|metadata| metadata.get(COMPUTER_ID_KEY));
    on_item.or(on_price).map(String::as_str)
}

/// The computer a subscription item bills, as a uuid. A malformed id is
/// logged and read as none, so the item counts as an ordinary line.
pub fn item_computer_uuid(item: &stripe::SubscriptionItem) -> Option<uuid::Uuid> {
    let id = item_computer_id(item)?;
    uuid::Uuid::parse_str(id)
        .inspect_err(|_| {
            tracing::warn!(subscription_item = %item.id, "subscription item has an invalid computer id");
        })
        .ok()
}

/// Every item on a subscription, read a page at a time.
pub async fn list_subscription_items(
    client: &stripe::Client,
    subscription_id: &stripe::SubscriptionId,
) -> Result<Vec<stripe::SubscriptionItem>, stripe::StripeError> {
    let mut params = stripe::ListSubscriptionItems::new(subscription_id.clone());
    params.limit = Some(ITEM_PAGE);
    let mut items = Vec::new();
    loop {
        let page = stripe::SubscriptionItem::list(client, &params).await?;
        if !page.has_more {
            items.extend(page.data);
            return Ok(items);
        }
        // More to read needs a cursor; an empty page has none to give.
        let Some(last) = page.data.last() else {
            return Err(stripe::StripeError::ClientError(
                "missing subscription item cursor".to_owned(),
            ));
        };
        params.starting_after = Some(last.id.clone());
        items.extend(page.data);
    }
}

impl CustomerRepositoryImpl {
    /// Apply `changes` in one update under the subscription guard, replaying
    /// an earlier attempt with the same key. `computer_item` marks the new
    /// item of a computer's own price with its computer id.
    pub(super) async fn apply_item_changes(
        &self,
        subscription_id: &stripe::SubscriptionId,
        changes: Vec<ItemQuantityChange>,
        computer_item: Option<ComputerItem<'_>>,
        proration: ItemProration,
        idempotency_key: &str,
    ) -> Result<(), CustomerError> {
        let _billing = self
            .subscription_guard(subscription_id, Some(idempotency_key))
            .await?;
        if let Some(change) = self.item_change(idempotency_key).await? {
            return self
                .replay_item_change_locked(idempotency_key, change)
                .await;
        }
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(storage)?;
        if subscription
            .metadata
            .get(ITEM_CHANGE_KEY)
            .map(String::as_str)
            == Some(idempotency_key)
        {
            tracing::info!("item change already applied");
            return Ok(());
        }
        let mut items = item_quantity_updates(&subscription, &changes)?;
        if items.is_empty() {
            return Ok(());
        }
        if let Some(computer) = computer_item
            && let Some(update) = items
                .iter_mut()
                .find(|update| update.price.as_deref() == Some(computer.price_id.as_str()))
        {
            update.metadata = Some(HashMap::from([(
                COMPUTER_ID_KEY.to_owned(),
                computer.computer_id.to_owned(),
            )]));
        }
        let adds = changes.iter().any(|change| change.delta > 0);
        let billable = match subscription.status {
            stripe::SubscriptionStatus::Active => true,
            // Computers are for paying teams; removing a trial's item is fine.
            stripe::SubscriptionStatus::Trialing if adds && computer_item.is_some() => {
                return Err(CustomerError::SubscriptionTrialing);
            }
            stripe::SubscriptionStatus::Trialing => true,
            // Removing items from a subscription behind on payment still
            // stops what it bills; adding to one is refused.
            stripe::SubscriptionStatus::PastDue | stripe::SubscriptionStatus::Unpaid => !adds,
            _ => false,
        };
        if !billable {
            return Err(CustomerError::SubscriptionNotActive);
        }
        self.update_retrieved_items(
            subscription,
            items,
            ItemUpdateOptions {
                idempotency_key: Some(idempotency_key),
                error_if_incomplete: true,
                proration,
            },
        )
        .await
    }

    pub(super) async fn create_computer_price(
        &self,
        base: &stripe::PriceId,
        computer_id: &str,
        idempotency_key: &str,
    ) -> Result<stripe::PriceId, CustomerError> {
        let base = stripe::Price::retrieve(&self.client, base, &[])
            .await
            .map_err(storage)?;
        let recurring = base
            .recurring
            .as_ref()
            .ok_or(SubscriptionDataError::MissingRecurringItem)?;
        let form = ComputerPrice {
            currency: base
                .currency
                .ok_or(SubscriptionDataError::MissingCurrency)?,
            product: base
                .product
                .as_ref()
                .map(|product| product.id().to_string())
                .ok_or_else(|| {
                    SubscriptionDataError::Internal(rootcause::report!("price has no product"))
                })?,
            unit_amount: base
                .unit_amount
                .ok_or(SubscriptionDataError::MissingUnitAmount)?,
            recurring: ComputerPriceRecurring {
                interval: recurring.interval,
                interval_count: recurring.interval_count,
            },
            tax_behavior: base.tax_behavior,
            nickname: base.nickname.clone(),
            metadata: HashMap::from([(COMPUTER_ID_KEY, computer_id)]),
        };
        let client =
            self.client
                .as_ref()
                .clone()
                .with_strategy(stripe::RequestStrategy::Idempotent(
                    idempotency_key.to_owned(),
                ));
        let price = client
            .post_form::<stripe::Price, _>("/prices", &form)
            .await
            .map_err(storage)?;
        Ok(price.id)
    }

    pub(super) async fn remove_subscription_item(
        &self,
        subscription_id: &stripe::SubscriptionId,
        item_id: &stripe::SubscriptionItemId,
        idempotency_key: &str,
    ) -> Result<ItemRemoval, CustomerError> {
        let _billing = self
            .subscription_guard(subscription_id, Some(idempotency_key))
            .await?;
        if let Some(change) = self.item_change(idempotency_key).await? {
            self.replay_item_change_locked(idempotency_key, change)
                .await?;
            return Ok(ItemRemoval::Removed);
        }
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(storage)?;
        if subscription
            .metadata
            .get(ITEM_CHANGE_KEY)
            .map(String::as_str)
            == Some(idempotency_key)
        {
            return Ok(ItemRemoval::Removed);
        }
        if matches!(
            subscription.status,
            stripe::SubscriptionStatus::Canceled | stripe::SubscriptionStatus::IncompleteExpired
        ) {
            return Ok(ItemRemoval::AlreadyGone);
        }
        let items = self.subscription_items(subscription_id).await?;
        let Some(removed) = items.into_iter().find(|item| &item.id == item_id) else {
            return Ok(ItemRemoval::AlreadyGone);
        };
        self.update_retrieved_items(
            subscription,
            vec![UpdateSubscriptionItems {
                id: Some(item_id.to_string()),
                deleted: Some(true),
                ..Default::default()
            }],
            ItemUpdateOptions {
                idempotency_key: Some(idempotency_key),
                error_if_incomplete: false,
                proration: ItemProration::NoProration,
            },
        )
        .await?;
        if removed.computer_id.is_some() {
            self.archive_computer_price(&removed.price_id).await;
        }
        Ok(ItemRemoval::Removed)
    }

    /// A computer's own price bills nothing once its item is gone; archive
    /// it so the catalog does not grow with every computer. Best effort: an
    /// active price with no item costs nothing.
    async fn archive_computer_price(&self, price_id: &stripe::PriceId) {
        #[derive(serde::Serialize)]
        struct Archive {
            active: bool,
        }
        if let Err(error) = self
            .client
            .post_form::<stripe::Price, _>(
                &format!("/prices/{price_id}"),
                &Archive { active: false },
            )
            .await
        {
            tracing::warn!(price_id = %price_id, error = ?error, "could not archive a computer's price");
        }
    }

    pub(super) async fn subscription_items(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> Result<Vec<SubscriptionItemView>, CustomerError> {
        let items = list_subscription_items(&self.client, subscription_id)
            .await
            .map_err(storage)?;
        items
            .iter()
            .map(|item| {
                let Some(price) = &item.price else {
                    return Err(SubscriptionDataError::Internal(rootcause::report!(
                        "subscription item has no price"
                    ))
                    .into());
                };
                Ok(SubscriptionItemView {
                    id: item.id.clone(),
                    price_id: price.id.clone(),
                    quantity: item.quantity.unwrap_or(1),
                    computer_id: item_computer_id(item).map(str::to_owned),
                })
            })
            .collect()
    }
}
