use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateBlankDocxRequest {
    //// Optional project id to be used to what project the document belongs to.
    pub project_id: Option<String>,
}
