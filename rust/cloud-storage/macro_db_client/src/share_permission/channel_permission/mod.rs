use models_permissions::share_permission::access_level::AccessLevel;

pub mod create;
pub mod edit;
pub mod get;

pub enum ChannelSharePermissionParamaters {
    String(String),
    AccessLevel(AccessLevel),
}
