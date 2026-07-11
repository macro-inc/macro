#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub struct UpsertProject {
    /// The project id
    pub project_id: String,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub index_override: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub struct RemoveProject {
    /// The project id to remove
    pub project_id: String,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub index_override: Option<String>,
}
