use super::user_insight;
use super::user_insight::{
    CreateInsightsRequest, GetUserInsightsParams, GetUserInsightsResponse, IdList,
    UpdateInsightRequest,
};

use model::insight_context::UserInsightRecord;

use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(terms_of_service = "https://macro.com/terms",),
    paths(
        user_insight::handle_create_insights,
        user_insight::handle_delete_user_insights,
        user_insight::handle_get_user_insights,
        user_insight::handle_update_user_insight
    ),
    components(schemas(GetUserInsightsParams, UpdateInsightRequest, UserInsightRecord, GetUserInsightsResponse, IdList, CreateInsightsRequest)),
    tags(
      (name = "macro insight service", description = "Insight Service")
    )
)]
pub struct ApiDoc;
