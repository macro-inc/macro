use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::UnauthedClient;

const TEST_KEY_ID: &str = "test-signing-key";

const TEST_PRIVATE_KEY: &str = r#"-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAsAR6nHqp4SETFWaUoKS3zR5P6t8ztZGK005KQ9uwFhHUXUV4
dX6+NZ7xS9WtHNzdr2VJBv3Pn3aTcEz6fdWK/zt7Ew/WncN5j8vZfcLDMp6fX3Xh
37hU9UnlV7NhXtmpYP86i9vPIUw0bDyvv7oEwksbhFY0QawdqFm5//l7IoM1FYxY
EaLtjcAEIrBkL7NSOgE01VcedY4VlYRnOArvHT+qwtMCrXv1a2jez0AfdyhO2U72
kRkw0fGbUk/Yv3/gx3P1L40LwMSaT1ejl+pYmDLp46PCOjuMdKwuEgbuW3lIj8hc
G06HBSK7OgwOXvUaDLVeICgOS2f1uRhZ4xXY2wIDAQABAoIBAARj0DUH4CXDv+iY
Otu4z/a3K1IVyAHew+IaQULo/z7FqhC7c1Im25KVyLnV9e/S2FqQAZ7BhMSa3fl+
if7KbSGJd7vVeMpNfkImWOHIkjq4dwwX8g6017WYZrZlvGdzsURAiVLEpClV77bF
WrLC7mx0GBcYWUxMAR9aQYfPTpFhPsEgjmBttPl3AseOEb9Ql8cSHOVt019du1q8
3LRd9jR14UVK9k62WPUA/sJ1cC9w5CsZyJH1GXcsjf9rwu//ss9nipXGqMCgbe2i
8ABd+RhcfDf6Gx/TRyJ9AxJNJNA2g6txKkH6pcWFPmczDhmpsLgcnJvv0tNWJeVS
xvRI040CgYEA2zxtEvQpuUsF2edRfl5nTFlOGW/JPtA+LUkM0kNfQd3q5FPDUXlR
UyEE+SuU2Zp2g/fBfox03NbFFhHhDxtuptlQeDQlqMR/zlnnlehhiNz6k9m+YX6l
d1hCNpJM4d1IRxKf99mBlJPlTLwU7felLELH1XlYtG/x4FP19YjremUCgYEAzYi5
2ymFM3NcY0+FORSreFfoIQdPkZ4XVP/sRl+eMidu0Q6fnOTQFFXUx+NiL4/v9GMq
YMzbjLbODNAD6i17hliWS1x4xHA4LhKXMARFeDSDCFwSeCicbpRJJRr8DB+yUPtX
5Tad68JyTcRLp+0t4cKDx18WVp8WWcPxP00fMj8CgYEArM+dvsH9nZQ4gYHn5+9s
B2+hs0U9YajuSe36EEeQ76+ItwAbxr4VT6yIagxjYX9zCiUiPaljeKxGYFYpjCn4
d8Z2urmIMdbqU3LkrHKnZyWg0yhg/CLDNSa50qBRv/wYPAW/WLP3g3Fs3qam7Mk3
RoNBV9E2Dczr4QLtruSFkU0CgYEAxEkbFc6lQumdBcrftA+lYhyxtzlAKBUOu0Jd
5ydR8RvvnP+WN0Pd5E3EE9F352xTANXjluaNlejPBzVxR6eAHGFlxzrcqt1xCa7/
a//oSE/+A3HKwa4nFwPOhv0qUHnE1cnzuxdZ4dmlR9d7WTgNZVlaeIC62Ka9taSH
NKj2bgkCgYBklT3jCD3vvUpLLgyIL92Dv3Sk6YvkFftkKvZDxqmH2CjmqkcXFW7+
zA9/aondVhZwdixoc6nnqzVyKBiTmLn804nICpDHxyNayRXAbum+aFqM7tfhG+/T
m5UIYS903JMnauKzKOF5xn+3qIBkMkXluyq2wIRIi+V6DmZKlpxTDw==
-----END RSA PRIVATE KEY-----"#;

const TEST_MODULUS: &str = "sAR6nHqp4SETFWaUoKS3zR5P6t8ztZGK005KQ9uwFhHUXUV4dX6-NZ7xS9WtHNzdr2VJBv3Pn3aTcEz6fdWK_zt7Ew_WncN5j8vZfcLDMp6fX3Xh37hU9UnlV7NhXtmpYP86i9vPIUw0bDyvv7oEwksbhFY0QawdqFm5__l7IoM1FYxYEaLtjcAEIrBkL7NSOgE01VcedY4VlYRnOArvHT-qwtMCrXv1a2jez0AfdyhO2U72kRkw0fGbUk_Yv3_gx3P1L40LwMSaT1ejl-pYmDLp46PCOjuMdKwuEgbuW3lIj8hcG06HBSK7OgwOXvUaDLVeICgOS2f1uRhZ4xXY2w";

