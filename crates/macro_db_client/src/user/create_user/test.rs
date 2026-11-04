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
        false,
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
        false,
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

#[sqlx::test]
async fn a_second_profile_inherits_agent_status(pool: sqlx::PgPool) {
    let macro_user_id = uuid::Uuid::new_v4().to_string();
    let email = "agent@signup.test";
    create_user(
        &pool,
        &macro_user_id,
        email,
        email,
        true,
        "cus_agent_profile",
        None,
        None,
        HashSet::new(),
        true,
    )
    .await
    .unwrap();

    let second_email = "agent2@signup.test";
    create_user_profile(&pool, &macro_user_id, second_email, None, HashSet::new())
        .await
        .unwrap();

    let is_agent = sqlx::query_scalar!(
        r#"SELECT "isAgent" FROM "User" WHERE email = $1"#,
        second_email
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(is_agent);

    let name = crate::user::get_user_name::get_user_name(&pool, &macro_user_id)
        .await
        .unwrap();
    assert!(name.is_agent);
}
