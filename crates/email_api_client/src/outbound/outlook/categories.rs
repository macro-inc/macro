use super::{OutlookApiClientRepository, transport::invalid_response, wire};
use crate::domain::{
    models::{AccessToken, EmailApiError, StreamToken},
    ports::MailboxLabelClient,
};
use chrono::Utc;
use models_email::service::label::{Label, LabelListVisibility, LabelType, MessageListVisibility};
use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Category {
    id: String,
    display_name: String,
}

fn label(category: Category, link_id: Uuid) -> Label {
    // Graph message assignments identify categories by immutable displayName;
    // the catalog's resource ID is only used for catalog CRUD.
    Label {
        id: None,
        link_id,
        provider_label_id: category.display_name.clone(),
        name: Some(category.display_name),
        created_at: Utc::now(),
        message_list_visibility: Some(MessageListVisibility::Show),
        label_list_visibility: Some(LabelListVisibility::LabelShow),
        type_: Some(LabelType::User),
    }
}

impl MailboxLabelClient for OutlookApiClientRepository {
    async fn list_labels(
        &self,
        token: &AccessToken,
        link_id: Uuid,
    ) -> Result<Vec<Label>, EmailApiError> {
        let mut labels = Vec::new();
        let mut url = self.endpoint(&["me", "outlook", "masterCategories"])?;
        let mut visited = std::collections::HashSet::new();
        loop {
            if !visited.insert(url.as_str().to_owned()) {
                return Err(invalid_response());
            }
            let page: wire::Page<Category> = self.get(token, url).await?;
            labels.extend(
                page.value
                    .into_iter()
                    .map(|category| label(category, link_id)),
            );
            match page.next {
                Some(next) => url = self.continuation(&StreamToken::new(next))?,
                None => return Ok(labels),
            }
        }
    }

    async fn create_label(
        &self,
        token: &AccessToken,
        link_id: Uuid,
        name: &str,
    ) -> Result<Label, EmailApiError> {
        let response = self
            .request(
                token,
                Method::POST,
                self.endpoint(&["me", "outlook", "masterCategories"])?,
                Some(&json!({"displayName":name,"color":"none"})),
            )
            .await?;
        let category = response.json().await.map_err(|_| invalid_response())?;
        Ok(label(category, link_id))
    }

    async fn delete_label(&self, token: &AccessToken, name: &str) -> Result<(), EmailApiError> {
        let mut url = self.endpoint(&["me", "outlook", "masterCategories"])?;
        let mut visited = std::collections::HashSet::new();
        loop {
            if !visited.insert(url.as_str().to_owned()) {
                return Err(invalid_response());
            }
            let page: wire::Page<Category> = self.get(token, url).await?;
            if let Some(category) = page
                .value
                .into_iter()
                .find(|category| category.display_name == name)
            {
                return match self
                    .request(
                        token,
                        Method::DELETE,
                        self.endpoint(&["me", "outlook", "masterCategories", &category.id])?,
                        None,
                    )
                    .await
                {
                    Ok(_) | Err(EmailApiError::NotFound) => Ok(()),
                    Err(error) => Err(error),
                };
            }
            match page.next {
                Some(next) => url = self.continuation(&StreamToken::new(next))?,
                None => return Ok(()),
            }
        }
    }
}
