//! A user's calendar: what the web app's calendar reads and writes.

#![expect(
    clippy::disallowed_methods,
    reason = "test support: the scenario's own reads are not checked against the query cache"
)]

use chrono::{DateTime, Duration, Utc};
use reqwest::Method;
use rootcause::prelude::*;
use serde_json::Value;
use sqlx::PgPool;

use crate::api::{ApiClient, ApiResponse};
use crate::wait::{DEFAULT_TIMEOUT, eventually};

/// How far back [`Calendar::occurrences`] looks. The read route answers at
/// most 370 days at once.
const DAYS_BACK: i64 = 60;
/// How far ahead [`Calendar::occurrences`] looks.
const DAYS_AHEAD: i64 = 300;
/// The most occurrences one page of the read route carries.
const PAGE_SIZE: u16 = 2000;
/// The account state that means the last sync finished.
const READY: &str = "ready";

/// The calendar of one Macro user, across their inboxes.
///
/// Changes go to `calendar_service` at the address the gateway gives it
/// (`/calendar/...`); reads go to the routes `document_storage_service` hosts
/// (`/calendar-events...`). Both take the user's identity the way the email
/// API does.
#[derive(Clone)]
pub struct Calendar {
    service: ApiClient,
    reads: ApiClient,
    db: PgPool,
}

impl Calendar {
    pub(crate) fn new(service: ApiClient, reads: ApiClient, db: PgPool) -> Self {
        Self { service, reads, db }
    }

    /// Any request to `calendar_service` as the user, through the gateway's
    /// `/calendar` prefix: `path` is the route, such as `/events`.
    pub async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<ApiResponse, Report> {
        self.service.request(method, path, None, body).await
    }

    /// `GET path` at `calendar_service`.
    pub async fn get(&self, path: &str) -> Result<ApiResponse, Report> {
        self.request(Method::GET, path, None).await
    }

    /// `POST path` at `calendar_service`.
    pub async fn post(&self, path: &str, body: &Value) -> Result<ApiResponse, Report> {
        self.request(Method::POST, path, Some(body)).await
    }

    /// `PUT path` at `calendar_service`.
    pub async fn put(&self, path: &str, body: &Value) -> Result<ApiResponse, Report> {
        self.request(Method::PUT, path, Some(body)).await
    }

    /// `PATCH path` at `calendar_service`.
    pub async fn patch(&self, path: &str, body: &Value) -> Result<ApiResponse, Report> {
        self.request(Method::PATCH, path, Some(body)).await
    }

    /// `DELETE path` at `calendar_service`.
    pub async fn delete(&self, path: &str) -> Result<ApiResponse, Report> {
        self.request(Method::DELETE, path, None).await
    }

