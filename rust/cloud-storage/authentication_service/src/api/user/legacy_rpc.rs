use std::sync::LazyLock;

use auth_service_rpc::{CreatePortalRequest, LegacyApiErr, LegacyApiRpc, StripeUrlResponse};
use axum::{
    Extension, Json,
    extract::{FromRef, State},
    http::StatusCode,
    response::IntoResponse,
};
use doppleganger::Mirror;
use macro_env_var::env_var;
use macro_middleware::user_permissions::attach_user_permissions::PermissionsExtractor;
use model::user::UserContext;
use sqlx::PgPool;
use stripe::{ParseIdError, StripeError};
use thiserror::Error;

use crate::api::{
    context::ApiContext,
    user::{
        get_legacy_user_permissions::{self, GetLegacyUserPermissionsResponse},
        get_user_organization,
        patch_user_group::{self, PatchUserGroupRequest},
        patch_user_onboarding::{self, PatchUserOnboardingRequest},
    },
};

#[derive(Clone)]
pub(super) struct AuthRpcState(pub(super) ApiContext);

impl FromRef<AuthRpcState> for PgPool {
    fn from_ref(input: &AuthRpcState) -> Self {
        input.0.db.clone()
    }
}

impl LegacyApiRpc for AuthRpcState {
    type GetPermsExtractor = (Extension<UserContext>, PermissionsExtractor);

    async fn get_legacy_user_permissions(
        &self,
        ctx: Self::GetPermsExtractor,
    ) -> Result<auth_service_rpc::GetLegacyUserPermissionsResponse, LegacyApiErr> {
        get_legacy_user_permissions::handler(State(self.0.clone()), ctx.0, ctx.1)
            .await
            .map_err(IntoResponse::into_response)
            .map(GetLegacyUserPermissionsResponse::mirror)
    }

    type UserExtractor = Extension<UserContext>;

    async fn get_user_organization(
        &self,
        ctx: Self::UserExtractor,
    ) -> Result<Option<auth_service_rpc::UserOrganizationResponse>, LegacyApiErr> {
        get_user_organization::handler(State(self.0.clone()), ctx)
            .await
            .map_err(IntoResponse::into_response)
            .map(|r| match r {
                get_user_organization::GetUserOrganizationResponse::NoOrganization => None,
                get_user_organization::GetUserOrganizationResponse::Organization(
                    user_organization_response,
                ) => Some(get_user_organization::UserOrganizationResponse::mirror(
                    user_organization_response,
                )),
            })
    }

    async fn patch_user_group(
        &self,
        ctx: Self::UserExtractor,
        req: auth_service_rpc::PatchUserGroupRequest,
    ) -> Result<(), LegacyApiErr> {
        patch_user_group::handler(
            State(self.0.clone()),
            ctx,
            Json(PatchUserGroupRequest::mirror(req)),
        )
        .await
        .map_err(IntoResponse::into_response)
        .map(|_| ())
    }

    async fn patch_user_onboarding(
        &self,
        ctx: Self::UserExtractor,
        req: auth_service_rpc::PatchUserOnboardingRequest,
    ) -> Result<(), LegacyApiErr> {
        patch_user_onboarding::handler(
            State(self.0.clone()),
            ctx,
            Json(PatchUserOnboardingRequest::mirror(req)),
        )
        .await
        .map_err(IntoResponse::into_response)
        .map(|_| ())
    }

    async fn create_checkout_session(
        &self,
        ctx: Self::UserExtractor,
        req: auth_service_rpc::CreateCheckoutRequest,
    ) -> Result<auth_service_rpc::StripeUrlResponse, LegacyApiErr> {
        inner_create_checkout(&self.0, ctx, req)
            .await
            .map_err(IntoResponse::into_response)
    }

    async fn create_portal_session(
        &self,
        ctx: Self::UserExtractor,
        req: auth_service_rpc::CreatePortalRequest,
    ) -> Result<auth_service_rpc::StripeUrlResponse, LegacyApiErr> {
        inner_create_portal(&self.0, ctx, req)
            .await
            .map_err(IntoResponse::into_response)
    }
}

