use super::{OutlookApiClientRepository, transport::invalid_response, wire};
use crate::domain::{models::*, ports::MailboxSettingsClient};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

#[cfg(test)]
mod test;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rule {
    id: String,
    display_name: String,
    is_enabled: bool,
    #[serde(default)]
    has_error: bool,
    #[serde(default)]
    is_read_only: bool,
    conditions: Value,
    actions: Value,
    exceptions: Option<Value>,
}

fn absent(value: &Value) -> bool {
    value.is_null()
        || value == false
        || value.as_array().is_some_and(Vec::is_empty)
        || value.as_str().is_some_and(str::is_empty)
}
fn only_fields(value: &Value, allowed: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.iter().all(|(key, value)| {
            key.starts_with('@') || allowed.contains(&key.as_str()) || absent(value)
        })
    })
}
fn owned(rule: Rule) -> Option<OwnedSenderRule> {
    let correlation = rule
        .display_name
        .strip_prefix("Macro block ")?
        .parse()
        .ok()?;
    // Never claim a similarly named rule with additional predicates/actions,
    // exceptions, or unsupported provider content. That may be a user's edit.
    if rule.is_read_only
        || rule.has_error
        || !only_fields(&rule.conditions, &["fromAddresses"])
        || !only_fields(&rule.actions, &["delete", "stopProcessingRules"])
        || rule.actions.get("delete") != Some(&Value::Bool(true))
        || rule.actions.get("stopProcessingRules") != Some(&Value::Bool(true))
        || rule
            .exceptions
            .as_ref()
            .is_some_and(|v| !v.is_null() && !only_fields(v, &[]))
    {
        return None;
    }
    let addresses = rule.conditions.get("fromAddresses")?.as_array()?;
    if addresses.len() != 1 {
        return None;
    }
    let sender = addresses[0]
        .get("emailAddress")?
        .get("address")?
        .as_str()?
        .to_ascii_lowercase();
    Some(OwnedSenderRule {
        id: ProviderId::new(rule.id).ok()?,
        correlation,
        sender,
        enabled: rule.is_enabled,
    })
}

impl MailboxSettingsClient for OutlookApiClientRepository {
    async fn category_messages(
        &self,
        token: &AccessToken,
        name: &str,
    ) -> Result<Vec<CategoryMessage>, EmailApiError> {
        let mut url = self.endpoint(&["me", "messages"])?;
        url.query_pairs_mut()
            .append_pair(
                "$filter",
                &format!("categories/any(c:c eq '{}')", name.replace('\'', "''")),
            )
            .append_pair("$select", "id,categories")
            .append_pair("$top", "25");
        #[derive(Deserialize)]
        struct Message {
            id: String,
            #[serde(default)]
            categories: Vec<String>,
            #[serde(rename = "@odata.etag")]
            version: Option<String>,
        }
        let page: wire::Page<Message> = self.get(token, url).await?;
        // Re-read the first bounded batch after mutations. Advancing a skip-based
        // page while removing matches could otherwise skip remaining messages.
        page.value
            .into_iter()
            .map(|m| {
                Ok(CategoryMessage {
                    id: ProviderId::new(m.id)?,
                    categories: m.categories,
                    version: m.version,
                })
            })
            .collect()
    }

    async fn sender_rules(
        &self,
        token: &AccessToken,
    ) -> Result<Vec<OwnedSenderRule>, EmailApiError> {
        let mut url = self.endpoint(&["me", "mailFolders", "inbox", "messageRules"])?;
        let mut visited = std::collections::HashSet::new();
        let mut result = Vec::new();
        loop {
            if !visited.insert(url.as_str().to_owned()) {
                return Err(invalid_response());
            }
            let page: wire::Page<Rule> = self.get(token, url).await?;
            result.extend(page.value.into_iter().filter_map(owned));
            match page.next {
                Some(next) => url = self.continuation(&StreamToken::new(next))?,
                None => return Ok(result),
            }
        }
    }

    async fn create_sender_rule(
        &self,
        token: &AccessToken,
        correlation: Uuid,
        sender: &str,
    ) -> Result<ProviderId, EmailApiError> {
        let value: Value = self.request(token, Method::POST, self.endpoint(&["me", "mailFolders", "inbox", "messageRules"])?,
            Some(&json!({"displayName": format!("Macro block {correlation}"), "sequence": 1, "isEnabled": true,
                "conditions": {"fromAddresses": [{"emailAddress": {"address": sender}}]},
                "actions": {"delete": true, "stopProcessingRules": true}}))).await?
            .json().await.map_err(|_| invalid_response())?;
        ProviderId::new(
            value
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(invalid_response)?,
        )
    }

    async fn remove_sender_rule(
        &self,
        token: &AccessToken,
        id: &ProviderId,
    ) -> Result<(), EmailApiError> {
        match self
            .request(
                token,
                Method::DELETE,
                self.endpoint(&["me", "mailFolders", "inbox", "messageRules", id.as_str()])?,
                None,
            )
            .await
        {
            Ok(_) | Err(EmailApiError::NotFound) => Ok(()),
            Err(error) => Err(error),
        }
    }
}
