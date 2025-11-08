//! This module provides common extention traits for the [super::Environment] that may be usefull in your service

#[cfg(feature = "frontend_url")]
/// Provides the implementation to return the expected [url::Url] for the frontend javascript bundle
pub mod frontend_url;
