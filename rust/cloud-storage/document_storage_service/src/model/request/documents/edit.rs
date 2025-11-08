use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditDocumentRequestV2 {
    /// The name of the document
    pub document_name: Option<String>,
    /// The new project id of the document.
    /// This will also update the documents permissions to match the project it is going into
    pub project_id: Option<String>,
    /// Updated share permissions for the document.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
}
