use std::collections::HashMap;

use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::user_permission::{UserPermission, UsersPermission};
/// Ensures that the user has at least the minimum access level to the item
pub fn has_access(
    user_id: &str,
    user_permission: &UserPermission,
    minimum_access_level: AccessLevel,
) -> bool {
    match minimum_access_level {
        AccessLevel::Owner => has_owner_access(user_id, user_permission),
        AccessLevel::Edit => has_edit_access(user_id, user_permission),
        AccessLevel::Comment => has_comment_access(user_id, user_permission),
        AccessLevel::View => has_view_access(user_id, user_permission),
    }
}

#[tracing::instrument(skip(permissions), fields(share_permission_id=?permissions.id))]
pub fn access_level_from_permissions(
    user_id: &str,
    permissions: &UserPermission,
) -> Option<AccessLevel> {
    // There is no higher level of access so we can short circuit early here
    if permissions.owner == user_id {
        return Some(AccessLevel::Owner);
    }

    let mut access_level: Option<AccessLevel> = permissions.channel_access_level;

    if permissions.is_public {
        if let Some(level) = permissions.public_access_level.as_ref() {
            // If the public access level is set, we need to see if it's higher than the current
            // channel access level
            access_level = Some(ensure_max_access_level(access_level.as_ref(), level));
        } else {
            tracing::warn!("we have public access boolean without access level set");
            // There should always be a public access level
            access_level = Some(AccessLevel::View);
        }
    }

    access_level
}

/// Returns true if the user has view access to the item
pub fn has_view_access(user_id: &str, user_permission: &UserPermission) -> bool {
    match access_level_from_permissions(user_id, user_permission) {
        Some(_access_level) => true,
        None => false,
    }
}

pub fn has_comment_access(user_id: &str, user_permission: &UserPermission) -> bool {
    match access_level_from_permissions(user_id, user_permission) {
        Some(AccessLevel::Owner | AccessLevel::Edit | AccessLevel::Comment) => true,
        Some(AccessLevel::View) => false,
        None => false,
    }
}

/// Returns true if the user has edit access to the item
pub fn has_edit_access(user_id: &str, user_permission: &UserPermission) -> bool {
    match access_level_from_permissions(user_id, user_permission) {
        Some(AccessLevel::Owner | AccessLevel::Edit) => true,
        Some(AccessLevel::Comment | AccessLevel::View) => false,
        None => false,
    }
}

/// Returns true if the user has owner access to the item
pub fn has_owner_access(user_id: &str, user_permission: &UserPermission) -> bool {
    match access_level_from_permissions(user_id, user_permission) {
        Some(AccessLevel::Owner) => true,
        Some(_) => false,
        None => false,
    }
}

/// Ensures that the users have at least the minimum access level to the item
/// Returns a map of user ids to booleans indicating if the user has access
pub fn has_access_users(
    user_ids: &Vec<String>,
    users_permission: &UsersPermission,
    minimum_access_level: AccessLevel,
) -> HashMap<String, bool> {
    match minimum_access_level {
        AccessLevel::Owner => has_owner_access_users(user_ids, users_permission),
        AccessLevel::Edit => has_edit_access_users(user_ids, users_permission),
        AccessLevel::Comment => has_comment_access_users(user_ids, users_permission),
        AccessLevel::View => has_view_access_users(user_ids, users_permission),
    }
}

/// maps user ids to access level
#[tracing::instrument(skip(permissions), fields(share_permission_id=?permissions.id))]
pub fn access_level_from_users_permissions(
    user_ids: &Vec<String>,
    permissions: &UsersPermission,
) -> HashMap<String, Option<AccessLevel>> {
    let mut access_levels: HashMap<String, Option<AccessLevel>> = HashMap::new();

    for user_id in user_ids {
        let specific_user_permission = permissions
            .user_permissions
            .iter()
            .find(|p| p.user_id == *user_id);

        let permission = UserPermission {
            id: permissions.id.clone(),
            is_public: permissions.is_public,
            public_access_level: permissions.public_access_level,
            owner: permissions.owner.clone(),
            channel_access_level: specific_user_permission.and_then(|s| s.channel_access_level),
        };

        let access_level = access_level_from_permissions(user_id, &permission);
        access_levels.insert(user_id.clone(), access_level);
    }

    access_levels
}

