use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::{
    api::context::ApiContext,
    model::{request::invite_user::InviteUserRequest, response::EmptyResponse},
    utils,
};

use model::user::UserContext;

/// Invites a user to an organization
#[utoipa::path(
        post,
        path = "/users/invite",
        responses(
            (status = 200),
            (status = 401, body=String),
            (status = 400, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, req), fields(user_id=%user_context.user_id, organization_id=?user_context.organization_id, invite_email=%req.email))]
pub async fn invite_user_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<InviteUserRequest>,
) -> Result<Response, Response> {
    if !utils::validate_email::is_valid_email(req.email.as_str()) {
        tracing::error!("invalid email provided");
        return Err((StatusCode::BAD_REQUEST, "Unable to validate request.").into_response());
    }
    let organization_id = user_context.organization_id;
    let allow_list_only = macro_db_client::organization::get::organization::get_allow_list_only(
        ctx.db.clone(),
        organization_id.expect("Organization ID must be supplied"),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get organization allow list only");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to validate request.",
        )
            .into_response()
    })?;

    let organization_name =
        macro_db_client::organization::get::organization::get_organization_name(
            &ctx.db,
            organization_id.expect("Organization ID must be supplied"),
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get organization name");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to invite user to organization.",
            )
                .into_response()
        })?;

    // Ensure domain is correct for the organization
    let user_domain = req.email.split('@').collect::<Vec<&str>>()[1];
    let organization_domains = get_organization_domains(
        ctx.db.clone(),
        organization_id.expect("Organization ID must be supplied"),
        allow_list_only,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get organization email matches");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to validate request.",
        )
            .into_response()
    })?;

    tracing::trace!(organization_domain=?organization_domains, user_domain=?user_domain, "checking if user domain matches organization domain");

    if !organization_domains.contains(&user_domain.to_string()) {
        tracing::error!(user_domain=?user_domain, organization_domains=?organization_domains, "user domain not in organization domain list");
        return Err((
            StatusCode::BAD_REQUEST,
            "The user's domain is not valid for this organization.",
        )
            .into_response());
    }

    // Check if user exists and is in organization
    let existing_user = macro_db_client::user::get::get_user_by_email::get_user_by_email(
        ctx.db.clone(),
        req.email.as_str(),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get user");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to validate request.",
        )
            .into_response()
    })?;

    // If the user is part of an organization we cannot invite them to this one.
    if let Some(existing_user) = existing_user
        && let Some(user_organization_id) = existing_user.1
    {
        if user_organization_id != organization_id.expect("Organization ID must be supplied") {
            tracing::error!("user is already in a different organization");
            return Err((
                StatusCode::UNAUTHORIZED,
                "User belongs to another organization.",
            )
                .into_response());
        }
        tracing::trace!("user is already in the organization, sending invitation email");

        // Email user invitation
        ctx.ses_client
            .invite_user(&organization_name, req.email.as_str())
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to send user invitation email");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Unable to email user invitation.",
                )
                    .into_response()
            })?;

        // User is already in the organization
        return Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response());
    }

    // Invite user
    macro_db_client::user::create::invite_user::invite_user(
        ctx.db.clone(),
        user_context
            .organization_id
            .expect("Organization must be supplied"),
        req.email.as_str(),
        allow_list_only,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to create organization invitation");
        if e.to_string()
            .contains("user is already invited to your organization")
        {
            return (
                StatusCode::BAD_REQUEST,
                "User is already invited to your organization.",
            )
                .into_response();
        }
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to invite user to organization.",
        )
            .into_response()
    })?;

    // Email user invitation
    ctx.ses_client
        .invite_user(&organization_name, req.email.as_str())
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to send user invitation email");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to email user invitation.",
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}

/// Gets the organization domains for the user
async fn get_organization_domains(
    db: sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
    allow_list_only: bool,
) -> anyhow::Result<Vec<String>> {
    let email_matches =
        macro_db_client::organization::get::organization_email_matches::get_organization_email_matches(
            db.clone(),
            organization_id,
        )
        .await?;

    // If organization is "allowListOnly" we need to convert the emails in list to domains to
    // ensure the domain matches
    if allow_list_only {
        tracing::trace!("organization is allow list only");
        return Ok(email_matches
            .into_iter()
            .map(|e| e.split('@').collect::<Vec<&str>>()[1].to_string())
            .collect());
    }

    Ok(email_matches
        .into_iter()
        .filter(|email| !email.contains('@'))
        .collect())
}
