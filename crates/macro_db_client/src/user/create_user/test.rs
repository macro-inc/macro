use super::*;
use crate::user::get::get_user_id_and_stripe_customer_id_by_email;

#[sqlx::test]
async fn a_local_placeholder_does_not_become_a_billing_customer(pool: sqlx::PgPool) {
    let email = "local@signup.test";
    let user_id = create_user(
        &pool,
        &uuid::Uuid::new_v4().to_string(),
        email,
        email,
        true,
        "local-stripe-customer-local@signup.test",
        None,
        None,
        HashSet::new(),
    )
    .await
    .unwrap();

    assert_eq!(
        get_user_id_and_stripe_customer_id_by_email(&pool, email)
            .await
            .unwrap(),
        (user_id, None)
    );
}

#[sqlx::test]
async fn a_real_stripe_customer_remains_available_for_billing(pool: sqlx::PgPool) {
    let email = "billed@signup.test";
    let customer_id = "cus_signup_test";
    let user_id = create_user(
        &pool,
        &uuid::Uuid::new_v4().to_string(),
        email,
        email,
        true,
        customer_id,
        Some(customer_id),
        None,
        HashSet::new(),
    )
    .await
    .unwrap();

    assert_eq!(
        get_user_id_and_stripe_customer_id_by_email(&pool, email)
            .await
            .unwrap(),
        (user_id, Some(customer_id.to_owned()))
    );
}
