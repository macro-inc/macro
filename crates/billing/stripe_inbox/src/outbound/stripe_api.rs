//! The inbox's Stripe reads, as raw JSON (the translator reads every API
//! version), paced so the inbox never takes more than its share of Stripe's
//! rate limit.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use stripe::{CustomerId, EventId, SubscriptionId};
use tokio::sync::Mutex;
use tokio::time::Instant;

use crate::domain::ports::{Page, StripeReadError, StripeReader};

/// Objects per list page; Stripe's maximum.
const PAGE_SIZE: u64 = 100;

/// Spaces calls at least `interval` apart across every task sharing it.
#[derive(Debug)]
struct Pacer {
    interval: Duration,
    next: Mutex<Instant>,
}

impl Pacer {
    async fn wait(&self) {
        let slot = {
            let mut next = self.next.lock().await;
            let slot = (*next).max(Instant::now());
            *next = slot + self.interval;
            slot
        };
        tokio::time::sleep_until(slot).await;
    }
}

/// Stripe reads through `async-stripe`'s client, at most `per_second`.
#[derive(Clone)]
pub struct StripeApiReader {
    client: Arc<stripe::Client>,
    pacer: Arc<Pacer>,
}

impl StripeApiReader {
    /// Reads paced to `per_second` calls (at least one).
    pub fn new(client: Arc<stripe::Client>, per_second: u32) -> Self {
        Self {
            client,
            pacer: Arc::new(Pacer {
                interval: Duration::from_secs(1) / per_second.max(1),
                next: Mutex::new(Instant::now()),
            }),
        }
    }

    async fn get<Params: Serialize>(
        &self,
        operation: &'static str,
        path: &str,
        params: Params,
    ) -> Result<Value, StripeReadError> {
        self.pacer.wait().await;
        let span = tracing::info_span!("stripe.api", operation, outcome = tracing::field::Empty);
        let result = tracing::Instrument::instrument(
            self.client.get_query::<Value, Params>(path, params),
            span.clone(),
        )
        .await;
        match result {
            Ok(value) => {
                span.record("outcome", "ok");
                Ok(value)
            }
            Err(stripe::StripeError::Stripe(error)) if error.http_status == 429 => {
                span.record("outcome", "rate_limited");
                Err(StripeReadError::RateLimited)
            }
            Err(error) => {
                span.record("outcome", "error");
                Err(StripeReadError::Failed(
                    rootcause::Report::new(error).into_dynamic(),
                ))
            }
        }
    }

    /// Every page of a list, following `starting_after`.
    async fn every_page<Params: Serialize>(
        &self,
        operation: &'static str,
        path: &str,
        params: impl Fn(Option<String>) -> Params,
    ) -> Result<Vec<Value>, StripeReadError> {
        let mut objects = Vec::new();
        let mut starting_after = None;
        loop {
            let page = page(self.get(operation, path, params(starting_after)).await?)?;
            starting_after = page
                .data
                .last()
                .and_then(|object| object["id"].as_str())
                .map(str::to_owned);
            objects.extend(page.data);
            if !page.has_more || starting_after.is_none() {
                return Ok(objects);
            }
        }
    }
}

fn page(value: Value) -> Result<Page, StripeReadError> {
    let Value::Object(mut list) = value else {
        return Err(StripeReadError::Failed(rootcause::report!(
            "stripe list response is not an object"
        )));
    };
    let data = match list.remove("data") {
        Some(Value::Array(data)) => data,
        _ => Vec::new(),
    };
    Ok(Page {
        data,
        has_more: list
            .get("has_more")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

#[derive(Serialize)]
struct ListParams<'a> {
    limit: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    starting_after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    subscription: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    customer: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    created: Option<CreatedSince>,
}

#[derive(Serialize)]
struct CreatedSince {
    gte: i64,
}

impl ListParams<'_> {
    fn page(starting_after: Option<String>) -> Self {
        Self {
            limit: PAGE_SIZE,
            starting_after,
            subscription: None,
            customer: None,
            status: None,
            created: None,
        }
    }
}

#[derive(Serialize)]
struct NoParams {}

impl StripeReader for StripeApiReader {
    async fn retrieve_subscription(&self, id: &SubscriptionId) -> Result<Value, StripeReadError> {
        self.get(
            "retrieve_subscription",
            &format!("/subscriptions/{id}"),
            NoParams {},
        )
        .await
    }

    async fn subscription_items(&self, id: &SubscriptionId) -> Result<Vec<Value>, StripeReadError> {
        self.every_page("list_subscription_items", "/subscription_items", |after| {
            ListParams {
                subscription: Some(id.as_str()),
                ..ListParams::page(after)
            }
        })
        .await
    }

    async fn customer_subscriptions(
        &self,
        customer: &CustomerId,
    ) -> Result<Vec<Value>, StripeReadError> {
        self.every_page("list_customer_subscriptions", "/subscriptions", |after| {
            ListParams {
                customer: Some(customer.as_str()),
                status: Some("all"),
                ..ListParams::page(after)
            }
        })
        .await
    }

    async fn retrieve_customer(&self, customer: &CustomerId) -> Result<Value, StripeReadError> {
        self.get(
            "retrieve_customer",
            &format!("/customers/{customer}"),
            NoParams {},
        )
        .await
    }

    async fn events(
        &self,
        since: DateTime<Utc>,
        starting_after: Option<&EventId>,
    ) -> Result<Page, StripeReadError> {
        page(
            self.get(
                "list_events",
                "/events",
                ListParams {
                    created: Some(CreatedSince {
                        gte: since.timestamp(),
                    }),
                    ..ListParams::page(starting_after.map(ToString::to_string))
                },
            )
            .await?,
        )
    }

    async fn subscriptions(
        &self,
        starting_after: Option<&SubscriptionId>,
    ) -> Result<Page, StripeReadError> {
        page(
            self.get(
                "list_subscriptions",
                "/subscriptions",
                ListParams {
                    status: Some("all"),
                    ..ListParams::page(starting_after.map(ToString::to_string))
                },
            )
            .await?,
        )
    }
}
