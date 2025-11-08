use crate::{
    api::{health, organization, users},
    model::{
        organization::{OrganizationSettingsResponse, OrganizationShareType},
        request::{
            delete_user::DeleteUserRequest,
            invite_user::InviteUserRequest,
            patch_organization_settings::PatchOrganizationSettingsRequest,
            patch_user_role::{OrganizationUserRole, PatchUserRoleRequest},
        },
        response::{
            EmptyResponse,
            user::{get_invited_users::GetInvitedUsersResponse, get_users::GetUsersResponse},
        },
    },
};

use model::organization::{OrganizationDefaultSharePermission, User};
use models_permissions::share_permission::access_level::AccessLevel;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
        info(
            terms_of_service = "https://macro.com/terms",
        ),
        paths(
            health::health_handler,

            // users
            users::get_users::get_users_handler,
            users::patch_user_role::patch_user_role_handler,
            users::delete_user::delete_user_handler,
            users::invite_user::invite_user_handler,
            users::revoke_user_invite::revoke_user_invite_handler,
            users::get_invited_users::get_invited_users_handler,

            // organizations
            organization::get_settings::get_settings_handler,
            organization::patch_organization_settings::patch_organization_settings_handler,
        ),
        components(
            schemas(
                User,
                AccessLevel, OrganizationDefaultSharePermission,
                GetUsersResponse, // Get all users
                OrganizationShareType, OrganizationSettingsResponse, // Get organization settings
                PatchOrganizationSettingsRequest, // Patch organization settings
                OrganizationUserRole, PatchUserRoleRequest,
                DeleteUserRequest,
                InviteUserRequest,
                GetInvitedUsersResponse,
                EmptyResponse,
            ),
        ),
        tags(
            (name = "macro organization service", description = "Organization service")
        )
    )]
pub struct ApiDoc;
