use super::*;

#[tokio::test]
async fn capture_keeps_verb_only_with_its_correlation() {
    let id = Uuid::now_v7();
    let child = scope_with_verb(Some(id), Some(AgentVerb::Edited), async {
        tokio::spawn(capture(async { (current(), current_verb()) }))
    })
    .await;
    assert_eq!(child.await.unwrap(), (Some(id), Some(AgentVerb::Edited)));
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
