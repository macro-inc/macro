use serde::{Deserialize, Serialize};
use std::future::Future;
use utoipa::ToSchema;

use crate::ExcludedDefaultView;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ViewPatch {
    pub name: Option<String>,
    pub config: Option<serde_json::Value>,
}

pub trait ExcludedDefaultViewStorage {
    type Err;
    /// Create a new view
    fn create_excluded_default_view(
        &self,
        view: ExcludedDefaultView,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Get all views for a user
    fn get_excluded_default_views_for_user(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<ExcludedDefaultView>, Self::Err>> + Send;
}
