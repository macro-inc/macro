use model::authentication::login::request::{AppleLoginRequest, PasswordRequest};
use models_team::{
    PatchTeamRequest, Team, TeamInvite, TeamInviteUpdate, TeamRole, TeamUpdateOperation, TeamUser,
    TeamUserUpdate, TeamWithUsers,
};
use user_quota::UserQuota;
use utoipa::OpenApi;

use crate::api::email::generate_email_link::GenerateEmailLinkRequest;
use crate::api::email::resend_fusionauth_verify_user_email::ResendFusionauthVerifyUserEmailRequest;
use crate::api::jwt::macro_api_token::MacroApiTokenResponse;
use crate::api::link::create_in_progress_link::CreateInProgressLinkResponse;
use crate::api::merge::create_merge_request::CreateAccountMergeRequest;
use crate::api::team::create_team::CreateTeamRequest;
use crate::api::team::get_team_invites::TeamInvitesResponse;
use crate::api::user::create_user::CreateUserRequest;
use crate::api::user::get_legacy_user_permissions::GetLegacyUserPermissionsResponse;
use crate::api::user::get_user_link_exists::UserLinkResponse;
use crate::api::user::get_user_organization::UserOrganizationResponse;
use crate::api::user::patch_tutorial::PatchUserTutorialRequest;
use crate::api::user::patch_user_group::PatchUserGroupRequest;
use crate::api::user::patch_user_onboarding::PatchUserOnboardingRequest;
use crate::api::{
    email, health, jwt, link, login, logout, merge, oauth, oauth2, permissions, session, team, user,
};
use model::authentication::login::response::SsoRequiredResponse;
use model::authentication::{
    login::request::PasswordlessRequest, permission::Permission, user::GetUserInfo,
};
use model::response::{EmptyResponse, ErrorResponse, UserTokensResponse};
use model::user::{
    ProfilePictureQueryParams, ProfilePictures, PutUserNameQueryParams, UserName, UserNames,
    UserProfilePicture,
};

#[derive(OpenApi)]
#[openapi(
        info(
                terms_of_service = "https://macro.com/terms",
        ),
        paths(
                /// /health
                health::health_handler,

                /// /permissions
                permissions::get_permissions::handler,
                permissions::get_user_permissions::handler,

                /// /login
                login::passwordless::handler,
                login::sso::handler,
                login::password::handler,
                login::apple::handler,

                /// /logout
                logout::handler,

                /// /link
                link::create_in_progress_link::handler,

                /// /oauth
                oauth::oauth_redirect::handler,
                oauth::passwordless_callback::handler,

                oauth2::handler,

                /// /jwt
                jwt::refresh::handler,
                jwt::macro_api_token::handler,

                /// /user
                user::create_user::handler,
                user::get_user_info::handler,
                user::delete_user::handler,
                user::post_profile_pictures::handler,
                user::put_profile_picture::handler,
                user::put_name::handler,
                user::get_name::handler,
                user::patch_user_group::handler,
                user::patch_user_onboarding::handler,
                user::post_get_names::handler_external,
                user::get_user_link_exists::handler,
                user::get_user_organization::handler,
                user::get_user_quota::handler,
                user::get_legacy_user_permissions::handler,
                user::patch_tutorial::handler,

                /// /session
                session::session_login::handler,
                session::session_creation::handler,

                /// /email
                email::verify_fusionauth_user_email::handler,
                email::resend_fusionauth_verify_user_email::handler,
                email::generate_email_link::handler,
                email::verify_email_link::handler,

                /// /team
                team::create_team::handler,
                team::delete_team::handler,
                team::join_team::handler,
                team::get_team::handler,
                team::invite_to_team::handler,
                team::get_team_invites::handler,
                team::patch_team::handler,
                team::reject_invitation::handler,
                team::get_user_invites::handler,
                team::reinvite_to_team::handler,
                team::get_user_teams::handler,
                team::remove_user_from_team::handler,

                /// /merge
                merge::create_merge_request::handler,
                merge::verify_merge_request::handler,
        ),
        components(
            schemas(
                        Permission,
                        PasswordlessRequest,
                        PasswordRequest,
                        SsoRequiredResponse,
                        EmptyResponse,
                        ErrorResponse,
                        GetUserInfo,
                        ProfilePictures,
                        UserProfilePicture,
                        AppleLoginRequest,
                        ProfilePictureQueryParams,
                        PutUserNameQueryParams,
                        UserName,
                        UserNames,
                        UserTokensResponse,
                        UserLinkResponse,
                        MacroApiTokenResponse,
                        CreateUserRequest,
                        ResendFusionauthVerifyUserEmailRequest,
                        GenerateEmailLinkRequest,
                        CreateInProgressLinkResponse,
                        UserQuota,
                        UserOrganizationResponse,
                        GetLegacyUserPermissionsResponse,
                        PatchUserTutorialRequest,

                        // User onboarding
                        PatchUserGroupRequest,
                        PatchUserOnboardingRequest,

                        // Teams
                        TeamRole,
                        TeamInvite,
                        TeamUser,
                        Team,
                        CreateTeamRequest,
                        TeamWithUsers,
                        TeamInvitesResponse,
                        // patch team
                        TeamUpdateOperation,
                        TeamUserUpdate,
                        TeamInviteUpdate,
                        PatchTeamRequest,

                        // Merge
                        CreateAccountMergeRequest,
                ),
        ),
        tags(
            (name = "auth service", description = "Macro Authentication Service")
        )
    )]
pub struct ApiDoc;
