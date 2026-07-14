use crate::DocumentStorageServiceClient;
use crate::constants::MACRO_INTERNAL_USER_ID_HEADER_KEY;
use model::thread::response::GetThreadUserAccessLevelResponse;
use models_permissions::share_permission::access_level::AccessLevel;

impl DocumentStorageServiceClient {
    #[tracing::instrument(skip(self), err)]
    pub async fn get_thread_access_level(
        &self,
        user_id: &str,
        thread_id: &str,
    ) -> anyhow::Result<AccessLevel> {
        let res = self
            .client
            .get(format!(
                "{}/internal/threads/{}/access_level",
                self.url, thread_id
            ))
            .header(MACRO_INTERNAL_USER_ID_HEADER_KEY, user_id)
            .send()
            .await?
            .error_for_status()?;

        let access_level_response = res.json::<GetThreadUserAccessLevelResponse>().await?;

        Ok(access_level_response.user_access_level)
    }
}
