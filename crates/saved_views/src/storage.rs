use serde::{Deserialize, Serialize};
use std::future::Future;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{ExcludedDefaultView, View};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ViewPatch {
    pub name: Option<String>,
    pub config: Option<serde_json::Value>,
}

pub trait ViewStorage {
    type Err;
    /// Get a view by it's id
    fn get_view(&self, id: Uuid) -> impl Future<Output = Result<View, Self::Err>> + Send;
    /// Create a new view
    fn create_view(&self, view: &View) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Get all views for a user
    fn get_views_for_user(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<View>, Self::Err>> + Send;
    /// Patch a view
    fn patch_view(
        &self,
        id: Uuid,
        patch: ViewPatch,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Delete a view
    fn delete_view(&self, id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;
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