/// A second key pair whose private key does not match `TEST_MODULUS`, used to forge signatures.
const OTHER_PRIVATE_KEY: &str = r#"-----BEGIN RSA PRIVATE KEY-----
MIIEpQIBAAKCAQEAptcayMug1gOK1fjWp163qoLbrEouZOl16fFEGy8enPch1USS
BYcjenMPISXZo7yIQbzdIRHEz43JpxJo6gac8SdnV++ibg5SyI1rSYfeRrzrnLCs
yszBBQ4BSbAeRe5hk0fSxWRT8yl+p+e11onFPRN5Du3OHT9x1KxvuOcCVrh/M5uN
yj8UZHZvoT3SAnz8r6uvwvvzutybTIjzxEq14NLwVJlf16COzAzWldIN3vq6b0KK
/KLK6OPib/EiFrUj6pBXQNMlnWO9z7AP8fS71N1xYcTes2GnMQbfPz0jcU36NXcn
+DgLoBEbpqerGSvq1kPOdygyFXT0WxVK4lJ0LQIDAQABAoIBAALJS963m9+HHp31
MmyIJewYlF+bu4ue5IO8LkV/83RuoieEJiYmfB6y5jlI/wn/f40NgOno+I740LnU
EmF6K8vROyYaT+2jmplT10talAk9ZXfv8WrPoZeahMX8xXyofwOtKuV2B/rjIgTe
10gWc+9RsG9h5FPTt+xz1sfRP9Y/5qSX8/SlbuiJNu+UWLqsWXUtPaKTd36kpAu9
EB+UFL3fcqmJWfP1n+K5rnJk74UOuwwPb8cghartawwvz8Prp4suts+rEaxS6zkL
DW+X8OW/qMAGD79YgTtfF2PjigRrKt25IyJjciPDSqAgtbdr1yhPGNWhPO9yDx05
bD+5rjcCgYEA0aSZJBrOYddx0ji3C+f3JAyhQsV2pDwx2r99FVKGVFyG3HdwQciW
WjQSNnE12tm3LuCmiEErJr5xuptMXDaICuAJhyM16uyIkCJ6KCiYX77IcOqPBNtn
aT8sGgoOLTb7tkdCaoDItfL8sWlRvE1g24ry/rZyJZ4zDfWzh869nM8CgYEAy7uL
WQ4xxDed8Nc14+u5n61JJ3LpwKzUdWGiEB1IVzxyT77AN5kFVHBRXGmFLjou0iA2
xW+7SRMnMpC6xTyVioTpSPNsf7cmXYRyuTT7aV+/C4hyIgXDJCDKzd3W6/I86gXU
LI+9zOoklHoSBa/yOBMBBOlGdvZ/on/rpoGldkMCgYEA0R5MOEyZA9Yhzp4OUU0R
JJ+ImI9aWldFL7wFbKiGIE6vo+lsS+JnwBDi/fWN0AGOja8/zviar6oWzhqtX+px
Z8+1EV0ZIn7Rdl091yMvY4pubNw8z46AJ+cA+fR/0bBgA6IvaQePrpd0Yw/4nUne
TQDchSG+2TFmIg2uCNE8KNcCgYEAlvTv25zY4zsSnFHabHdNozMS8VgEO+/TvOYK
30XTRFBVoyED7C5F9LsEjiThuc8Cwk98Re70JsE6Wg1DVsH9TBYPhS5ZRoi+tKxf
FTxczUdUl4cSioMahLqHiuLFTS7AU+bdv+cCC8OyNxH8KJqmL0Zliu4OeDdNe2qt
gUKvB2ECgYEAk7nhlRphHCzNG496WURcVh9IWnle42X8WD6Ea+UWFY7mGLpTGDDd
ShsvpFNoypKKPZfrQrZdKJ6QnwX8jRSL0X9uKT8z7ey0zFM4OOxCmUmoM2Fk5BwD
8SMSuhPm1cKUhmSvOh7yK+f9/WVipjeLZoMUWoZZAqiFoh2+NQVRmrA=
-----END RSA PRIVATE KEY-----"#;

fn client() -> FusionAuthClient {
    FusionAuthClient::new(
        "api-key".into(),
        "fusionauth-client-id".into(),
        "fusionauth-client-secret".into(),
        "http://fusionauth:9011".into(),
        "http://localhost:28011/oauth/redirect".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    )
}

fn microsoft_client() -> FusionAuthClient {
    client().with_microsoft_credentials(
        "microsoft-client-id".into(),
        "microsoft-client-secret".into(),
        "microsoft-tenant-id".into(),
    )
}

