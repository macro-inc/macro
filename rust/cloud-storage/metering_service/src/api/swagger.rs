use crate::api::{health::HealthResponse, usage::*};
use metering_db_client::{CreateUsageRecordRequest, Usage, UsageQuery, UsageReport};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::api::health::health,
        crate::api::usage::create_usage_record,
        crate::api::usage::get_usage_records,
    ),
    components(
        schemas(
            HealthResponse,
            Usage,
            CreateUsageRecordRequest,
            UsageQuery,
            UsageQueryParams,
            UsageReport,
        )
    ),
    tags(
        (name = "health", description = "Health check endpoints"),
        (name = "usage", description = "Usage tracking and reporting endpoints")
    ),
    info(
        title = "Metering Service API",
        description = "API for tracking and reporting AI service usage metrics",
        version = "0.1.0"
    )
)]
#[derive(Debug)]
pub struct ApiDoc;
