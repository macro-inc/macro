use crate::api::context::ApiContext;
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{
    response::{EmptyResponse, ErrorResponse, GenericErrorResponse},
    user::UserContext,
};

#[derive(serde::Deserialize)]
pub struct Params {
    pub affiliate_code: String,
}

/// Affiliates a user with a given affiliate code
#[utoipa::path(
        post,
        path = "/affiliate/{affiliate_code}",
        operation_id = "affiliate_user",
        params(
            ("affiliate_code" = String, Path, description = "Affiliate code")
        ),
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=GenericErrorResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=%user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { affiliate_code }): Path<Params>,
) -> Result<Response, Response> {
    tracing::trace!("affiliate_user");

    // check if user for affiliate code already exists
    macro_db_client::user::get_user_email::get_user_by_email(ctx.db.clone(), &affiliate_code)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user email");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get user email",
                }),
            )
                .into_response()
        })?;

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

    let user_email = macro_db_client::user::get_user_email::get_user_email(
        &mut transaction,
        &user_context.user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to get user email");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to get user email",
            }),
        )
            .into_response()
    })?;

    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, "failed to commit transaction");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to commit transaction",
            }),
        )
            .into_response()
    })?;

    // check if user is already affiliated
    let is_user_already_referred = ctx
        .dynamodb_client
        .affiliate_users
        .is_user_already_referred(&user_email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to check if user is already affiliated");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to check if user is already affiliated",
                }),
            )
                .into_response()
        })?;

    if is_user_already_referred {
        return Ok((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "user is already affiliated",
            }),
        )
            .into_response());
    }

    // If the users email is = the affiliate code then we can't affiliate them
    // remove the email from + to @ then compare
    if compare_emails(&user_email, &affiliate_code) {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "affiliate email matches user email",
            }),
        )
            .into_response());
    }

    // affiliate user
    ctx.dynamodb_client
        .affiliate_users
        .affiliate_user(&affiliate_code, &user_email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to affiliate user");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to affiliate user",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}

/// Compares two emails to see if they're the same
/// Returns true if they're the same, false otherwise
fn compare_emails(user_email: &str, affiliate_code: &str) -> bool {
    // Trim and convert both emails to lowercase
    let stripped_user_email = user_email.trim().to_lowercase();
    let stripped_affiliate_code = affiliate_code.trim().to_lowercase();

    // Split both emails at the @ symbol
    let user_parts: Vec<&str> = stripped_user_email.split('@').collect();
    let affiliate_parts: Vec<&str> = stripped_affiliate_code.split('@').collect();

    // Only proceed if both strings have an @ symbol
    if user_parts.len() > 1 && affiliate_parts.len() > 1 {
        // Get everything before the + in the local part of the email
        let user_base = user_parts[0].split('+').next().unwrap_or("");
        let affiliate_base = affiliate_parts[0].split('+').next().unwrap_or("");

        // Compare the base part and domain part
        return user_base == affiliate_base && user_parts[1] == affiliate_parts[1];
    }

    // If one of the strings doesn't have an @ symbol, they're not comparable emails
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_emails() {
        assert!(compare_emails("test@example.com", "test@example.com"));
        assert!(compare_emails(
            "test+test@example.com",
            "test+test@example.com"
        ));
        assert!(compare_emails("test+test@example.com", "test@example.com"));
        assert!(compare_emails("test@example.com", "test+test@example.com"));

        assert!(compare_emails(
            "test+fdsafsdfs@example.com",
            "test+fdjsfkdja@example.com"
        ));

        assert!(!compare_emails("test@example.com", "test2@example.com"));
    }
}
