use super::*;
#[test]
fn accepts_only_recent_authentication_not_future_or_refreshed_sessions() {
    assert!(validate_auth_time(1000, 1300).is_ok());
    assert!(matches!(
        validate_auth_time(999, 1300),
        Err(Error::ReauthenticationRequired)
    ));
    assert!(matches!(
        validate_auth_time(1301, 1300),
        Err(Error::ReauthenticationRequired)
    ));
    assert!(matches!(
        validate_auth_time(i64::MIN, i64::MAX),
        Err(Error::ReauthenticationRequired)
    ));
}

#[tokio::test]
async fn signed_session_requires_recent_auth_time_and_matching_principal() {
    use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
    let now = chrono::Utc::now().timestamp();
    let claims = serde_json::json!({
        "aud":"", "iss":"", "exp":now+3600, "tid":"fixture",
        "email":"synthetic@example.test", "fusion_user_id":"fixture",
        "macro_user_id":"macro|synthetic@example.test", "auth_time":now
    });
    let sign = |claims: &serde_json::Value, key: &[u8]| {
        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256);
        header.kid = Some("synthetic-fusionauth".into());
        jsonwebtoken::encode(
            &header,
            claims,
            &jsonwebtoken::EncodingKey::from_secret(key),
        )
        .expect("signed fixture")
    };
    let reauthentication = SessionReauthentication {
        validation: JwtValidationArgs::new_testing(),
    };
    let mut actor = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|synthetic@example.test")
            .expect("fixture identity")
            .into_owned(),
        session_token: Some(SecretString(sign(&claims, b""))),
    };
    assert!(reauthentication.verify(&actor).await.is_ok());
    let mut missing = claims.clone();
    missing.as_object_mut().expect("object").remove("auth_time");
    let mut stale = claims.clone();
    stale["auth_time"] = (now - 301).into();
    let mut future = claims.clone();
    future["auth_time"] = (now + 60).into();
    let mut other = claims.clone();
    other["macro_user_id"] = "macro|other@example.test".into();
    for token in [
        None,
        Some(sign(&missing, b"")),
        Some(sign(&stale, b"")),
        Some(sign(&future, b"")),
        Some(sign(&other, b"")),
        Some(sign(&claims, b"wrong-key")),
    ] {
        actor.session_token = token.map(SecretString);
        assert!(matches!(
            reauthentication.verify(&actor).await,
            Err(Error::ReauthenticationRequired)
        ));
    }
    let valid = sign(&claims, b"");
    let mut altered = claims;
    altered["auth_time"] = (now + 100).into();
    let parts: Vec<_> = valid.split('.').collect();
    actor.session_token = Some(SecretString(format!(
        "{}.{}.{}",
        parts[0],
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&altered).expect("claims")),
        parts[2]
    )));
    assert!(matches!(
        reauthentication.verify(&actor).await,
        Err(Error::ReauthenticationRequired)
    ));
}
