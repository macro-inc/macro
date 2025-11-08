#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct ProjectMessage {
    /// The project id
    pub project_id: String,
    /// The macro user id of the user who owns this project
    pub macro_user_id: String,
}

#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct BulkRemoveProjectMessage {
    pub project_ids: Vec<String>,
}
