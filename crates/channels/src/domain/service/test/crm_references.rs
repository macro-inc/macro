use super::*;

#[tokio::test]
async fn crm_references_require_current_target_access() {
    for kind in ["crm_company", "crm_contact", "crm_pipeline"] {
        for allowed in [true, false, true] {
            let repo = if allowed {
                references_repo()
            } else {
                empty_repo()
            };
            let access = FakeCommentParentAccess(if allowed {
                vec![(kind, "target")]
            } else {
                vec![]
            });
            let service =
                ChannelServiceImpl::new(repo).with_comment_parent_access(Arc::new(access));
            let references = service
                .get_attachment_references(
                    kind.into(),
                    "target".into(),
                    "macro|viewer@example.com".into(),
                )
                .await
                .unwrap();
            assert_eq!(references.is_empty(), !allowed);
        }
        let service = ChannelServiceImpl::new(empty_repo());
        assert!(
            service
                .get_attachment_references(
                    kind.into(),
                    "target".into(),
                    "macro|viewer@example.com".into()
                )
                .await
                .unwrap()
                .is_empty()
        );
    }
}
