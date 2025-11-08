use model::organization::{OrganizationDefaultSharePermission, OrganizationSettings};
use models_permissions::share_permission::access_level::AccessLevel;
use strum::EnumString;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct OrganizationSettingsResponse {
    /// The name of the organization
    pub name: String,
    /// The number of days an item can go unopened for before it is automatically deleted
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_days: Option<i32>,
    /// The default share permission for the organization
    pub default_share_permission: OrganizationShareType,
}

impl From<OrganizationSettings> for OrganizationSettingsResponse {
    fn from(settings: OrganizationSettings) -> Self {
        let default_share_permission = if let Some(dsp) = settings.default_share_permission {
            if dsp.is_public {
                OrganizationShareType::Public
            } else if dsp.organization_access_enabled {
                OrganizationShareType::Organization
            } else {
                OrganizationShareType::Private
            }
        } else {
            // We use the default share permission which is public
            OrganizationShareType::Public
        };

        Self {
            name: settings.name,
            retention_days: settings.retention_days,
            default_share_permission,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema, EnumString)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum OrganizationShareType {
    Public,
    Organization,
    Private,
}

impl From<OrganizationShareType> for OrganizationDefaultSharePermission {
    fn from(share_type: OrganizationShareType) -> Self {
        match share_type {
            OrganizationShareType::Public => OrganizationDefaultSharePermission {
                is_public: true,
                public_access_level: Some(AccessLevel::View),
                organization_access_enabled: false,
                organization_access_level: None,
            },
            OrganizationShareType::Organization => OrganizationDefaultSharePermission {
                is_public: false,
                public_access_level: None,
                organization_access_enabled: true,
                organization_access_level: Some(AccessLevel::View),
            },
            OrganizationShareType::Private => OrganizationDefaultSharePermission {
                is_public: false,
                public_access_level: None,
                organization_access_enabled: false,
                organization_access_level: None,
            },
        }
    }
}
