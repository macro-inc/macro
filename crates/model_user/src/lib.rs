use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[cfg(feature = "axum")]
pub mod axum_extractor;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct UserPermission {
    /// The role the permission is for
    pub role_id: String,
    /// The permission itself
    pub permission_id: String,
}

/// Used to store information about the user
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct UserContext {
    /// The user id
    pub user_id: String,
    /// The user's fusion auth id
    pub fusion_user_id: String,
    /// The permissions of the user
    pub permissions: Option<HashSet<String>>,
    /// The organization id of the user
    pub organization_id: Option<i32>,
}

impl Default for UserContext {
    fn default() -> Self {
        Self {
            user_id: "".to_string(),
            fusion_user_id: "".to_string(),
            permissions: None,
            organization_id: None,
        }
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct UserInfo {
    pub id: String,
    pub email: String,
    pub organization_id: Option<i32>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct UserInfoWithMacroUserId {
    pub id: String,
    pub email: String,
    pub organization_id: Option<i32>,
    pub macro_user_id: Option<uuid::Uuid>,
}

#[derive(Default, Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct UserProfilePicture {
    pub id: String,
    pub url: String,
    pub checksum: Option<String>,
}

#[derive(Default, Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct ProfilePictures {
    pub pictures: Vec<UserProfilePicture>,
}

#[derive(Default, Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct ProfilePictureQueryParams {
    pub url: String,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, utoipa::ToSchema)]
pub struct UserName {
    pub id: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

// HACK: the zod generator on the FE only likes objects, not arrays, so we build silly structs like these
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, utoipa::ToSchema, Default)]
pub struct UserNames {
    pub names: Vec<UserName>,
}

#[derive(serde::Deserialize, Debug, utoipa::IntoParams, utoipa::ToSchema)]
pub struct PutUserNameQueryParams {
    /// First Name of user
    pub first_name: Option<String>,
    /// Last Name of user
    pub last_name: Option<String>,
}
