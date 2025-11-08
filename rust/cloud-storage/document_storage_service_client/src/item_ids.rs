use crate::DocumentStorageServiceClient;
use crate::constants::MACRO_INTERNAL_USER_ID_HEADER_KEY;
use model::{
    document_storage_service_internal::{
        GetItemIDsResponse, ValidateItemIDsRequest, ValidateItemIDsResponse,
    },
    item::{ShareableItem, UserAccessibleItem},
};

impl DocumentStorageServiceClient {
    /// Gets the ids of the items the user has access to
    #[tracing::instrument(skip(self), err)]
    pub async fn get_user_accessible_item_ids(
        &self,
        user_id: &str,
        item_type: Option<String>,
        exclude_owned: Option<bool>,
    ) -> anyhow::Result<GetItemIDsResponse> {
        let mut req = self
            .client
            .get(format!("{}/internal/item_ids", self.url))
            .header(MACRO_INTERNAL_USER_ID_HEADER_KEY, user_id);

        // Add query parameters if provided
        if let Some(item_type) = &item_type {
            req = req.query(&[("item_type", item_type)]);
        }

        if let Some(exclude_owned) = exclude_owned {
            req = req.query(&[("exclude_owned", exclude_owned.to_string())]);
        }

        let res = req.send().await?.error_for_status()?;

        let response = res.json::<GetItemIDsResponse>().await?;

        Ok(response)
    }

    /// Validates the list of item to see if the user has access to
    #[tracing::instrument(skip(self), err)]
    pub async fn validate_user_accessible_item_ids(
        &self,
        user_id: &str,
        items: Vec<ShareableItem>,
    ) -> anyhow::Result<Vec<UserAccessibleItem>> {
        let res = self
            .client
            .post(format!("{}/internal/validate_item_ids", self.url))
            .header(MACRO_INTERNAL_USER_ID_HEADER_KEY, user_id)
            .json(&ValidateItemIDsRequest { items })
            .send()
            .await?
            .error_for_status()?;

        let response = res.json::<ValidateItemIDsResponse>().await?;

        Ok(response.items)
    }
}
