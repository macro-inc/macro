use utoipa::ToSchema;

/// A user's preferred light/dark themes and whether the active theme should
/// follow the operating system's color scheme. Used by both the GET and PATCH
/// `/user/theme_preferences` endpoints.
#[derive(Default, Debug, Clone, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserThemePreferences {
    /// Id of the theme applied when the color scheme is light.
    pub preferred_light_theme: String,
    /// Id of the theme applied when the color scheme is dark.
    pub preferred_dark_theme: String,
    /// Whether the active theme should switch with the OS color scheme.
    pub theme_matches_system: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetUserInfo {
    /// The user id
    pub user_id: String,
    /// The user's organization id if there is one associated with the user
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization_id: Option<i32>,
    /// The user's permissions
    pub permissions: Vec<String>,
}
