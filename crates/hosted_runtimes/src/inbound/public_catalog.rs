//! Anonymous computer specifications from the compiled catalog.

use axum::{Json, Router, http::header, response::IntoResponse, routing::get};
use serde::Serialize;
use utoipa::ToSchema;

use crate::domain::size::{ComputerSize, current_catalog};

/// The current public computer catalog.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicComputerCatalog {
    /// Current versioned resource tiers, in catalog order.
    plans: Vec<PublicComputerPlan>,
    /// Whether public pricing is available.
    pricing: PublicComputerPricing,
}

/// The published specification for a computer tier.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicComputerPlan {
    /// The versioned identity of this specification.
    catalog_id: String,
    /// The computer size.
    size: ComputerSize,
    /// The display label from the computer size.
    label: &'static str,
    /// Virtual CPU count.
    vcpus: u32,
    /// Memory limit in GiB.
    memory_gib: u32,
    /// Total disk quota in GiB.
    disk_gib: u32,
}

/// Public pricing availability.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PublicComputerPricing {
    /// Amount, currency, and cadence are available through signed team offers.
    Unavailable,
}

/// Mount the public read independently of team billing state.
pub fn router<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new().route("/computers/catalog", get(list))
}

/// List current computer specifications for an anonymous visitor.
#[utoipa::path(
    get,
    path = "/computers/catalog",
    operation_id = "list_public_computer_catalog",
    responses((status = 200, body = PublicComputerCatalog))
)]
pub async fn list() -> impl IntoResponse {
    let plans = current_catalog()
        .into_iter()
        .map(|entry| PublicComputerPlan {
            catalog_id: entry.id.as_str().to_owned(),
            size: entry.size,
            label: entry.size.label(),
            vcpus: entry.resources.vcpus.get(),
            memory_gib: entry.resources.memory_gib.get(),
            disk_gib: entry.resources.disk_gib.get(),
        })
        .collect();

    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(PublicComputerCatalog {
            plans,
            pricing: PublicComputerPricing::Unavailable,
        }),
    )
}

#[cfg(test)]
mod test;
