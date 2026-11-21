//! The agent's OpenAPI document.

use utoipa::OpenApi;

/// Every route of [`super::axum_router`].
#[derive(OpenApi)]
#[openapi(
    info(title = "Firecracker host agent", description = "Macro computers on Firecracker hosts."),
    paths(
        super::axum_router::host,
        super::axum_router::set_host_limits,
        super::axum_router::goldens,
        super::axum_router::build_golden,
        super::axum_router::list,
        super::axum_router::computer,
        super::axum_router::create,
        super::axum_router::destroy,
        super::axum_router::set_enrollment,
        super::axum_router::clear_enrollment,
        super::axum_router::power,
        super::axum_router::exec,
        super::moves::replication,
        super::moves::replicate,
        super::moves::release,
        super::moves::move_holding,
        super::moves::expect,
        super::moves::drop_staged,
        super::moves::adopt,
    ),
    tags(
        (name = "host", description = "The host"),
        (name = "goldens", description = "Golden snapshots"),
        (name = "computers", description = "Computers"),
        (name = "moves", description = "Moving computers between hosts"),
    )
)]
pub struct ApiDoc;
