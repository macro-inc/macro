use super::*;
use macro_user_id::user_id::MacroUserIdStr;

struct Source;
impl AgentSessionSearchSource for Source {
    async fn accessible(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        _: &[Uuid],
    ) -> Result<Vec<AgentSessionSearchMetadata>, Report> {
        if user.as_ref() == "macro|stranger@example.com" {
            return Ok(Vec::new());
        }
        Ok(vec![AgentSessionSearchMetadata {
            id: Uuid::from_u128(1),
            name: "Shared session".into(),
            owner_id: MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
            bot_id: Uuid::from_u128(2),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }])
    }
}

#[tokio::test]
async fn grants_allow_channel_viewers_without_requiring_ownership() {
    let service = AgentSessionSearchService(Source);
    let viewer = MacroUserId::parse_from_str("macro|viewer@example.com")
        .unwrap()
        .lowercase();
    assert_eq!(
        service
            .scope(&viewer, &[], &[], true, false)
            .await
            .unwrap()
            .len(),
        1
    );
    let stranger = MacroUserId::parse_from_str("macro|stranger@example.com")
        .unwrap()
        .lowercase();
    assert!(
        service
            .scope(&stranger, &[], &[], true, false)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn exclusion_requested_ids_owners_and_tags_cannot_broaden_access() {
    let service = AgentSessionSearchService(Source);
    let viewer = MacroUserId::parse_from_str("macro|viewer@example.com")
        .unwrap()
        .lowercase();
    for (ids, owners, enabled, tags) in [
        (vec![], vec![], false, false),
        (vec![], vec![], true, true),
        (vec![Uuid::nil()], vec![], true, false),
        (vec![Uuid::from_u128(9)], vec![], true, false),
        (vec![], vec!["macro|other@example.com".into()], true, false),
    ] {
        assert!(
            service
                .scope(&viewer, &ids, &owners, enabled, tags)
                .await
                .unwrap()
                .is_empty()
        );
    }
}
