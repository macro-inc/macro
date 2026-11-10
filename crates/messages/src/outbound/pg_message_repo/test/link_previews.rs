use super::*;

const ARTICLE: &str = "https://news.example.com/post";
const GUIDE: &str = "https://docs.example.org/guide";

fn preview(url: &str, title: &str, description: Option<&str>) -> LinkPreview {
    LinkPreview {
        url: url.to_string(),
        title: title.to_string(),
        description: description.map(str::to_string),
        image_url: None,
        favicon_url: Some(format!("{url}/favicon.ico")),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn link_previews_replace_in_order_only_while_the_text_is_unchanged(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let message = repo
        .create(command(
            "message-doc-a",
            None,
            &format!("read {GUIDE} then {ARTICLE}"),
        ))
        .await
        .unwrap();
    assert!(message.link_previews.is_empty());
    let parent = message.parent.clone();

    let both = vec![
        preview(GUIDE, "Guide", None),
        preview(ARTICLE, "Article", Some("What we learned")),
    ];
    let updated = repo
        .replace_link_previews(&parent, message.id, &message.content, &both)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(updated.link_previews, both);
    let read = repo.get(&parent, message.id).await.unwrap().unwrap();
    assert_eq!(read.link_previews, both);

    let one = vec![preview(ARTICLE, "Article", None)];
    repo.replace_link_previews(&parent, message.id, &message.content, &one)
        .await
        .unwrap()
        .unwrap();

    // A refresh of text the message no longer has leaves the newer set.
    let stale = repo
        .replace_link_previews(&parent, message.id, "an older draft", &both)
        .await
        .unwrap();
    assert!(stale.is_none());
    let read = repo.get(&parent, message.id).await.unwrap().unwrap();
    assert_eq!(read.link_previews, one);

    // A tombstone shows no previews and takes no new ones.
    repo.delete(&parent, message.id).await.unwrap();
    let deleted = repo.get(&parent, message.id).await.unwrap().unwrap();
    assert!(deleted.link_previews.is_empty());
    let refused = repo
        .replace_link_previews(&parent, message.id, &deleted.content, &both)
        .await
        .unwrap();
    assert!(refused.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn suppressed_link_previews_are_deleted_and_never_stored_again(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let message = repo
        .create(command("message-doc-a", None, &format!("read {ARTICLE}")))
        .await
        .unwrap();
    let parent = message.parent.clone();
    let article = vec![preview(ARTICLE, "Article", None)];
    repo.replace_link_previews(&parent, message.id, &message.content, &article)
        .await
        .unwrap()
        .unwrap();
    assert!(
        !repo
            .link_previews_suppressed(&parent, message.id)
            .await
            .unwrap()
    );

    let suppressed = repo
        .suppress_link_previews(&parent, message.id)
        .await
        .unwrap();
    assert!(suppressed.link_previews.is_empty());
    assert_eq!(suppressed.content, message.content);
    assert!(
        repo.link_previews_suppressed(&parent, message.id)
            .await
            .unwrap()
    );

    // A refresh that read the message before the removal stores nothing.
    let refused = repo
        .replace_link_previews(&parent, message.id, &message.content, &article)
        .await
        .unwrap();
    assert!(refused.is_none());
    let read = repo.get(&parent, message.id).await.unwrap().unwrap();
    assert!(read.link_previews.is_empty());

    // Removing again changes nothing; a deleted message can't be changed.
    repo.suppress_link_previews(&parent, message.id)
        .await
        .unwrap();
    repo.delete(&parent, message.id).await.unwrap();
    let gone = repo.suppress_link_previews(&parent, message.id).await;
    assert!(matches!(gone, Err(MessageError::NotFound)));
}
