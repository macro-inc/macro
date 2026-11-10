use std::{future::Future, pin::Pin, sync::Arc};

use ideas::domain::{
    model::{Idea, IdeaCaller, IdeaError, Ideas},
    ports::IdeaApi,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

/// A boxed ideas call.
pub type IdeaFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, IdeaError>> + Send + 'a>>;

/// Ideas as GraphQL serves them. Object-safe, so request data does not carry
/// the service's type parameters.
pub trait IdeasGraphql: Send + Sync {
    /// The user's feed; `NotFound` when ideas are off for them.
    fn feed(&self, user: MacroUserIdStr<'static>) -> IdeaFuture<'_, Ideas>;

    /// The user opened the app in `timezone`.
    fn seen(&self, user: MacroUserIdStr<'static>, timezone: chrono_tz::Tz) -> IdeaFuture<'_, ()>;

    /// The user acts on idea `id`; the idea as that left it.
    fn accept(&self, user: MacroUserIdStr<'static>, id: Uuid) -> IdeaFuture<'_, Idea>;

    /// The user isn't interested in idea `id`; the idea as that left it.
    fn dismiss(&self, user: MacroUserIdStr<'static>, id: Uuid) -> IdeaFuture<'_, Idea>;
}

/// Type-erased ideas service stored in GraphQL request data.
#[derive(Clone)]
pub struct IdeasGraphqlContext(pub Arc<dyn IdeasGraphql>);

impl IdeasGraphqlContext {
    /// Erase `service` so request data does not carry its type parameters.
    pub fn new<S: IdeaApi>(service: Arc<S>) -> Self {
        Self(Arc::new(ServiceIdeas { service }))
    }
}

struct ServiceIdeas<S> {
    service: Arc<S>,
}

impl<S: IdeaApi> ServiceIdeas<S> {
    /// The person's idea `id` as the feed shows it.
    async fn shown(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<Idea, IdeaError> {
        self.service
            .feed(user, IdeaCaller::User, None)
            .await?
            .ideas
            .into_iter()
            .find(|idea| idea.id == id)
            .ok_or(IdeaError::NotFound)
    }
}

impl<S: IdeaApi> IdeasGraphql for ServiceIdeas<S> {
    fn feed(&self, user: MacroUserIdStr<'static>) -> IdeaFuture<'_, Ideas> {
        Box::pin(async move { self.service.feed(&user, IdeaCaller::User, None).await })
    }

    fn seen(&self, user: MacroUserIdStr<'static>, timezone: chrono_tz::Tz) -> IdeaFuture<'_, ()> {
        Box::pin(async move {
            self.service
                .feed(&user, IdeaCaller::User, Some(timezone))
                .await
                .map(|_| ())
        })
    }

    fn accept(&self, user: MacroUserIdStr<'static>, id: Uuid) -> IdeaFuture<'_, Idea> {
        Box::pin(async move {
            self.service.accept(&user, IdeaCaller::User, id).await?;
            self.shown(&user, id).await
        })
    }

    fn dismiss(&self, user: MacroUserIdStr<'static>, id: Uuid) -> IdeaFuture<'_, Idea> {
        Box::pin(async move {
            let mut idea = self.shown(&user, id).await?;
            self.service.dismiss(&user, IdeaCaller::User, id).await?;
            // A dismissed idea leaves the feed, so it is answered as it stood
            // with the state the write just committed.
            idea.state = ideas::domain::model::IdeaState::Dismissed;
            idea.state_changed_at = chrono::Utc::now();
            Ok(idea)
        })
    }
}
