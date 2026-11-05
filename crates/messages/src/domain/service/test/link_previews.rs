use super::*;

const ARTICLE: &str = "https://news.example.com/post";
const GUIDE: &str = "https://docs.example.org/guide";
const DEAD: &str = "https://gone.example.net";

/// Returns the same links for any content.
struct Links(Vec<&'static str>);
impl MessageLinkExtractor for Links {
    fn extract<'a>(
        &'a self,
        _: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<Vec<String>, MessageError>> + Send + 'a>>
    {
        let urls = self.0.iter().map(ToString::to_string).collect();
        Box::pin(async move { Ok(urls) })
    }
}

/// Every page but [`DEAD`] has a preview titled after its URL.
#[derive(Clone, Default)]
struct Pages(Arc<Mutex<Vec<String>>>);
impl LinkPreviewFetcher for Pages {
    fn fetch<'a>(
        &'a self,
        url: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<LinkPreview>> + Send + 'a>> {
        self.0.lock().unwrap().push(url.to_string());
        Box::pin(async move { (url != DEAD).then(|| preview(url, "fetched")) })
    }
}

fn preview(url: &str, title: &str) -> LinkPreview {
    LinkPreview {
        url: url.to_string(),
        title: title.to_string(),
        description: None,
        image_url: None,
        favicon_url: None,
    }
}

fn channel_repo(stored: Vec<LinkPreview>) -> Repo {
    let repo = fixture();
    Repo {
        message: Message {
            parent: MessageParent::Channel(Uuid::from_u128(7)),
            content: format!("read {ARTICLE} and {GUIDE}"),
            link_previews: stored,
            ..repo.message.clone()
        },
        ..repo
    }
}

fn service(
    repo: Repo,
    links: Vec<&'static str>,
    pages: Pages,
    events: Events,
) -> MessageService<Repo, Events> {
    MessageService::new(repo, events).with_link_previews(Links(links), pages)
}

#[tokio::test]
async fn a_channel_message_stores_its_link_previews_in_text_order_and_tells_viewers() {
    let repo = channel_repo(vec![]);
    let events = Events::default();
    let message = repo.message.clone();
    service(
        repo.clone(),
        vec![ARTICLE, DEAD, GUIDE],
        Pages::default(),
        events.clone(),
    )
    .refresh_link_previews(&message.parent, message.id)
    .await
    .unwrap();

    let expected = vec![preview(ARTICLE, "fetched"), preview(GUIDE, "fetched")];
    assert_eq!(
        *repo.link_preview_writes.lock().unwrap(),
        vec![expected.clone()]
    );
    let events = events.0.lock().unwrap();
    let [event] = events.as_slice() else {
        panic!("expected one event, got {events:?}");
    };
    assert_eq!(event.nonce, None);
    assert_eq!(event.actor, message.sender_id.as_ref());
    let MessageChange::LinkPreviewsUpdated { message: updated } = &event.change else {
        panic!("expected a link preview update, got {:?}", event.change);
    };
    assert_eq!(updated.link_previews, expected);
}

#[tokio::test]
async fn a_link_keeps_its_stored_preview_and_only_new_links_are_fetched() {
    let repo = channel_repo(vec![preview(ARTICLE, "stored")]);
    let pages = Pages::default();
    let message = repo.message.clone();
    service(
        repo.clone(),
        vec![ARTICLE, GUIDE],
        pages.clone(),
        Events::default(),
    )
    .refresh_link_previews(&message.parent, message.id)
    .await
    .unwrap();

    assert_eq!(*pages.0.lock().unwrap(), vec![GUIDE.to_string()]);
    assert_eq!(
        *repo.link_preview_writes.lock().unwrap(),
        vec![vec![preview(ARTICLE, "stored"), preview(GUIDE, "fetched")]]
    );
}

#[tokio::test]
async fn a_repeated_refresh_writes_and_publishes_nothing() {
    let repo = channel_repo(vec![preview(ARTICLE, "stored")]);
    let events = Events::default();
    let message = repo.message.clone();
    service(
        repo.clone(),
        vec![ARTICLE],
        Pages::default(),
        events.clone(),
    )
    .refresh_link_previews(&message.parent, message.id)
    .await
    .unwrap();

    assert!(repo.link_preview_writes.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn removing_every_link_clears_the_stored_previews() {
    let repo = channel_repo(vec![preview(ARTICLE, "stored")]);
    let events = Events::default();
    let message = repo.message.clone();
    service(repo.clone(), vec![], Pages::default(), events.clone())
        .refresh_link_previews(&message.parent, message.id)
        .await
        .unwrap();

    assert_eq!(*repo.link_preview_writes.lock().unwrap(), vec![vec![]]);
    assert_eq!(events.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn only_live_channel_messages_get_previews() {
    let discussion = fixture();
    let pages = Pages::default();
    let message = discussion.message.clone();
    service(
        discussion.clone(),
        vec![ARTICLE],
        pages.clone(),
        Events::default(),
    )
    .refresh_link_previews(&message.parent, message.id)
    .await
    .unwrap();

    let deleted = channel_repo(vec![]);
    let deleted = Repo {
        message: Message {
            deleted_at: Some(Utc::now()),
            ..deleted.message.clone()
        },
        ..deleted
    };
    let message = deleted.message.clone();
    service(
        deleted.clone(),
        vec![ARTICLE],
        pages.clone(),
        Events::default(),
    )
    .refresh_link_previews(&message.parent, message.id)
    .await
    .unwrap();

    assert!(pages.0.lock().unwrap().is_empty());
    assert!(discussion.link_preview_writes.lock().unwrap().is_empty());
    assert!(deleted.link_preview_writes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_service_without_link_previews_leaves_messages_alone() {
    let repo = channel_repo(vec![]);
    let message = repo.message.clone();
    MessageService::new(repo.clone(), Events::default())
        .refresh_link_previews(&message.parent, message.id)
        .await
        .unwrap();

    assert!(repo.link_preview_writes.lock().unwrap().is_empty());
}