pub fn has_view_access_users(
    user_ids: &Vec<String>,
    users_permission: &UsersPermission,
) -> HashMap<String, bool> {
    let access_levels = access_level_from_users_permissions(user_ids, users_permission);
    access_levels
        .iter()
        .map(|(user_id, access_level)| (user_id.clone(), access_level.is_some()))
        .collect()
}

pub fn has_comment_access_users(
    user_ids: &Vec<String>,
    users_permission: &UsersPermission,
) -> HashMap<String, bool> {
    let access_levels = access_level_from_users_permissions(user_ids, users_permission);
    access_levels
        .iter()
        .map(|(user_id, access_level)| {
            (
                user_id.clone(),
                matches!(
                    access_level,
                    Some(AccessLevel::Owner | AccessLevel::Edit | AccessLevel::Comment)
                ),
            )
        })
        .collect()
}

pub fn has_edit_access_users(
    user_ids: &Vec<String>,
    users_permission: &UsersPermission,
) -> HashMap<String, bool> {
    let access_levels = access_level_from_users_permissions(user_ids, users_permission);
    access_levels
        .iter()
        .map(|(user_id, access_level)| {
            (
                user_id.clone(),
                matches!(access_level, Some(AccessLevel::Owner | AccessLevel::Edit)),
            )
        })
        .collect()
}

pub fn has_owner_access_users(
    user_ids: &Vec<String>,
    users_permission: &UsersPermission,
) -> HashMap<String, bool> {
    let access_levels = access_level_from_users_permissions(user_ids, users_permission);
    access_levels
        .iter()
        .map(|(user_id, access_level)| {
            (
                user_id.clone(),
                matches!(access_level, Some(AccessLevel::Owner)),
            )
        })
        .collect()
}

fn ensure_max_access_level(current: Option<&AccessLevel>, new: &AccessLevel) -> AccessLevel {
    // If we currently have no access level, than any new access level is better
    if current.is_none() {
        return *new;
    }

    let current = current.unwrap();

    // If current or new are owner, we return owner
    if current == &AccessLevel::Owner || new == &AccessLevel::Owner {
        return AccessLevel::Owner;
    }
    // If current or new are edit, we return edit
    else if current == &AccessLevel::Edit || new == &AccessLevel::Edit {
        return AccessLevel::Edit;
    // If current or new are view, we return view
    } else if current == &AccessLevel::View || new == &AccessLevel::View {
        return AccessLevel::View;
    }

    // Stay with view
    *current
}

#[cfg(test)]
mod tests {
    use super::*;
    use models_permissions::share_permission::access_level::AccessLevel;
    use models_permissions::share_permission::user_permission::UserPermission;

    #[test]
    fn test_ensure_max_access_level() {
        assert_eq!(
            ensure_max_access_level(None, &AccessLevel::View),
            AccessLevel::View
        );
        // Owner
        assert_eq!(
            ensure_max_access_level(Some(&AccessLevel::Owner), &AccessLevel::View),
            AccessLevel::Owner
        );
        assert_eq!(
            ensure_max_access_level(Some(&AccessLevel::Owner), &AccessLevel::Edit),
            AccessLevel::Owner
        );
        assert_eq!(
            ensure_max_access_level(Some(&AccessLevel::Owner), &AccessLevel::Owner),
            AccessLevel::Owner
        );

        // Edit
        assert_eq!(
            ensure_max_access_level(Some(&AccessLevel::Edit), &AccessLevel::Owner),
            AccessLevel::Owner
        );
        assert_eq!(
            ensure_max_access_level(Some(&AccessLevel::Edit), &AccessLevel::Edit),
            AccessLevel::Edit
        );
        assert_eq!(
            ensure_max_access_level(Some(&AccessLevel::Edit), &AccessLevel::View),
            AccessLevel::Edit
        );

        // View
        assert_eq!(
            ensure_max_access_level(Some(&AccessLevel::View), &AccessLevel::Owner),
            AccessLevel::Owner
        );
        assert_eq!(
            ensure_max_access_level(Some(&AccessLevel::View), &AccessLevel::Edit),
            AccessLevel::Edit
        );
        assert_eq!(
            ensure_max_access_level(Some(&AccessLevel::View), &AccessLevel::View),
            AccessLevel::View
        );
    }

