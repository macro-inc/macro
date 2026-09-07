use super::*;
use sqlx::PgPool;

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
async fn standalone_highlight_remains_unthreaded_until_a_message_attaches_it(pool: PgPool) {
    let request = serde_json::from_value(serde_json::json!({
        "fileType": "pdf", "anchorType": "highlight", "page": 3,
        "red": 1, "green": 2, "blue": 3, "alpha": 0.5, "highlightType": 1,
        "text": "Selection", "pageViewportWidth": 600, "pageViewportHeight": 800,
        "highlightRects": [{"top": 0.2, "left": 0.3, "width": 0.4, "height": 0.02}]
    }))
    .unwrap();
    let response = create_unthreaded_anchor(
        &pool,
        "macro|user@user.com",
        "document-with-comments",
        request,
    )
    .await
    .unwrap();
    let Anchor::Pdf(PdfAnchor::Highlight(anchor)) = response.anchor else {
        panic!("expected highlight")
    };
    assert!(anchor.thread_id.is_none());
    assert_eq!(anchor.highlight_rects.len(), 1);
    assert_eq!((anchor.page, anchor.red, anchor.alpha), (3, 1, 0.5));
    use messages::domain::{models::*, ports::*};
    let repo = messages::outbound::pg_message_repo::PgMessageRepository::new(pool.clone());
    let root = repo
        .create(CreateMessage {
            parent: MessageParent::parse("document", "document-with-comments").unwrap(),
            actor: "macro|user@user.com".to_owned().try_into().unwrap(),
            triggered_by: None,
            input: PostMessage {
                attribution: Default::default(),
                content: "Comment on selection".into(),
                thread_id: None,
                anchor: Some(NewThreadAnchor::PdfHighlight {
                    anchor_id: anchor.uuid,
                }),
                mentions: vec![],
                attachments: vec![],
                nonce: None,
            },
        })
        .await
        .unwrap();
    let highlights =
        crate::annotations::get::fetch_pdf_highlight_anchors(&pool, "document-with-comments")
            .await
            .unwrap();
    assert_eq!(
        highlights
            .iter()
            .find(|a| a.uuid == anchor.uuid)
            .unwrap()
            .thread_id,
        Some(root.id)
    );
}
