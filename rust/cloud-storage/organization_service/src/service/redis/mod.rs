mod add_user_permission;
mod update_user_permissions;

#[derive(Clone)]
pub struct Redis {
    inner: redis::Client,
}

// Key prefixes
impl Redis {
    pub fn new(inner: redis::Client) -> Self {
        Self { inner }
    }

    #[tracing::instrument(skip(self))]
    pub async fn add_user_permission(&self, user_id: &str, permission: &str) -> anyhow::Result<()> {
        add_user_permission::add_user_permission(&self.inner, user_id, permission).await
    }

    pub async fn update_user_permissions(
        &self,
        user_id: &str,
        permissions: &str,
    ) -> anyhow::Result<()> {
        update_user_permissions::update_user_permissions(&self.inner, user_id, permissions).await
    }
}