    #[test]
    fn test_owner_access_level_from_permissions() {
        let permissions = UserPermission {
            id: "sp-1".to_string(),
            is_public: false,
            public_access_level: Some(AccessLevel::Edit),
            channel_access_level: None,
            owner: "macro|user@user.com".to_string(),
        };

        let user_id = "macro|user@user.com";

        assert_eq!(
            access_level_from_permissions(user_id, &permissions),
            Some(AccessLevel::Owner)
        );
    }

    #[test]
    fn test_edit_access_level_from_permissions() {
        let permissions = UserPermission {
            id: "sp-1".to_string(),
            is_public: true,
            public_access_level: Some(AccessLevel::Edit),
            channel_access_level: None,
            owner: "macro|user@user.com".to_string(),
        };

        assert_eq!(
            access_level_from_permissions("macro|user2@user.com", &permissions),
            Some(AccessLevel::Edit)
        );

        let permissions = UserPermission {
            id: "sp-1".to_string(),
            is_public: false,
            public_access_level: None,
            channel_access_level: Some(AccessLevel::Edit),
            owner: "macro|user2@user.com".to_string(),
        };

        assert_eq!(
            access_level_from_permissions("macro|user@user.com", &permissions),
            Some(AccessLevel::Edit)
        );
    }

    #[test]
    fn test_view_access_level_from_permissions() {
        let permissions = UserPermission {
            id: "sp-1".to_string(),
            is_public: true,
            public_access_level: None,
            channel_access_level: None,
            owner: "macro|user@user.com".to_string(),
        };

        let user_id = "macro|user2@user.com";

        assert_eq!(
            access_level_from_permissions(user_id, &permissions),
            Some(AccessLevel::View)
        );
    }

    #[test]
    fn test_no_access_level_from_permissions() {
        let permissions = UserPermission {
            id: "sp-1".to_string(),
            is_public: false,
            public_access_level: None,
            channel_access_level: None,
            owner: "macro|user@user.com".to_string(),
        };

        let user_id = "macro|user2@user.com";

        assert_eq!(access_level_from_permissions(user_id, &permissions), None);
    }

    #[test]
    fn test_gets_maximum_access_level() {
        let permissions = UserPermission {
            id: "sp-1".to_string(),
            is_public: true,
            public_access_level: Some(AccessLevel::View),
            channel_access_level: Some(AccessLevel::Owner),
            owner: "macro|user@user.com".to_string(),
        };

        let user_id = "macro|user2@user.com";

        assert_eq!(
            access_level_from_permissions(user_id, &permissions),
            Some(AccessLevel::Owner)
        );
    }
}

#[cfg(test)]
mod multi_user_tests {
    use models_permissions::share_permission::user_permission::PerUserPermission;

    use super::*;
    use models_permissions::share_permission::access_level::AccessLevel;
    use std::collections::HashMap;
    // For these tests, we’ll assume the following ordering for access levels:
    // Owner > Edit > View > None.
    //
    // We construct a UsersPermission with:
    // - is_public = true and public_access_level = Some(View) (so users without a specific permission get View)
    // - owner = "user_owner"
    // - A per-user vector that provides extra permissions for some users.
    //
    // Our test users:
    //   - "user_owner" is the owner.
    //   - "user1" has a specific permission with user_access_level = Some(Edit).
    //   - "user2" has a specific permission with user_access_level = Some(View) and organization_access_level = Some(Edit).
    //   - "user3" and "userX" have no per‑user entry, so they only get the public access level.

