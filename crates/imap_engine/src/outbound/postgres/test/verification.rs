use super::*;
use crate::domain::service::verification::{VerificationScopeKey, scopes, test::request};

#[sqlx::test(migrations = false)]
async fn two_owners_share_a_keyed_login_cap_without_throttling_another_login(pool: PgPool) {
    schema(&pool).await;
    let repository = PgRepository::new(pool);
    let key = VerificationScopeKey::derive("synthetic-test-auth-key").unwrap();
    for attempt in 0..10 {
        let owner = if attempt % 2 == 0 {
            "first-owner"
        } else {
            "second-owner"
        };
        repository
            .admit_verification(&scopes(&request(owner, "mailbox@example.net"), &key).unwrap())
            .await
            .unwrap();
    }
    assert_eq!(
        repository
            .admit_verification(
                &scopes(&request("first-owner", "mailbox@example.net"), &key).unwrap()
            )
            .await,
        Err(Error::Throttled)
    );
    repository
        .admit_verification(
            &scopes(&request("first-owner", "different@example.net"), &key).unwrap(),
        )
        .await
        .unwrap();
}
