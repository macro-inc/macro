use crate::share_permission::access_level::AccessLevel;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserPermission {
    /// The share permission id
    pub id: String,
    /// If the item is publicly accessible
    pub is_public: bool,
    /// The level of public access
    pub public_access_level: Option<AccessLevel>,
    /// The highest level of access granted to the user through channels they are a member of
    pub channel_access_level: Option<AccessLevel>,
    /// The owner of the item
    pub owner: String,
}

// multi user permission info
#[derive(Eq, PartialEq, Debug)]
pub struct UsersPermission {
    /// The share permission id
    pub id: String,
    /// If the item is publicly accessible
    pub is_public: bool,
    /// The level of public access
    pub public_access_level: Option<AccessLevel>,
    /// The owner of the item
    pub owner: String,
    /// Per‑user permission details
    pub user_permissions: Vec<PerUserPermission>,
}

// subset of UserPermission with user specific access level info
#[derive(Eq, PartialEq, Debug)]
pub struct PerUserPermission {
    /// The user id associated with the permission (provided even if the user record doesn’t exist)
    pub user_id: String,
    /// The highest level of access granted to the user through channels they are a member of
    pub channel_access_level: Option<AccessLevel>,
}