    fn test_users_permission_fixture() -> UsersPermission {
        UsersPermission {
            id: "sp-1".to_string(),
            is_public: true,
            public_access_level: Some(AccessLevel::View),
            owner: "user_owner".to_string(),
            user_permissions: vec![
                PerUserPermission {
                    user_id: "user1".to_string(),
                    channel_access_level: Some(AccessLevel::Edit),
                },
                PerUserPermission {
                    user_id: "user2".to_string(),
                    channel_access_level: Some(AccessLevel::Edit),
                },
                // We include the owner explicitly in the per-user vector as well.
                PerUserPermission {
                    user_id: "user_owner".to_string(),
                    channel_access_level: None,
                },
            ],
        }
    }

    #[test]
    fn test_access_level_from_users_permissions() {
        let users_permission = test_users_permission_fixture();
        let user_ids = vec![
            "user1".to_string(),
            "user2".to_string(),
            "user3".to_string(),
            "user_owner".to_string(),
            "userX".to_string(),
        ];

        let result = access_level_from_users_permissions(&user_ids, &users_permission);

        // Expected:
        // - For "user_owner": owner override → Some(Owner)
        // - For "user1": specific permission gives Edit → Some(Edit)
        // - For "user2": maximum between (View from user and Edit from org) is Edit → Some(Edit)
        // - For "user3" and "userX": no per-user permission, so fall back to public access → Some(View)
        let mut expected = HashMap::new();
        expected.insert("user1".to_string(), Some(AccessLevel::Edit));
        expected.insert("user2".to_string(), Some(AccessLevel::Edit));
        expected.insert("user3".to_string(), Some(AccessLevel::View));
        expected.insert("user_owner".to_string(), Some(AccessLevel::Owner));
        expected.insert("userX".to_string(), Some(AccessLevel::View));

        assert_eq!(result, expected);
    }

    #[test]
    fn test_has_view_access_users() {
        let users_permission = test_users_permission_fixture();
        let user_ids = vec![
            "user1".to_string(),
            "user2".to_string(),
            "user3".to_string(),
            "user_owner".to_string(),
            "userX".to_string(),
        ];

        let view_access = has_view_access_users(&user_ids, &users_permission);
        // With public access granted, every user should have at least view access.
        let mut expected = HashMap::new();
        expected.insert("user1".to_string(), true);
        expected.insert("user2".to_string(), true);
        expected.insert("user3".to_string(), true);
        expected.insert("user_owner".to_string(), true);
        expected.insert("userX".to_string(), true);

        assert_eq!(view_access, expected);
    }

    #[test]
    fn test_has_edit_access_users() {
        let users_permission = test_users_permission_fixture();
        let user_ids = vec![
            "user1".to_string(),
            "user2".to_string(),
            "user3".to_string(),
            "user_owner".to_string(),
            "userX".to_string(),
        ];

        let edit_access = has_edit_access_users(&user_ids, &users_permission);
        // Expected:
        // - "user_owner" (owner) → true
        // - "user1" has Edit → true
        // - "user2" gets Edit from organization permission → true
        // - "user3" and "userX" only get public (View) → false
        let mut expected = HashMap::new();
        expected.insert("user1".to_string(), true);
        expected.insert("user2".to_string(), true);
        expected.insert("user3".to_string(), false);
        expected.insert("user_owner".to_string(), true);
        expected.insert("userX".to_string(), false);

        assert_eq!(edit_access, expected);
    }

    #[test]
    fn test_has_owner_access_users() {
        let users_permission = test_users_permission_fixture();
        let user_ids = vec![
            "user1".to_string(),
            "user2".to_string(),
            "user3".to_string(),
            "user_owner".to_string(),
            "userX".to_string(),
        ];

        let owner_access = has_owner_access_users(&user_ids, &users_permission);
        // Only the owner should have owner access.
        let mut expected = HashMap::new();
        expected.insert("user1".to_string(), false);
        expected.insert("user2".to_string(), false);
        expected.insert("user3".to_string(), false);
        expected.insert("user_owner".to_string(), true);
        expected.insert("userX".to_string(), false);

        assert_eq!(owner_access, expected);
    }
}
