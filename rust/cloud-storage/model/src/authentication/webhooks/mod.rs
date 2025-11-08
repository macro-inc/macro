pub mod populate_jwt;
pub mod update_name;
pub mod update_profile_picture;

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FusionAuthUserWebhook {
    pub event: Event,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub create_instant: i64,
    pub id: String,
    pub linked_object_id: String,
    pub user: User,
    #[serde(rename = "type")]
    pub event_type: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct User {
    /// The user's id
    pub id: String,
    /// The user's email (primary user profile)
    pub email: String,
    /// Optional username
    pub username: Option<String>,
    /// If the user's email is verified
    pub verified: bool,
}
