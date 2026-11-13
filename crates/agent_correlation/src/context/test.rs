use super::*;

#[tokio::test]
async fn capture_keeps_verb_only_with_its_correlation() {
    let id = Uuid::now_v7();
    let child = scope_with_verb(Some(id), Some(AgentVerb::Edited), async {
        tokio::spawn(capture(async { (current(), current_verb()) })).await
    })
    .await;
    assert_eq!(child.unwrap(), (Some(id), Some(AgentVerb::Edited)));
    assert_eq!(current_verb(), None);
    scope_with_verb(Some(id), Some(AgentVerb::Edited), async {
        scope(None, async { assert_eq!(current_verb(), None) }).await;
        scope(Some(Uuid::now_v7()), async {
            assert_eq!(current_verb(), None)
        })
        .await;
        scope(Some(id), async {
            assert_eq!(current_verb(), Some(AgentVerb::Edited))
        })
        .await;
    })
    .await;
}

#[tokio::test]
async fn a_scoped_request_changes_no_sharing() {
    assert_eq!(refuse_sharing(true), Ok(()));
    for scope in [SessionScope::Generation, SessionScope::NoSend] {
        let scoped = Attribution {
            scope: Some(scope),
            ..Attribution::default()
        };
        scope_attribution(scoped, async {
            assert_eq!(refuse_sharing(true), Err(SharingRefused), "{scope:?}");
            assert_eq!(refuse_sharing(false), Ok(()), "{scope:?}");
        })
        .await;
    }
}
