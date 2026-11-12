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

const AUTHOR: &str = "macro|author@example.com";

/// Link previews for these people only. Remembers whom it was asked about.
#[derive(Clone)]
struct People {
    on: Vec<&'static str>,
    asked: Arc<Mutex<Vec<String>>>,
}
impl People {
    fn on(on: Vec<&'static str>) -> Self {
        Self {
            on,
            asked: Arc::default(),
        }
    }
}
impl LinkPreviewGate for People {
    fn enabled_for<'a>(
        &'a self,
        person: &'a macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> std::pin::Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        self.asked.lock().unwrap().push(person.to_string());
        let enabled = self.on.contains(&person.as_ref());
        Box::pin(async move { enabled })
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

/// Link previews on for the fixture message's author.
fn service(
    repo: Repo,
    links: Vec<&'static str>,
    pages: Pages,
    events: Events,
) -> MessageService<Repo, Events> {
    gated_service(repo, links, pages, events, People::on(vec![AUTHOR]))
}

fn gated_service(
    repo: Repo,
    links: Vec<&'static str>,
    pages: Pages,
    events: Events,
    people: People,
) -> MessageService<Repo, Events> {
    MessageService::new(repo, events).with_link_previews(Links(links), pages, people)
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

/// A member of the channel [`channel_repo`]'s message is in.
fn channel_member(user: &str) -> EntityAccessReceipt<MessageWrite> {
    channel_receipt(user, entity_access::domain::models::ParticipantRole::Member)
}

fn channel_receipt(
    user: &str,
    role: entity_access::domain::models::ParticipantRole,
) -> EntityAccessReceipt<MessageWrite> {
    EntityAccessReceipt::try_new_authenticated_user(
        user.to_string().try_into().unwrap(),
        entity_access::domain::models::Entity {
            entity_type: EntityType::Channel,
            entity_id: Uuid::from_u128(7).to_string(),
        },
        EntityPermission::ChannelRole { role },
    )
    .unwrap()
}

#[tokio::test]
async fn the_sender_removes_their_previews_for_everyone_and_for_good() {
    let repo = channel_repo(vec![preview(ARTICLE, "stored")]);
    let events = Events::default();
    let pages = Pages::default();
    let message = repo.message.clone();
    let service = service(
        repo.clone(),
        vec![ARTICLE, GUIDE],
        pages.clone(),
        events.clone(),
    );

    let removed = service
        .remove_link_previews(channel_member(AUTHOR), message.id)
        .await
        .unwrap();

    assert_eq!(removed.link_previews, vec![]);
    {
        let events = events.0.lock().unwrap();
        let [event] = events.as_slice() else {
            panic!("expected one event, got {events:?}");
        };
        assert_eq!(event.actor, message.sender_id.as_ref());
        let MessageChange::LinkPreviewsUpdated { message: updated } = &event.change else {
            panic!("expected a link preview update, got {:?}", event.change);
        };
        assert_eq!(updated.link_previews, vec![]);
    }

    // A later edit's refresh reads no page and stores nothing, whatever it links.
    service
        .refresh_link_previews(&message.parent, message.id)
        .await
        .unwrap();
    assert!(pages.0.lock().unwrap().is_empty());
    assert!(repo.link_preview_writes.lock().unwrap().is_empty());
    assert_eq!(events.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn nobody_but_the_sender_removes_a_messages_previews() {
    let admin = "macro|admin@example.com";
    let repo = channel_repo(vec![preview(ARTICLE, "stored")]);
    let events = Events::default();
    let message = repo.message.clone();
    let service = gated_service(
        repo.clone(),
        vec![ARTICLE],
        Pages::default(),
        events.clone(),
        People::on(vec![AUTHOR, admin]),
    );

    // A channel admin may edit and delete the message, but not this.
    let result = service
        .remove_link_previews(
            channel_receipt(admin, entity_access::domain::models::ParticipantRole::Admin),
            message.id,
        )
        .await;

    assert!(matches!(result, Err(MessageError::Forbidden)));
    assert!(!*repo.link_previews_suppressed.lock().unwrap());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_author_without_link_previews_gets_none() {
    let repo = channel_repo(vec![]);
    let pages = Pages::default();
    let people = People::on(vec![]);
    let message = repo.message.clone();
    gated_service(
        repo.clone(),
        vec![ARTICLE],
        pages.clone(),
        Events::default(),
        people.clone(),
    )
    .refresh_link_previews(&message.parent, message.id)
    .await
    .unwrap();

    assert_eq!(*people.asked.lock().unwrap(), vec![AUTHOR.to_string()]);
    assert!(pages.0.lock().unwrap().is_empty());
    assert!(repo.link_preview_writes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_bot_reply_follows_the_person_who_triggered_it() {
    let trigger = "macro|asker@example.com";
    let mut repo = channel_repo(vec![]);
    repo.message.sender_id = ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID);
    repo.message.triggered_by = Some(trigger.to_string());
    let people = People::on(vec![trigger]);
    let message = repo.message.clone();
    gated_service(
        repo.clone(),
        vec![ARTICLE],
        Pages::default(),
        Events::default(),
        people.clone(),
    )
    .refresh_link_previews(&message.parent, message.id)
    .await
    .unwrap();

    assert_eq!(*people.asked.lock().unwrap(), vec![trigger.to_string()]);
    assert_eq!(
        *repo.link_preview_writes.lock().unwrap(),
        vec![vec![preview(ARTICLE, "fetched")]]
    );
}

#[tokio::test]
async fn an_unprompted_bot_post_gets_none() {
    let mut repo = channel_repo(vec![]);
    repo.message.sender_id = ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID);
    let people = People::on(vec![AUTHOR]);
    let pages = Pages::default();
    let message = repo.message.clone();
    gated_service(
        repo.clone(),
        vec![ARTICLE],
        pages.clone(),
        Events::default(),
        people.clone(),
    )
    .refresh_link_previews(&message.parent, message.id)
    .await
    .unwrap();

    assert!(people.asked.lock().unwrap().is_empty());
    assert!(pages.0.lock().unwrap().is_empty());
    assert!(repo.link_preview_writes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn removing_previews_is_not_found_for_a_sender_without_link_previews() {
    let repo = channel_repo(vec![preview(ARTICLE, "stored")]);
    let events = Events::default();
    let message = repo.message.clone();
    let service = gated_service(
        repo.clone(),
        vec![ARTICLE],
        Pages::default(),
        events.clone(),
        People::on(vec![]),
    );

    let result = service
        .remove_link_previews(channel_member(AUTHOR), message.id)
        .await;

    assert!(matches!(result, Err(MessageError::NotFound)));
    assert!(!*repo.link_previews_suppressed.lock().unwrap());
    assert!(events.0.lock().unwrap().is_empty());
}
