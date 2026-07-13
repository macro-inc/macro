#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct UpdateNameWebhook {
    /// The email to get user information with
    pub email: String,
    /// First name of the user
    pub first_name: Option<String>,
    /// Last name of the user
    pub last_name: Option<String>,
}
