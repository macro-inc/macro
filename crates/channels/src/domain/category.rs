//! Personal channel-category layout domain.

use std::{
    collections::{HashMap, HashSet},
    future::Future,
};

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Maximum number of categories in one personal layout.
pub const MAX_CATEGORIES: usize = 100;
/// Maximum number of explicitly placed channels in one personal layout.
pub const MAX_PLACEMENTS: usize = 1_000;
/// Maximum category name length, measured in Unicode scalar values.
pub const MAX_CATEGORY_NAME_CHARS: usize = 80;

/// A validated category name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelCategoryName(String);

impl ChannelCategoryName {
    /// Trim and validate a category name.
    pub fn parse(value: impl Into<String>) -> Result<Self, ChannelCategoryError> {
        let value = value.into();
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(ChannelCategoryError::Invalid(
                "category name must not be blank".into(),
            ));
        }
        if trimmed.chars().count() > MAX_CATEGORY_NAME_CHARS {
            return Err(ChannelCategoryError::Invalid(format!(
                "category name must be at most {MAX_CATEGORY_NAME_CHARS} characters"
            )));
        }
        Ok(Self(trimmed.to_owned()))
    }

    /// Return the validated name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A personal channel category.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelCategory {
    /// Client-stable category id.
    pub id: Uuid,
    /// Display name.
    pub name: String,
}

/// A channel's explicit place in the personal layout.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelPlacement {
    /// Joined, non-DM channel id.
    pub channel_id: Uuid,
    /// Category id, or `None` for Uncategorized.
    pub category_id: Option<Uuid>,
}

/// Complete bounded personal channel layout.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelCategoryLayout {
    /// Monotonic optimistic-concurrency revision. New layouts start at zero.
    pub revision: i64,
    /// Categories in display order.
    pub categories: Vec<ChannelCategory>,
    /// Explicit channel placements in display order within each category.
    pub placements: Vec<ChannelPlacement>,
}

/// Category use-case errors.
#[derive(Debug, Error)]
pub enum ChannelCategoryError {
    /// Invalid or unauthorized layout input. A single variant avoids existence leaks.
    #[error("{0}")]
    Invalid(String),
    /// The supplied revision is older than the persisted layout.
    #[error("channel category layout changed; reload and try again")]
    Conflict,
    /// Persistence failed.
    #[error("channel category persistence failed")]
    Internal(#[source] anyhow::Error),
}

/// Persistence boundary for personal channel layouts.
pub trait ChannelCategoryRepo: Send + Sync + 'static {
    /// Repository error type.
    type Err: Into<anyhow::Error> + Send;

    /// Load the current user's layout, already intersected with channel visibility.
    fn get_layout(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<ChannelCategoryLayout, Self::Err>> + Send;

    /// Atomically validate channel membership and replace the current user's layout.
    fn replace_layout(
        &self,
        user_id: MacroUserIdStr<'_>,
        layout: ChannelCategoryLayout,
    ) -> impl Future<Output = Result<ReplaceLayoutOutcome, Self::Err>> + Send;
}

/// Result of an atomic compare-and-replace operation.
pub enum ReplaceLayoutOutcome {
    /// Layout was accepted and its revision incremented.
    Replaced(ChannelCategoryLayout),
    /// At least one channel was not available to the user.
    Unavailable,
    /// The caller supplied a stale revision.
    Conflict,
}

/// Category use cases exposed to inbound adapters.
pub trait ChannelCategoryService: Send + Sync + 'static {
    /// Load a personal layout.
    fn get_layout(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<ChannelCategoryLayout, ChannelCategoryError>> + Send;

    /// Validate and atomically replace a personal layout.
    fn replace_layout(
        &self,
        user_id: MacroUserIdStr<'_>,
        layout: ChannelCategoryLayout,
    ) -> impl Future<Output = Result<ChannelCategoryLayout, ChannelCategoryError>> + Send;
}

/// Category service backed by a repository port.
pub struct ChannelCategoryServiceImpl<R> {
    repo: R,
}

impl<R: ChannelCategoryRepo> ChannelCategoryServiceImpl<R> {
    /// Construct a category service.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R: ChannelCategoryRepo> ChannelCategoryService for ChannelCategoryServiceImpl<R> {
    #[tracing::instrument(err, skip(self))]
    async fn get_layout(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<ChannelCategoryLayout, ChannelCategoryError> {
        self.repo
            .get_layout(user_id)
            .await
            .map_err(|error| ChannelCategoryError::Internal(error.into()))
    }

    #[tracing::instrument(err, skip(self, layout))]
    async fn replace_layout(
        &self,
        user_id: MacroUserIdStr<'_>,
        mut layout: ChannelCategoryLayout,
    ) -> Result<ChannelCategoryLayout, ChannelCategoryError> {
        validate_layout(&mut layout)?;
        match self
            .repo
            .replace_layout(user_id, layout)
            .await
            .map_err(|error| ChannelCategoryError::Internal(error.into()))?
        {
            ReplaceLayoutOutcome::Replaced(layout) => Ok(layout),
            ReplaceLayoutOutcome::Unavailable => Err(ChannelCategoryError::Invalid(
                "layout contains an unavailable channel or category".into(),
            )),
            ReplaceLayoutOutcome::Conflict => Err(ChannelCategoryError::Conflict),
        }
    }
}

fn validate_layout(layout: &mut ChannelCategoryLayout) -> Result<(), ChannelCategoryError> {
    if layout.categories.len() > MAX_CATEGORIES {
        return Err(ChannelCategoryError::Invalid("too many categories".into()));
    }
    if layout.placements.len() > MAX_PLACEMENTS {
        return Err(ChannelCategoryError::Invalid(
            "too many channel placements".into(),
        ));
    }

    let mut category_ids = HashSet::with_capacity(layout.categories.len());
    for category in &mut layout.categories {
        if !category_ids.insert(category.id) {
            return Err(ChannelCategoryError::Invalid(
                "duplicate category id".into(),
            ));
        }
        category.name = ChannelCategoryName::parse(std::mem::take(&mut category.name))?.0;
    }

    let mut channel_ids = HashSet::with_capacity(layout.placements.len());
    for placement in &layout.placements {
        if !channel_ids.insert(placement.channel_id) {
            return Err(ChannelCategoryError::Invalid("duplicate channel id".into()));
        }
        if placement
            .category_id
            .is_some_and(|category_id| !category_ids.contains(&category_id))
        {
            return Err(ChannelCategoryError::Invalid("unknown category id".into()));
        }
    }
    let category_order: HashMap<Uuid, usize> = layout
        .categories
        .iter()
        .enumerate()
        .map(|(index, category)| (category.id, index))
        .collect();
    layout.placements.sort_by_key(|placement| {
        placement
            .category_id
            .and_then(|id| category_order.get(&id).copied())
            .unwrap_or(layout.categories.len())
    });
    Ok(())
}