#[derive(Debug, Error)]
enum InnerStripeErr {
    #[error("Failed to parse user id")]
    ParseId(#[from] macro_user_id::error::ParseErr),
    #[error("Internal server error")]
    DbErr(#[from] sqlx::Error),
    #[error("User does not have a stripe id")]
    MissingStripeId,
    #[error("Invalid stripe id")]
    StripeIdParse(#[from] ParseIdError),
    #[error("Internal stripe error")]
    StripeErr(#[from] StripeError),
    #[error("Invalid promo code")]
    PromoCodeNotFound,
    #[error("Internal server error")]
    UnExpectedStripeResponse,
}

impl IntoResponse for InnerStripeErr {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            InnerStripeErr::ParseId(_parse_err) => StatusCode::BAD_REQUEST,
            InnerStripeErr::DbErr(_error) => StatusCode::INTERNAL_SERVER_ERROR,
            InnerStripeErr::MissingStripeId => StatusCode::BAD_REQUEST,
            InnerStripeErr::StripeIdParse(_parse_id_error) => StatusCode::BAD_REQUEST,
            InnerStripeErr::StripeErr(_stripe_error) => StatusCode::INTERNAL_SERVER_ERROR,
            InnerStripeErr::PromoCodeNotFound => StatusCode::NOT_FOUND,
            InnerStripeErr::UnExpectedStripeResponse => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}

env_var!(
    struct StripePremiumPriceId;
);

static STRIPE_PRICE_ID: LazyLock<StripePremiumPriceId> = LazyLock::new(|| {
    match StripePremiumPriceId::new() {
        Ok(var) => var,
        // just use this non secret value if the value doesn't exist
        Err(_) => StripePremiumPriceId::Comptime("price_1PnSgXJaD7zvQeOBfSYgOmZc"),
    }
});

async fn inner_create_checkout(
    state: &ApiContext,
    ctx: Extension<UserContext>,
    req: auth_service_rpc::CreateCheckoutRequest,
) -> Result<auth_service_rpc::StripeUrlResponse, InnerStripeErr> {
    let user_id = macro_user_id::user_id::MacroUserId::parse_from_str(&ctx.user_id)?.lowercase();

    // Get the stripe customer ID from the database
    let stripe_customer_id =
        macro_db_client::user::get::get_stripe_customer_id_by_user_id(&state.db, &user_id)
            .await?
            .ok_or_else(|| InnerStripeErr::MissingStripeId)?;

    let customer_id: stripe::CustomerId = stripe_customer_id.parse()?;

    // If a discount code is provided, look up the promotion code ID
    let promo_code_id = if let Some(ref discount) = req.discount {
        let mut list_params = stripe::ListPromotionCodes::new();
        list_params.code = Some(discount);
        list_params.active = Some(true);
        list_params.limit = Some(1);

        let promo_codes = stripe::PromotionCode::list(&state.stripe_client, &list_params).await?;

        let promo_code = promo_codes
            .data
            .into_iter()
            .next()
            .ok_or_else(|| InnerStripeErr::PromoCodeNotFound)?;

        Some(promo_code.id)
    } else {
        None
    };

    // Create the checkout session
    let params = stripe::CreateCheckoutSession {
        customer: Some(customer_id),
        mode: Some(stripe::CheckoutSessionMode::Subscription),
        success_url: Some(req.success_url.as_str()),
        cancel_url: Some(req.cancel_url.as_str()),
        allow_promotion_codes: promo_code_id.is_none().then_some(true),
        discounts: promo_code_id.map(|id| {
            vec![stripe::CreateCheckoutSessionDiscounts {
                promotion_code: Some(id.to_string()),
                ..Default::default()
            }]
        }),
        // Set up line items
        line_items: Some(vec![stripe::CreateCheckoutSessionLineItems {
            price: Some(STRIPE_PRICE_ID.as_ref().to_string()),
            quantity: Some(1),
            ..Default::default()
        }]),
        ..Default::default()
    };

    let session = stripe::CheckoutSession::create(&state.stripe_client, params).await?;

    let url = session
        .url
        .ok_or_else(|| InnerStripeErr::UnExpectedStripeResponse)?;

    let url = url::Url::parse(&url).map_err(|_| InnerStripeErr::UnExpectedStripeResponse)?;

    Ok(auth_service_rpc::StripeUrlResponse { url })
}

async fn inner_create_portal(
    state: &ApiContext,
    ctx: Extension<UserContext>,
    req: CreatePortalRequest,
) -> Result<StripeUrlResponse, InnerStripeErr> {
    let user_id = macro_user_id::user_id::MacroUserId::parse_from_str(&ctx.user_id)?.lowercase();

    // Get the stripe customer ID from the database
    let stripe_customer_id =
        macro_db_client::user::get::get_stripe_customer_id_by_user_id(&state.db, &user_id)
            .await?
            .ok_or_else(|| InnerStripeErr::MissingStripeId)?;

    let customer_id: stripe::CustomerId = stripe_customer_id.parse()?;

    // Create the billing portal session
    let mut params = stripe::CreateBillingPortalSession::new(customer_id);
    params.return_url = Some(req.return_url.as_str());

    let session = stripe::BillingPortalSession::create(&state.stripe_client, params).await?;

    let url =
        url::Url::parse(&session.url).map_err(|_| InnerStripeErr::UnExpectedStripeResponse)?;

    Ok(auth_service_rpc::StripeUrlResponse { url })
}