fn signing_keys() -> oauth::MicrosoftSigningKeys {
    oauth::MicrosoftSigningKeys {
        issuer: "https://login.microsoftonline.com/microsoft-tenant-id/v2.0".into(),
        keys: vec![oauth::MicrosoftJsonWebKey {
            kid: TEST_KEY_ID.into(),
            kty: "RSA".into(),
            n: TEST_MODULUS.into(),
            e: "AQAB".into(),
        }],
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn valid_claims() -> serde_json::Value {
    serde_json::json!({
        "iss": "https://login.microsoftonline.com/microsoft-tenant-id/v2.0",
        "aud": "microsoft-client-id",
        "tid": "microsoft-tenant-id",
        "sub": "microsoft-user-id",
        "email": "email@example.com",
        "exp": now() + 3600,
        "nbf": now() - 300,
    })
}

fn signed_id_token(private_key: &str, kid: &str, claims: &serde_json::Value) -> String {
    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    header.kid = Some(kid.to_string());
    jsonwebtoken::encode(
        &header,
        claims,
        &jsonwebtoken::EncodingKey::from_rsa_pem(private_key.as_bytes()).unwrap(),
    )
    .unwrap()
}

fn decode_id_token(token: &str) -> anyhow::Result<oauth::MicrosoftUserInfo> {
    oauth::decode_microsoft_id_token(
        token,
        &signing_keys(),
        "microsoft-client-id",
        "microsoft-tenant-id",
    )
}

#[test]
fn authorize_url_uses_configured_tenant_and_secondary_account_parameters() {
    let url = microsoft_client()
        .construct_microsoft_authorize_url(
            "https://auth.example.com/oauth2/microsoft/callback",
            &"state",
        )
        .unwrap();
    let url = reqwest::Url::parse(&url).unwrap();
    let query: HashMap<_, _> = url.query_pairs().into_owned().collect();

    assert_eq!(
        url.as_str().split('?').next().unwrap(),
        "https://login.microsoftonline.com/microsoft-tenant-id/oauth2/v2.0/authorize"
    );
    assert_eq!(query.get("client_id").unwrap(), "microsoft-client-id");
    assert_eq!(
        query.get("redirect_uri").unwrap(),
        "https://auth.example.com/oauth2/microsoft/callback"
    );
    assert_eq!(query.get("response_type").unwrap(), "code");
    assert_eq!(
        query.get("scope").unwrap(),
        "openid email offline_access profile Mail.ReadWrite Mail.Send"
    );
    assert_eq!(query.get("prompt").unwrap(), "select_account");
}

#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
struct TestState {
    identity_provider_id: String,
    link_id: String,
}

#[test]
fn authorize_url_serializes_state_as_json() {
    let state = TestState {
        identity_provider_id: "identity-provider-id".into(),
        link_id: "link-id".into(),
    };
    let url = microsoft_client()
        .construct_microsoft_authorize_url(
            "https://auth.example.com/oauth2/microsoft/callback",
            &state,
        )
        .unwrap();
    let url = reqwest::Url::parse(&url).unwrap();
    let serialized_state = url
        .query_pairs()
        .find_map(|(key, value)| (key == "state").then(|| value.into_owned()))
        .unwrap();

    assert_eq!(
        serde_json::from_str::<TestState>(&serialized_state).unwrap(),
        state
    );
}

#[test]
fn microsoft_oauth_configuration_is_optional_and_secret_is_redacted() {
    let error = client()
        .construct_microsoft_authorize_url(
            "https://auth.example.com/oauth2/microsoft/callback",
            &"state",
        )
        .unwrap_err();
    assert!(matches!(
        error,
        FusionAuthClientError::MicrosoftOAuthNotConfigured
    ));

    let client = microsoft_client();
    let cloned_client = client.clone();
    assert!(!format!("{client:?}").contains("microsoft-client-secret"));
    cloned_client
        .construct_microsoft_authorize_url(
            "https://auth.example.com/oauth2/microsoft/callback",
            &"state",
        )
        .unwrap();
}

#[test]
fn id_token_claims_are_validated_and_email_is_preferred() {
    let mut claims = valid_claims();
    claims["preferred_username"] = serde_json::json!("username@example.com");
    let token = signed_id_token(TEST_PRIVATE_KEY, TEST_KEY_ID, &claims);

    let user = decode_id_token(&token).unwrap();

    assert_eq!(user.sub, "microsoft-user-id");
    assert_eq!(user.email, "email@example.com");
}

#[test]
fn id_token_uses_preferred_username_when_email_is_absent() {
    let mut claims = valid_claims();
    claims["email"] = serde_json::Value::Null;
    claims["preferred_username"] = serde_json::json!("username@example.com");
    let token = signed_id_token(TEST_PRIVATE_KEY, TEST_KEY_ID, &claims);

    let user = decode_id_token(&token).unwrap();

    assert_eq!(user.email, "username@example.com");
}

#[test]
fn id_token_rejects_invalid_claims() {
    for (claim, invalid_value) in [
        ("iss", serde_json::json!("https://evil.example.com/v2.0")),
        ("aud", serde_json::json!("another-client")),
        ("tid", serde_json::json!("another-tenant")),
        ("sub", serde_json::json!("")),
        ("email", serde_json::Value::Null),
        ("exp", serde_json::json!(now() - 3600)),
        ("exp", serde_json::Value::Null),
        ("nbf", serde_json::json!(now() + 3600)),
        ("nbf", serde_json::Value::Null),
    ] {
        let mut claims = valid_claims();
        claims[claim] = invalid_value;
        let token = signed_id_token(TEST_PRIVATE_KEY, TEST_KEY_ID, &claims);

        assert!(
            decode_id_token(&token).is_err(),
            "claim {claim} should have been rejected"
        );
    }
}

#[test]
fn id_token_rejects_invalid_signatures() {
    // Signed by a key the tenant does not advertise, while claiming the trusted key ID.
    let forged = signed_id_token(OTHER_PRIVATE_KEY, TEST_KEY_ID, &valid_claims());
    assert!(decode_id_token(&forged).is_err());

    // Signed with an unknown key ID.
    let unknown_kid = signed_id_token(TEST_PRIVATE_KEY, "unknown-key", &valid_claims());
    assert!(decode_id_token(&unknown_kid).is_err());

    // Valid token whose signature has been stripped.
    let valid = signed_id_token(TEST_PRIVATE_KEY, TEST_KEY_ID, &valid_claims());
    let mut parts = valid.split('.');
    let (header, payload) = (parts.next().unwrap(), parts.next().unwrap());
    assert!(decode_id_token(&format!("{header}.{payload}.")).is_err());

    // Unsigned token claiming the "none" algorithm.
    let none_header = URL_SAFE_NO_PAD.encode(format!(r#"{{"alg":"none","kid":"{TEST_KEY_ID}"}}"#));
    assert!(decode_id_token(&format!("{none_header}.{payload}.signature")).is_err());

    // Token signed with a symmetric algorithm using the trusted key ID.
    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256);
    header.kid = Some(TEST_KEY_ID.to_string());
    let symmetric = jsonwebtoken::encode(
        &header,
        &valid_claims(),
        &jsonwebtoken::EncodingKey::from_secret(TEST_MODULUS.as_bytes()),
    )
    .unwrap();
    assert!(decode_id_token(&symmetric).is_err());
}

#[tokio::test]
async fn signing_keys_are_fetched_through_oidc_discovery() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/microsoft-tenant-id/v2.0/.well-known/openid-configuration",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "issuer": "https://login.microsoftonline.com/microsoft-tenant-id/v2.0",
            "jwks_uri": format!("{}/microsoft-tenant-id/discovery/v2.0/keys", server.uri()),
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/microsoft-tenant-id/discovery/v2.0/keys"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "keys": [{
                "kid": TEST_KEY_ID,
                "kty": "RSA",
                "use": "sig",
                "n": TEST_MODULUS,
                "e": "AQAB",
            }]
        })))
        .mount(&server)
        .await;

    let signing_keys = oauth::fetch_microsoft_signing_keys(
        &UnauthedClient::default(),
        &server.uri(),
        "microsoft-tenant-id",
    )
    .await
    .unwrap();

    assert_eq!(
        signing_keys.issuer,
        "https://login.microsoftonline.com/microsoft-tenant-id/v2.0"
    );
    let token = signed_id_token(TEST_PRIVATE_KEY, TEST_KEY_ID, &valid_claims());
    let user = oauth::decode_microsoft_id_token(
        &token,
        &signing_keys,
        "microsoft-client-id",
        "microsoft-tenant-id",
    )
    .unwrap();
    assert_eq!(user.sub, "microsoft-user-id");
}

#[tokio::test]
async fn signing_key_fetch_rejects_an_empty_key_set() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/microsoft-tenant-id/v2.0/.well-known/openid-configuration",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "issuer": "https://login.microsoftonline.com/microsoft-tenant-id/v2.0",
            "jwks_uri": format!("{}/microsoft-tenant-id/discovery/v2.0/keys", server.uri()),
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/microsoft-tenant-id/discovery/v2.0/keys"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({ "keys": [] })))
        .mount(&server)
        .await;

    let error = oauth::fetch_microsoft_signing_keys(
        &UnauthedClient::default(),
        &server.uri(),
        "microsoft-tenant-id",
    )
    .await
    .unwrap_err();

    assert!(
        error
            .to_string()
            .contains("did not contain any signing keys")
    );
}
