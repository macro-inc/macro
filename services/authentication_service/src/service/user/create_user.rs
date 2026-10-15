use std::collections::HashSet;

use macro_db_client::user::organization::{
    get_organization_roles_for_user, match_user_to_organization,
};
use macro_env_var::optional_read_env_var;
use roles_and_permissions::domain::model::{ProductTier, RoleId};

#[cfg(test)]
mod test;

/// The plan a self-serve signup starts on. Organization members take their
/// organization's roles instead.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SignupPlan {
    /// The free plan; users upgrade through Stripe checkout.
    Free,
    /// The Premium (Pro) plan, granted without Stripe. Only local stacks
    /// start users here (see `Config::signup_plan`).
    Pro,
}

impl SignupPlan {
    /// The roles a new self-serve user is created with.
    fn roles(self) -> HashSet<String> {
        let roles = match self {
            SignupPlan::Free => vec![RoleId::SelfServe],
            // The roles Stripe grants an active Premium subscription.
            SignupPlan::Pro => vec![
                RoleId::SelfServe,
                RoleId::ProfessionalSubscriber,
                ProductTier::Opus.role(),
            ],
        };
        roles.iter().map(RoleId::to_string).collect()
    }
}

/// The stub `STRIPE_SECRET_KEY` set by `run_local --no-doppler` (see
/// `tooling/xtask/crates/xtask_local/src/local/local_env.rs`). With this key a
/// real Stripe call would fail, so local signups skip it and store a
/// deterministic placeholder only in the required legacy account field.
const LOCAL_STRIPE_SECRET_STUB: &str = "local-stripe-secret";

fn is_local_stripe_stub() -> bool {
    optional_read_env_var("STRIPE_SECRET_KEY")
        .ok()
        .flatten()
        .is_some_and(|key| key == LOCAL_STRIPE_SECRET_STUB)
}

/// A unique placeholder Stripe customer id for local signups. `stripe_customer_id`
/// has a UNIQUE constraint, so it must be unique per user.
fn local_stripe_customer_id(email: &str) -> String {
    format!("local-stripe-customer-{email}")
}

/// Creates a new user
/// This is a fairly involved process and as such will be well documented and broken up into
/// multiple easy-to-follow functions
///
/// Returns the (user_id, Option<organization_id>)
#[tracing::instrument(skip(db, stripe_client), err)]
pub async fn create_user(
    fusionauth_user_id: &str,
    username: &str,
    email: &str,
    is_verified: bool,
    signup_plan: SignupPlan,
    db: &sqlx::Pool<sqlx::Postgres>,
    stripe_client: &stripe::Client,
) -> anyhow::Result<(String, Option<i32>)> {
    let stripe_customer_id = if is_local_stripe_stub() {
        // Local mode uses a stub key; don't call Stripe (it would 401 and
        // abort the transactional user.create webhook, blocking all signups).
        tracing::info!("skipping Stripe customer creation for the local Stripe stub");
        None
    } else {
        // NOTE: stripe adds in ~400ms of latency to this request. We may want to update our
        // requirement that each customer exists in stripe and create stripe customers as needed.
        let start_time = std::time::Instant::now();
        let stripe_customer = create_stripe_user(email, stripe_client).await?;
        tracing::info!(
            stripe_customer_id = %stripe_customer.id,
            elapsed_ms = start_time.elapsed().as_millis() as u64,
            "created Stripe customer"
        );
        Some(stripe_customer.id.to_string())
    };
    // The legacy account key is required, but a profile without a real Stripe
    // customer must leave billing absent so free team creation skips Stripe.
    let macro_user_customer_id = stripe_customer_id
        .clone()
        .unwrap_or_else(|| local_stripe_customer_id(email));

    let organization_id = match_user_to_organization(db, email).await?;

    let roles = match organization_id {
        Some(organization_id) => {
            get_organization_roles_for_user(db, organization_id, email).await?
        }
        None => signup_plan.roles(),
    };

    tracing::info!(organization_id=?organization_id, roles=?roles, "resolved organization and roles for new user");

    // Create user in macrodb
    let user_id = macro_db_client::user::create_user::create_user(
        db,
        fusionauth_user_id,
        username,
        email,
        is_verified,
        &macro_user_customer_id,
        stripe_customer_id.as_deref(),
        organization_id,
        roles,
    )
    .await?;

    tracing::info!(user_id, "created macro user and user profile in macrodb");

    if organization_id.is_some() {
        macro_db_client::organization::delete_organization_invitation(db.clone(), email).await?;
        tracing::info!(organization_id=?organization_id, "deleted pending organization invitation");
    }

    Ok((user_id, organization_id))
}

/// Creates a stripe customer for the user
/// Note: This does not check if a user with the same email already exists.
/// We can safely assume that this is not the case when we create a new user as the webhook is only
/// run for new users.
#[tracing::instrument(skip(stripe_client), err)]
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
    signup_plan: SignupPlan,
    db: &sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    let organization_id = match_user_to_organization(db, email).await?;
    tracing::trace!(organization_id=?organization_id, "matched user to organization");

    let roles = match organization_id {
        Some(organization_id) => {
            get_organization_roles_for_user(db, organization_id, email).await?
        }
        None => signup_plan.roles(),
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
