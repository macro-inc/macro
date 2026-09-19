use utoipa::ToSchema;

use models_permissions::share_permission::access_level::AccessLevel;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct OrganizationDefaultSharePermission {
    /// If the item is publicly accessible by default
    pub is_public: bool,
    /// The access level for users if the item is publicly accessible
    pub public_access_level: Option<AccessLevel>,

    /// If the item is accessible by organization by default
    pub organization_access_enabled: bool,
    /// The access level for users if the item is accessible by organization
    pub organization_access_level: Option<AccessLevel>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct OrganizationSettings {
    /// The name of the organization
    pub name: String,
    /// The number of days an item can go unopened for before it is automatically deleted
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_days: Option<i32>,
    /// The default share permission for all items in the organization
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_share_permission: Option<OrganizationDefaultSharePermission>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct User {
    /// The id of the user
    pub id: String,
    /// The email of the user
    pub email: String,
    /// If the user is an it admin or not
    pub is_it_admin: bool,
}
