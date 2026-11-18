//! Inbound adapters for the CRM domain.

#[cfg(feature = "axum")]
pub mod axum_extractors;
#[cfg(feature = "axum")]
pub mod axum_router;
#[cfg(feature = "call_link")]
pub mod call_archived;
#[cfg(feature = "ai_tools")]
pub mod toolset;

/// `GET /crm/companies`, the `ListCompanies` listing over HTTP.
#[cfg(all(feature = "axum", feature = "ai_tools"))]
pub mod company_list;

/// Pipeline routes.
#[cfg(feature = "axum")]
pub mod pipelines;

/// Pipeline entry, field and CSV routes addressed by name.
#[cfg(feature = "axum")]
pub mod pipeline_workflows;
