#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct UpdateProfilePictureWebhook {
    /// The email to get user information with
    pub email: String,
    /// The URL of the user's profile picture
    pub picture: String,
}
