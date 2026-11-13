//! What a mailbox holds at the provider besides its messages: the labels
//! (Gmail) or categories (Outlook) a user made, read through the provider's
//! own API as another mail client would.

use rootcause::prelude::*;
use serde_json::Value;

use crate::{Inbox, Provider, Report, Stack};

impl Stack {
    /// The names of the labels the mailbox's owner made at the provider:
    /// Gmail's user labels, or Outlook's categories. System labels and
    /// folders are not among them.
    pub async fn provider_labels(&self, inbox: &Inbox) -> Result<Vec<String>, Report> {
        let (url, token) = match inbox.provider() {
            Provider::Gmail => (
                format!("{}/users/me/labels", self.gmail().gmail_url()),
                self.gmail().access_token(inbox.email())?,
            ),
            Provider::Outlook => (
                format!("{}/me/outlook/masterCategories", self.outlook().graph_url()),
                self.outlook().access_token(inbox.email())?,
            ),
        };
        let response = inbox
            .user()
            .http()
            .get(&url)
            .bearer_auth(token)
            .send()
            .await?;
        let status = response.status();
        let body: Value = response.json().await?;
        if !status.is_success() {
            bail!("the provider answered {status} for its labels: {body}");
        }
        let names = match inbox.provider() {
            Provider::Gmail => body["labels"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|label| label["type"] == "user")
                .filter_map(|label| label["name"].as_str().map(str::to_owned))
                .collect(),
            Provider::Outlook => body["value"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|category| category["displayName"].as_str().map(str::to_owned))
                .collect(),
        };
        Ok(names)
    }
}
