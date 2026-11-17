use super::*;
use std::sync::Mutex;

/// Records whom each token was minted for.
#[derive(Default)]
struct RecordingTokens {
    minted: Mutex<Vec<(String, BotId, uuid::Uuid)>>,
}

impl MacroApiTokens for &RecordingTokens {
    async fn mint(
        &self,
        owner: &MacroUserIdStr<'static>,
        agent: BotId,
        session: uuid::Uuid,
    ) -> Result<String, EgressError> {
        self.minted
            .lock()
            .expect("lock")
            .push((owner.to_string(), agent, session));
        Ok("minted-token".to_owned())
    }
}

#[tokio::test]
async fn an_endpoint_keeps_the_gateway_prefix_and_carries_a_token_for_the_user() {
    let tokens = RecordingTokens::default();
    let calls = StorageArtifactCalls::new(
        &tokens,
        &Url::parse("https://gateway.macro.com/dss/").expect("url"),
        false,
    )
    .expect("https is accepted");
    let user = MacroUserIdStr::try_from_email("teammate@macro.com").expect("user");
    let id = macro_uuid::Uuid::parse_str("0198a7b2-6c1d-7f00-8000-000000000001").expect("uuid");
    let session = uuid::Uuid::from_u128(7);

    let call = calls
        .resolve(&user, BotId::TEST_A, session, ArtifactEndpoint::Uploads(id))
        .await
        .expect("resolved");

    assert_eq!(
        call.url().as_str(),
        "https://gateway.macro.com/dss/artifacts/0198a7b2-6c1d-7f00-8000-000000000001/uploads"
    );
    assert_eq!(
        call.authorization()
            .header_value()
            .expect("renders")
            .expect("a credential"),
        "Bearer minted-token"
    );
    assert_eq!(
        *tokens.minted.lock().expect("lock"),
        vec![(
            "macro|teammate@macro.com".to_owned(),
            BotId::TEST_A,
            session
        )]
    );
}

#[test]
fn a_cleartext_storage_url_is_refused_outside_a_local_stack() {
    let tokens = RecordingTokens::default();

    let refused = StorageArtifactCalls::new(
        &tokens,
        &Url::parse("http://localhost:8086").expect("url"),
        false,
    );

    assert!(matches!(refused, Err(EgressError::InsecureUpstream(_))));
}