    /// Any request to the calendar read routes as the user: `path` starts
    /// with `/calendar-events`.
    pub async fn read(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<ApiResponse, Report> {
        self.reads.request(method, path, None, body).await
    }

    /// Every occurrence on the user's calendars from 60 days ago to 300
    /// days ahead, as the calendar view lists them: each item holds the
    /// `event` and its `occurrence`.
    pub async fn occurrences(&self) -> Result<Vec<Value>, Report> {
        let now = Utc::now();
        self.occurrences_between(
            now - Duration::days(DAYS_BACK),
            now + Duration::days(DAYS_AHEAD),
        )
        .await
    }

    /// Every occurrence that overlaps `start..end`.
    pub async fn occurrences_between(
        &self,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<Value>, Report> {
        let window = format!(
            "start={}&end={}&limit={PAGE_SIZE}",
            urlencoding::encode(&start.to_rfc3339()),
            urlencoding::encode(&end.to_rfc3339()),
        );
        let mut items = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let page = match &cursor {
                Some(cursor) => format!(
                    "/calendar-events?{window}&cursor={}",
                    urlencoding::encode(cursor)
                ),
                None => format!("/calendar-events?{window}"),
            };
            let mut listed = self.read(Method::GET, &page, None).await?.ok()?;
            if let Some(page_items) = listed["items"].as_array_mut() {
                items.append(page_items);
            }
            match listed["nextCursor"].as_str() {
                Some(next) if listed["hasMore"] == true => cursor = Some(next.to_owned()),
                _ => return Ok(items),
            }
        }
    }

    /// The occurrences of the events titled `title`.
    pub async fn occurrences_titled(&self, title: &str) -> Result<Vec<Value>, Report> {
        let mut items = self.occurrences().await?;
        items.retain(|item| item["event"]["title"] == title);
        Ok(items)
    }

    /// Waits until the user's occurrences satisfy `condition` and returns
    /// them. `what` completes "timed out waiting for …".
    pub async fn wait_for_occurrences(
        &self,
        what: &str,
        condition: impl Fn(&[Value]) -> bool,
    ) -> Result<Vec<Value>, Report> {
        let mut last_seen = String::new();
        let waited = eventually(what, DEFAULT_TIMEOUT, async || {
            let items = self.occurrences().await?;
            last_seen = summary(&items);
            Ok(condition(&items).then_some(items))
        })
        .await;
        waited.map_err(|report| report.attach(format!("last seen: {last_seen}")))
    }

    /// Waits until an event titled `title` is on the calendar and returns its
    /// first occurrence's item (`event` and `occurrence`).
    pub async fn wait_for_event(&self, title: &str) -> Result<Value, Report> {
        let items = self
            .wait_for_occurrences(
                &format!("the event `{title}` to be on the calendar"),
                |items| items.iter().any(|item| item["event"]["title"] == title),
            )
            .await?;
        items
            .into_iter()
            .find(|item| item["event"]["title"] == title)
            .ok_or_else(|| report!("the event `{title}` vanished while it was being read"))
    }

    /// Waits until no event titled `title` is on the calendar.
    pub async fn wait_until_gone(&self, title: &str) -> Result<(), Report> {
        self.wait_for_occurrences(
            &format!("the event `{title}` to leave the calendar"),
            |items| !items.iter().any(|item| item["event"]["title"] == title),
        )
        .await
        .map(drop)
    }

    /// Waits until the calendar account of the inbox `address` has finished
    /// a sync: its first import, or the one a change at the provider started.
    pub async fn wait_until_synced(&self, address: &str) -> Result<(), Report> {
        let mut last_seen = String::new();
        let waited = eventually(
            &format!("the calendar of {address} to finish syncing"),
            DEFAULT_TIMEOUT,
            async || {
                let account: Option<(String, Option<String>)> = sqlx::query_as(
                    "SELECT sync_status, last_sync_error FROM calendar_accounts \
                     WHERE lower(provider_account_id) = lower($1)",
                )
                .bind(address)
                .fetch_optional(&self.db)
                .await
                .context("could not read the calendar account")?;
                last_seen = format!("{account:?}");
                Ok(account
                    .is_some_and(|(status, _)| status == READY)
                    .then_some(()))
            },
        )
        .await;
        waited.map_err(|report| report.attach(format!("last seen account: {last_seen}")))
    }

    /// Makes every Outlook calendar of the inbox `address` due for its next
    /// poll now. Outlook has no calendar push: the service polls each
    /// calendar every two minutes, and a scenario stands in for that clock.
    pub async fn poll_outlook_now(&self, address: &str) -> Result<(), Report> {
        sqlx::query(
            "UPDATE calendar_outlook_work work SET next_run_at = now() \
             FROM calendar_accounts account \
             WHERE account.id = work.account_id \
               AND lower(account.provider_account_id) = lower($1)",
        )
        .bind(address)
        .execute(&self.db)
        .await
        .context("could not make the Outlook calendars due")?;
        Ok(())
    }
}

/// What a wait saw last: each occurrence's title, start and status.
fn summary(items: &[Value]) -> String {
    items
        .iter()
        .map(|item| {
            format!(
                "{} @ {} ({})",
                item["event"]["title"], item["occurrence"]["time"], item["event"]["status"]
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}
