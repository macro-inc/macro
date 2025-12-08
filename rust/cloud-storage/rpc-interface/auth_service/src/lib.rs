use axum_rpc::{MaybeSend, MaybeSync, attr_macros};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(
    feature = "client",
    derive(tsify::Tsify),
    tsify(into_wasm_abi, from_wasm_abi)
)]
#[serde(rename_all = "camelCase")]
pub struct GetLegacyUserPermissionsResponse {
    /// The user id
    pub user_id: String,
    /// The permissions the user has
    pub permissions: Vec<String>,
    /// The user's email
    pub email: String,
    /// The user's name
    pub name: Option<String>,
    /// The user's license status
    pub license_status: String,
    /// Whether the user has completed the tutorial
    pub tutorial_complete: bool,
    /// The user's group
    pub group: Option<ABGroup>,
    /// Whether the user has the chrome extension
    pub has_chrome_ext: bool,
    /// Whether the user has trialed through stripe
    pub has_trialed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(
    feature = "client",
    derive(tsify::Tsify),
    tsify(into_wasm_abi, from_wasm_abi)
)]
pub enum ABGroup {
    A,
    B,
}

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(
    feature = "client",
    derive(tsify::Tsify),
    tsify(into_wasm_abi, from_wasm_abi)
)]
#[serde(rename_all = "camelCase")]
pub struct UserOrganizationResponse {
    /// The id of the organization
    pub organization_id: i32,
    /// The name of the organization
    pub organization_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(
    feature = "client",
    derive(tsify::Tsify),
    tsify(into_wasm_abi, from_wasm_abi)
)]
#[serde(rename_all = "camelCase")]
pub struct PatchUserOnboardingRequest {
    /// The first name of the user
    pub first_name: String,
    /// The last name of the user
    pub last_name: String,
    /// The title of the user
    pub title: String,
    /// The industry of the user
    pub industry: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(
    feature = "client",
    derive(tsify::Tsify),
    tsify(into_wasm_abi, from_wasm_abi)
)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckoutRequest {
    pub success_url: Url,
    pub cancel_url: Url,
    pub discount: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(
    feature = "client",
    derive(tsify::Tsify),
    tsify(into_wasm_abi, from_wasm_abi)
)]
#[serde(rename_all = "camelCase")]
pub struct CreatePortalRequest {
    pub return_url: Url,
}

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(
    feature = "client",
    derive(tsify::Tsify),
    tsify(into_wasm_abi, from_wasm_abi)
)]
#[serde(rename_all = "camelCase")]
pub struct StripeUrlResponse {
    pub url: Url,
}

#[cfg(all(feature = "client", not(feature = "server")))]
pub type LegacyApiErr = axum_rpc::anyhow::Error;
#[cfg(feature = "server")]
pub type LegacyApiErr = axum::response::Response;

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(
    feature = "client",
    derive(tsify::Tsify),
    tsify(into_wasm_abi, from_wasm_abi)
)]
pub struct PatchUserGroupRequest {
    /// The group to add the user to
    pub group: String,
}

/// this rpc trait replaces the parts we still need to support from the legacy gql service
#[cfg_attr(
    all(feature = "client", not(feature = "server")),
    attr_macros(client(bindgen))
)]
#[cfg_attr(feature = "server", attr_macros(router))]
pub trait LegacyApiRpc: MaybeSend + MaybeSync + 'static {
    type GetPermsExtractor: 'static;

    fn get_legacy_user_permissions(
        &self,
        ctx: Self::GetPermsExtractor,
    ) -> impl Future<Output = Result<GetLegacyUserPermissionsResponse, LegacyApiErr>> + MaybeSend;

    type UserExtractor: 'static;

    fn get_user_organization(
        &self,
        ctx: Self::UserExtractor,
    ) -> impl Future<Output = Result<Option<UserOrganizationResponse>, LegacyApiErr>> + MaybeSend;

    fn patch_user_group(
        &self,
        ctx: Self::UserExtractor,
        req: PatchUserGroupRequest,
    ) -> impl Future<Output = Result<(), LegacyApiErr>> + MaybeSend;

    fn patch_user_onboarding(
        &self,
        ctx: Self::UserExtractor,
        req: PatchUserOnboardingRequest,
    ) -> impl Future<Output = Result<(), LegacyApiErr>> + MaybeSend;

    fn create_checkout_session(
        &self,
        ctx: Self::UserExtractor,
        req: CreateCheckoutRequest,
    ) -> impl Future<Output = Result<StripeUrlResponse, LegacyApiErr>> + MaybeSend;

    fn create_portal_session(
        &self,
        ctx: Self::UserExtractor,
        req: CreatePortalRequest,
    ) -> impl Future<Output = Result<StripeUrlResponse, LegacyApiErr>> + MaybeSend;
}
