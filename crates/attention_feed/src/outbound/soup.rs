//! Candidates from the Soup service's attention query.

use std::sync::Arc;

use cowlike::CowLike;
use email::domain::ports::EmailService;
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use models_soup::item::SoupItem;
use rootcause::Report;
use soup::domain::{
    models::{
        AttentionKeying, AttentionPagePosition, AttentionSoupPage, AttentionSoupRequest, SoupErr,
        SoupProjectionHydration,
    },
    ports::SoupService,
};
use uuid::Uuid;

use crate::domain::{
    models::{
        Candidate, CandidateKeying, CandidatePage, CandidateRead, CandidateRequest, EntityFacts,
        FeedPosition, FeedViewer, MailFacts,
    },
    ports::CandidateSource,
};

#[cfg(test)]
mod test;

/// Candidates from Soup's attention query, hydrated as Soup items. Reads
/// marked [`CandidateRead::Committed`] go to `committed`, which is `soup`
/// unless [`Self::with_committed_reads`] gives a primary-backed service.
pub struct SoupCandidateSource<S, E, C = S> {
    soup: S,
    committed: C,
    email: Arc<E>,
}

impl<S: Clone, E> SoupCandidateSource<S, E> {
    /// Create a source over the Soup service; the email service resolves the
    /// viewer's readable inboxes.
    pub fn new(soup: S, email: Arc<E>) -> Self {
        Self {
            committed: soup.clone(),
            soup,
            email,
        }
    }
}

impl<S, E, C> SoupCandidateSource<S, E, C> {
    /// Answer [`CandidateRead::Committed`] reads from `committed`, a Soup
    /// service over the primary, when `soup` reads a replica.
    pub fn with_committed_reads<P>(self, committed: P) -> SoupCandidateSource<S, E, P> {
        SoupCandidateSource {
            soup: self.soup,
            committed,
            email: self.email,
        }
    }
}

/// The one Soup read a candidate page makes. Every [`SoupService`] answers
/// it; the routing tests give each store a different answer.
pub trait AttentionPages: Send + Sync + 'static {
    /// See [`SoupService::get_attention_page`].
    fn attention_page(
        &self,
        req: AttentionSoupRequest,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> impl Future<Output = Result<AttentionSoupPage, SoupErr>> + Send;
}

impl<T: SoupService> AttentionPages for T {
    fn attention_page(
        &self,
        req: AttentionSoupRequest,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> impl Future<Output = Result<AttentionSoupPage, SoupErr>> + Send {
        self.get_attention_page(req, team_receipt)
    }
}

/// The inboxes whose mail a viewer's candidates may include. Every
/// [`EmailService`] answers it.
pub trait ViewerInboxes: Send + Sync + 'static {
    /// The ids of the inboxes `user` can read.
    fn inbox_ids(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;
}

impl<E: EmailService> ViewerInboxes for E {
    async fn inbox_ids(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<Uuid>, Report> {
        Ok(self
            .get_inboxes_for_macro_id(user.copied())
            .await
            .map_err(|error| rootcause::report!("failed to list inboxes: {error}"))?
            .into_iter()
            .map(|link| link.id)
            .collect())
    }
}

/// The facts scoping and state need from a hydrated Soup item.
fn facts(item: &SoupItem<()>) -> EntityFacts {
    match item {
        SoupItem::ChannelThread(thread) => EntityFacts {
            thread_channel: Some(thread.channel_id),
            mail: None,
        },
        SoupItem::EmailThread(thread) => EntityFacts {
            thread_channel: None,
            mail: Some(MailFacts {
                inbox_visible: thread.thread.inbox_visible,
                is_read: thread.thread.is_read,
            }),
        },
        _ => EntityFacts::default(),
    }
}

/// One page of `request` from `soup`.
async fn read_page<T: AttentionPages, E: ViewerInboxes>(
    soup: &T,
    email: &E,
    request: CandidateRequest,
) -> Result<CandidatePage<SoupProjectionHydration>, Report> {
    let link_ids = email.inbox_ids(&request.viewer.user).await?;
    // Boxed: the Soup read's future is large, and in an unoptimized build each
    // of `page`'s two awaits of this read adds it to the stack again.
    let page = Box::pin(soup.attention_page(
        AttentionSoupRequest {
            user: request.viewer.user.clone(),
            link_ids,
            limit: request.limit,
            own_work: request.own_work,
            keying: match request.keying {
                CandidateKeying::ThreadScoped => AttentionKeying::ThreadScoped,
                CandidateKeying::FiledEntity => AttentionKeying::FiledEntity,
            },
            types: request.types,
            filter: request.filter,
            after: request.after.map(|after| AttentionPagePosition {
                sort_at: after.sort_at,
                entity_id: after.entity_id,
            }),
            only: request.only,
            assume_attention: request.assume_attention,
        },
        request.viewer.team,
    ))
    .await
    .map_err(|error| rootcause::report!("failed to load feed candidates: {error}"))?;

    Ok(CandidatePage {
        items: page
            .items
            .into_iter()
            .map(|item| Candidate {
                key: item.hydration.item.entity(),
                facts: facts(&item.hydration.item),
                attention_at: item.attention_at,
                touched_at: item.touched_at,
                sort_at: item.sort_at,
                entity: item.hydration,
            })
            .collect(),
        next: page.next.map(|next| FeedPosition {
            sort_at: next.sort_at,
            entity_id: next.entity_id,
        }),
    })
}

impl<S, E, C> CandidateSource for SoupCandidateSource<S, E, C>
where
    S: SoupService,
    E: ViewerInboxes,
    C: AttentionPages,
{
    type Entity = SoupProjectionHydration;

    async fn page(&self, request: CandidateRequest) -> Result<CandidatePage<Self::Entity>, Report> {
        match request.read {
            CandidateRead::Replica => read_page(&self.soup, self.email.as_ref(), request).await,
            CandidateRead::Committed => {
                read_page(&self.committed, self.email.as_ref(), request).await
            }
        }
    }

    async fn unread_keys(
        &self,
        viewer: &FeedViewer,
        types: Vec<EntityType>,
        limit: u16,
    ) -> Result<Vec<Entity<'static>>, Report> {
        self.soup
            .get_attention_unread_entities(viewer.user.clone(), types, limit)
            .await
            .map_err(|error| rootcause::report!("failed to find unread entities: {error}"))
    }
}
