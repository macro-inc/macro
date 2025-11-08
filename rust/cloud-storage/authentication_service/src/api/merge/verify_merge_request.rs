use std::borrow::Cow;

use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::{
    api::context::ApiContext,
    service::fusionauth_client::identity_provider::{IdentityProviderLink, LinkUserRequest},
};

use model::{
    response::{EmptyResponse, ErrorResponse},
    tracking::IPContext,
    user::UserContext,
};

#[derive(serde::Deserialize)]
pub struct Params {
    pub code: String,
}

/// Verifies the merge request
#[utoipa::path(
        get,
        path = "/merge/verify/{code}",
        params(
            ("code" = String, Path, description = "The code")
        ),
        operation_id = "verify_merge_request",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, user_context, ip_context), fields(client_ip=%ip_context.client_ip, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: Extension<UserContext>,
    extract::Path(Params { code }): extract::Path<Params>,
) -> Result<Response, Response> {
    tracing::info!("verify_merge_request");

    let (account_merge_request_id, to_merge_macro_user_id) =
        macro_db_client::account_merge_request::get_merge_request_info(
            &ctx.db,
            &user_context.fusion_user_id,
            &code,
        )
        .await
        .map_err(|e| {
            if e.to_string()
                .contains("no rows returned by a query that expected to return at least one row")
            {
                (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        message: "account merge request not found",
                    }),
                )
                    .into_response()
            } else {
                tracing::error!(error=?e, "failed to get accounnt merge request");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "failed to get account merge request",
                    }),
                )
                    .into_response()
            }
        })?;

    // grab existing links
    let links = ctx
        .auth_client
        .get_links(&to_merge_macro_user_id, None)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get links");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        })?;

    // get stripe customer
    let stripe_customer =
        macro_db_client::macro_user::get_macro_user(&ctx.db, &to_merge_macro_user_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get macro user");
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
            })?
            .stripe_customer_id;

    let mut transaction = ctx.db.begin().await.map_err(|e| {
        tracing::error!(error=?e, "failed to begin transaction");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to begin transaction",
            }),
        )
            .into_response()
    })?;

    // macrodb
    macro_db_client::account_merge_request::merge_accounts(
        &mut transaction,
        &user_context.fusion_user_id,
        &to_merge_macro_user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to merge accounts");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to merge accounts",
            }),
        )
            .into_response()
    })?;

    // delete fusionauth user
    // NOTE: this will **not** delete any macrodb items for the user because we have a record in
    // `account_merge_request` to cause the delete user webhook to early exit
    ctx.auth_client
        .delete_user(&to_merge_macro_user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to delete fusionauth user");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        })?;

    if !links.is_empty() {
        // link user
        let link_requests: Vec<LinkUserRequest> = links
            .iter()
            .map(|link| LinkUserRequest {
                identity_provider_link: IdentityProviderLink {
                    display_name: Cow::Borrowed(&link.display_name),
                    identity_provider_id: Cow::Borrowed(&link.identity_provider_id),
                    identity_provider_user_id: Cow::Borrowed(&link.identity_provider_user_id),
                    user_id: Cow::Borrowed(&user_context.fusion_user_id),
                    token: Cow::Borrowed(&link.token),
                },
            })
            .collect::<Vec<_>>();

        let errors = futures::future::join_all(link_requests.into_iter().map(|link_request| {
            let auth_client = ctx.auth_client.clone();
            async move {
                match auth_client.link_user(link_request).await {
                    Ok(_) => Ok(()),
                    Err(e) => {
                        tracing::error!(error=?e, "unable to link user");
                        anyhow::bail!(e)
                    }
                }
            }
        }))
        .await
        .into_iter()
        .filter_map(|r| r.err())
        .collect::<Vec<_>>();

        if !errors.is_empty() {
            tracing::error!(errors=?errors, "unable to link user");
        }
    }

    // commit transaction
    // TODO: make sure we handle this failing gracefully
    // though in reality there should be no reason commiting the transaction would fail since we
    // have no deferred constraints
    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, to_merge_macro_user_id=?to_merge_macro_user_id, macro_user_id=?user_context.fusion_user_id, "failed to commit transaction");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to commit transaction",
            }),
        )
            .into_response()
    })?;

    // TODO: @evanhutnik email_service

    // delete stripe customer
    if let Some(stripe_customer_id) = stripe_customer {
        tracing::trace!(stripe_customer_id, "delete_stripe_customer");
        if let Ok(customer_id) = stripe_customer_id.parse()
            && let Err(e) = stripe::Customer::delete(&ctx.stripe_client, &customer_id).await
        {
            tracing::error!(error=?e, "unable to delete stripe customer");
        }
    }

    // delete merge request
    // NOTE: this is ok to fail as it will be auto-deleted from cleanup worker
    let _ = macro_db_client::account_merge_request::delete_account_merge_request(
        &ctx.db,
        &account_merge_request_id,
    )
    .await
    .inspect_err(|e| {
        tracing::error!(error=?e, "failed to delete account merge request");
    });

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
