use macro_db_client::user::organization::{
    get_organization_roles_for_user, match_user_to_organization,
};

/// Creates a new user
/// This is a fairly involved process and as such will be well documented and broken up into
/// multiple easy-to-follow functions
///
/// Returns the (user_id, Option<organization_id>)
#[tracing::instrument(skip(db, stripe_client))]
pub async fn create_user(
    fusionauth_user_id: &str,
    username: &str,
    email: &str,
    is_verified: bool,
    db: &sqlx::Pool<sqlx::Postgres>,
    stripe_client: &stripe::Client,
) -> anyhow::Result<(String, Option<i32>)> {
    // NOTE: stripe adds in ~400ms of latency to this request. We may want to update our
    // requirement that each customer exists in stripe and create stripe customers as needed.
    let stripe_customer = create_stripe_user(email, stripe_client).await?;
    tracing::trace!(stripe_customer_id=?stripe_customer.id.to_string(), "created stripe customer");

    let stripe_customer_id = stripe_customer.id.to_string();

    let organization_id = match_user_to_organization(db, email).await?;
    tracing::trace!(organization_id=?organization_id, "matched user to organization");

    let roles = match organization_id {
        Some(organization_id) => {
            get_organization_roles_for_user(db, organization_id, email).await?
        }
        None => ["self_serve".to_string()].into_iter().collect(),
    };

    tracing::trace!(roles=?roles, "got roles for user");

    // Create user in macrodb
    let user_id = macro_db_client::user::create_user::create_user(
        db,
        fusionauth_user_id,
        username,
        email,
        is_verified,
        &stripe_customer_id,
        organization_id,
        roles,
    )
    .await?;

    if organization_id.is_some() {
        macro_db_client::organization::delete_organization_invitation(db.clone(), email).await?;
    }

    tracing::trace!("created user in macrodb");

    Ok((user_id, organization_id))
}

/// Creates a stripe customer for the user
/// Note: This does not check if a user with the same email already exists.
/// We can safely assume that this is not the case when we create a new user as the webhook is only
/// run for new users.
#[tracing::instrument(skip(stripe_client))]
pub async fn create_stripe_user(
    email: &str,
    stripe_client: &stripe::Client,
) -> anyhow::Result<stripe::Customer> {
    let customer = stripe::Customer::create(
        stripe_client,
        stripe::CreateCustomer {
            email: Some(email),
            ..Default::default()
        },
    )
    .await?;

    Ok(customer)
}

#[tracing::instrument(skip(db))]
pub async fn create_user_profile(
    fusionauth_user_id: &str,
    email: &str,
    db: &sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    let organization_id = match_user_to_organization(db, email).await?;
    tracing::trace!(organization_id=?organization_id, "matched user to organization");

    let roles = match organization_id {
        Some(organization_id) => {
            get_organization_roles_for_user(db, organization_id, email).await?
        }
        None => ["self_serve".to_string()].into_iter().collect(),
    };

    tracing::trace!(roles=?roles, "got roles for user");

    // Create user in macrodb
    macro_db_client::user::create_user::create_user_profile(
        db,
        fusionauth_user_id,
        email,
        organization_id,
        roles,
    )
    .await?;

    if organization_id.is_some() {
        macro_db_client::organization::delete_organization_invitation(db.clone(), email).await?;
    }

    tracing::trace!("created user in macrodb");

    Ok(())
}
