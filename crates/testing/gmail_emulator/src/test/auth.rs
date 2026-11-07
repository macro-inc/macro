use std::time::Duration;

use super::*;

#[tokio::test]
async fn only_a_live_token_of_the_mailbox_is_accepted() {
    let emulator = two_mailboxes().await;
    let client = client(&emulator);

    let unknown = client.get_profile("not-a-token").await.unwrap_err();
    assert_eq!(unknown.status().unwrap().as_u16(), 401);

    let ada = emulator.access_token(ADA).unwrap();
    assert_eq!(client.get_profile(&ada).await.unwrap().email_address, ADA);

    // A token lasts an hour.
    emulator.advance_clock(Duration::from_secs(3600));
    let expired = client.get_profile(&ada).await.unwrap_err();
    assert_eq!(expired.status().unwrap().as_u16(), 401);
}

#[tokio::test]
async fn a_refresh_token_mints_access_tokens_until_the_grant_is_revoked() {
    let emulator = two_mailboxes().await;
    let http = reqwest::Client::new();
    let refresh = [
        ("grant_type", "refresh_token"),
        ("refresh_token", "refresh-ada@example.com"),
        ("client_id", "client"),
        ("client_secret", "secret"),
    ];

    let granted: serde_json::Value = http
        .post(emulator.token_url())
        .form(&refresh)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let access = granted["access_token"].as_str().unwrap();
    assert_eq!(granted["expires_in"], 3599);
    assert_eq!(
        client(&emulator)
            .get_profile(access)
            .await
            .unwrap()
            .email_address,
        ADA
    );

    let info: serde_json::Value = http
        .post(format!("{}/oauth2/v3/tokeninfo", emulator.base_url()))
        .form(&[("access_token", access)])
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["email"], ADA);
    assert!(info["scope"].as_str().unwrap().contains("gmail.modify"));

    emulator.revoke_grant(ADA).unwrap();
    let refused = http
        .post(emulator.token_url())
        .form(&refresh)
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status().as_u16(), 400);
    let body: serde_json::Value = refused.json().await.unwrap();
    assert_eq!(body["error"], "invalid_grant");
    let revoked = client(&emulator).get_profile(access).await.unwrap_err();
    assert_eq!(revoked.status().unwrap().as_u16(), 401);
}
