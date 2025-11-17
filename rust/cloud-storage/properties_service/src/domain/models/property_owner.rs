//! Property ownership model

use serde::{Deserialize, Serialize};

/// Defines who owns a property - user-scoped, org-scoped, or both
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PropertyOwner {
    User {
        user_id: String,
    },
    Organization {
        organization_id: i32,
    },
    UserAndOrganization {
        user_id: String,
        organization_id: i32,
    },
}

impl PropertyOwner {
    /// Get the organization_id if present
    pub fn organization_id(&self) -> Option<i32> {
        match self {
            PropertyOwner::Organization { organization_id }
            | PropertyOwner::UserAndOrganization {
                organization_id, ..
            } => Some(*organization_id),
            PropertyOwner::User { .. } => None,
        }
    }

    /// Get the user_id if present
    pub fn user_id(&self) -> Option<&str> {
        match self {
            PropertyOwner::User { user_id }
            | PropertyOwner::UserAndOrganization { user_id, .. } => Some(user_id.as_str()),
            PropertyOwner::Organization { .. } => None,
        }
    }

    /// Validate that the owner has at least one identifier
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            PropertyOwner::User { user_id } if user_id.is_empty() => Err("User ID cannot be empty"),
            PropertyOwner::Organization { organization_id } if *organization_id <= 0 => {
                Err("Organization ID must be positive")
            }
            PropertyOwner::UserAndOrganization {
                user_id,
                organization_id,
            } => {
                if user_id.is_empty() {
                    return Err("User ID cannot be empty");
                }
                if *organization_id <= 0 {
                    return Err("Organization ID must be positive");
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_organization_id() {
        let owner = PropertyOwner::Organization {
            organization_id: 42,
        };
        assert_eq!(owner.organization_id(), Some(42));

        let owner = PropertyOwner::User {
            user_id: "user1".to_string(),
        };
        assert_eq!(owner.organization_id(), None);

        let owner = PropertyOwner::UserAndOrganization {
            user_id: "user1".to_string(),
            organization_id: 42,
        };
        assert_eq!(owner.organization_id(), Some(42));
    }

    #[test]
    fn test_user_id() {
        let owner = PropertyOwner::User {
            user_id: "user1".to_string(),
        };
        assert_eq!(owner.user_id(), Some("user1"));

        let owner = PropertyOwner::Organization {
            organization_id: 42,
        };
        assert_eq!(owner.user_id(), None);

        let owner = PropertyOwner::UserAndOrganization {
            user_id: "user1".to_string(),
            organization_id: 42,
        };
        assert_eq!(owner.user_id(), Some("user1"));
    }

    #[test]
    fn test_validate() {
        let owner = PropertyOwner::User {
            user_id: "user1".to_string(),
        };
        assert!(owner.validate().is_ok());

        let owner = PropertyOwner::User {
            user_id: String::new(),
        };
        assert!(owner.validate().is_err());

        let owner = PropertyOwner::Organization {
            organization_id: 42,
        };
        assert!(owner.validate().is_ok());

        let owner = PropertyOwner::Organization { organization_id: 0 };
        assert!(owner.validate().is_err());
    }
}
