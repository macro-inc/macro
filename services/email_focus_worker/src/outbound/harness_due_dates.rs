//! The due date port, backed by the agent harness.
//!
//! The harness holds the model credentials this worker does not. It reads the
//! thread with `universal_input` and meters it against the owner as email focus
//! usage. The cognition service can't do this: it refuses free owners this model
//! and bills paid owners' allowances for work they never asked for.

use std::time::Duration;

use chrono::NaiveDate;
use email::domain::focus::{DueDateExtractor, DueDateInput};
use macro_authorization::{INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::{Client, Url, header::HeaderValue};
use rootcause::Report;
use universal_input::domain::temporal::thread_due_date::{
    ThreadDueDateRequest, ThreadDueDateResponse, ThreadMessage,
};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The harness's internal due date route, under its service URL.
const ROUTE: &str = "universal_input/thread-due-date";
/// Inside the Focus service's own limit, so a slow harness reads as what it is.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

/// Asks the harness for the day a thread is due, acting as the thread's owner.
pub struct HarnessDueDates {
    client: Client,
    url: Url,
    key: HeaderValue,
}

impl HarnessDueDates {
    /// Call the harness at `base` with the internal `key`. No retries or redirects:
    /// repeating a request can repeat provider usage.
    pub fn new(base: &str, key: &str) -> Result<Self, Report> {
        let url = Url::parse(&format!("{}/{ROUTE}", base.trim_end_matches('/')))?;
        let mut key = HeaderValue::from_str(key)?;
        key.set_sensitive(true);
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()?;
        Ok(Self { client, url, key })
    }
}

/// Without the URL, which needn't reach the logs.
fn request_failed(error: reqwest::Error) -> Report {
    rootcause::report!("the harness request failed: {}", error.without_url())
}

impl DueDateExtractor for HarnessDueDates {
    async fn due_on(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_id: Uuid,
        input: &DueDateInput,
    ) -> Result<Option<NaiveDate>, Report> {
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
        Ok(answer.due_on)
    }
}
