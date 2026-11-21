//! The due date port, backed by the agent harness.
//!
//! The harness holds the model credentials this worker does not. It reads the
//! thread with `universal_input` and meters it against the owner as email focus
//! usage. The cognition service can't do this: it refuses free owners this model
//! and bills paid owners' allowances for work they never asked for.

use std::{sync::Arc, time::Duration};

use email::domain::focus::{DueDateExtractor, DueDateInput, ThreadDates};
use macro_authorization::{INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::{Client, Url, header::HeaderValue};
use rootcause::Report;
use universal_input::domain::temporal::thread_due_date::{
    DueDateUsage, ThreadDueDateRequest, ThreadDueDateResponse, ThreadMessage,
};
use uuid::Uuid;

use crate::{
    metrics::{FocusMetrics, Metric},
    outbound::metered::{Prices, UnlessDone, token_counts},
};

#[cfg(test)]
mod test;

/// The harness's internal due date route, under its service URL.
const ROUTE: &str = "universal_input/thread-due-date";
/// Inside the Focus service's own limit, so a slow harness reads as what it is.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

/// Asks the harness for the days a thread's mail names, acting as its owner,
/// and counts each ask, its failures, and the tokens and cost the harness reports.
pub struct HarnessDueDates {
    client: Client,
    url: Url,
    key: HeaderValue,
    metrics: FocusMetrics,
    prices: Arc<Prices>,
}

impl HarnessDueDates {
    /// Call the harness at `base` with the internal `key`. No retries or redirects:
    /// repeating a request can repeat provider usage.
    pub fn new(
        base: &str,
        key: &str,
        metrics: FocusMetrics,
        prices: Arc<Prices>,
    ) -> Result<Self, Report> {
        let url = Url::parse(&format!("{}/{ROUTE}", base.trim_end_matches('/')))?;
        let mut key = HeaderValue::from_str(key)?;
        key.set_sensitive(true);
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()?;
        Ok(Self {
            client,
            url,
            key,
            metrics,
            prices,
        })
    }

    /// Count what one read reports it took, without waiting on anything.
    fn count_usage(&self, usage: &DueDateUsage) {
        let amount = ai_usage::UsageAmount::Tokens {
            input: usage.input_tokens,
            output: usage.output_tokens,
            cache_read: usage.cache_read_tokens,
            cache_write: usage.cache_write_tokens,
        };
        if let Some((input, output)) = token_counts(amount) {
            self.metrics.add(Metric::DueDateInputTokens, input);
            self.metrics.add(Metric::DueDateOutputTokens, output);
        }
        if let Some(cost) = self.prices.cost(&usage.model, amount) {
            self.metrics.add(Metric::DueDateCostUsd, cost);
        }
    }
}

/// Without the URL, which needn't reach the logs.
fn request_failed(error: reqwest::Error) -> Report {
    rootcause::report!("the harness request failed: {}", error.without_url())
}

impl DueDateExtractor for HarnessDueDates {
    async fn dates(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_id: Uuid,
        input: &DueDateInput,
    ) -> Result<ThreadDates, Report> {
        self.metrics.add(Metric::DueDateCalls, 1.0);
        let outcome = UnlessDone::new(&self.metrics, Metric::DueDateFailures);
        let request = ThreadDueDateRequest {
            thread_id,
            subject: input.subject.clone(),
            messages: input
                .messages
                .iter()
                .map(|message| ThreadMessage {
                    written_on: message.written_on,
                    from_owner: message.from_owner,
                    text: message.text.clone(),
                })
                .collect(),
        };
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .client
            .post(self.url.clone())
            .headers(headers)
            .header(INTERNAL_API_KEY_HEADER, self.key.clone())
            .header(INTERNAL_MACRO_USER_ID_HEADER, owner.as_ref())
            .json(&request)
            .send()
            .await
            .map_err(request_failed)?;
        let status = response.status();
        if !status.is_success() {
            // The status alone: a response body can quote the mail.
            return Err(rootcause::report!("the harness answered {status}"));
        }
        let answer: ThreadDueDateResponse = response.json().await.map_err(request_failed)?;
        outcome.finish(None);
        if let Some(usage) = &answer.usage {
            self.count_usage(usage);
        }
        Ok(ThreadDates {
            due_on: answer.due_on,
            event_on: answer.event_on,
        })
    }
}
