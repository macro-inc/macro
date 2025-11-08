use models_permissions::share_permission::SharePermissionV2;

/// Creates a new share permission object for a given item
/// This is a function as we may want to increase teh complexity of creating default share
/// permissions in the future so this allows us to easily change the logic across multiple services
/// in 1 place
pub fn create_new_share_permission() -> SharePermissionV2 {
    // Use default shareable permission
    SharePermissionV2::default()
}

/// Creates a new share permission object for a project
pub fn create_new_project_share_permission() -> SharePermissionV2 {
    // Use default shareable permission
    SharePermissionV2::default_project()
}
