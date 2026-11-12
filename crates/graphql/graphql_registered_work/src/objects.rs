use agent_session::domain::work_registration::{WorkRegistration, WorkRegistrationId};
use async_graphql::{ID, SimpleObject, Union};
use graphql_soup::{GraphqlSoupAgentSession, SoupEntityEdges};

/// An agent session an account registered as its work.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlRegisteredWork")]
pub struct GraphqlRegisteredWork<E: SoupEntityEdges> {
    /// The registration.
    id: ID,
    /// The account whose work this is.
    account_id: ID,
    /// When the account registered it, in RFC 3339.
    registered_at: String,
    /// The session registered.
    session: GraphqlSoupAgentSession<E>,
}

impl<E: SoupEntityEdges> GraphqlRegisteredWork<E> {
    /// Pair a registration with its session as the viewer sees it.
    pub(crate) fn new(registration: WorkRegistration, session: GraphqlSoupAgentSession<E>) -> Self {
        Self {
            id: ID(registration.id.to_string()),
            account_id: ID(registration.account_id.as_ref().to_owned()),
            registered_at: registration.registered_at.to_rfc3339(),
            session,
        }
    }
}

/// A registration to show, new or with its session's list fields changed.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlRegisteredWorkUpsert")]
pub struct GraphqlRegisteredWorkUpsert<E: SoupEntityEdges> {
    /// The registration.
    entry: GraphqlRegisteredWork<E>,
}

/// A registration that ended or whose session was archived.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlRegisteredWorkRemove")]
pub struct GraphqlRegisteredWorkRemove {
    /// The registration to stop showing.
    id: ID,
}

/// Changes may have been missed or sharing changed: refetch the list.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlRegisteredWorkInvalidate")]
pub struct GraphqlRegisteredWorkInvalidate {
    /// Always true.
    refresh: bool,
}

/// One change to the registered work of the subscribed accounts.
#[expect(
    clippy::large_enum_variant,
    reason = "upserts dominate and carry hydrated sessions"
)]
#[derive(Union)]
#[graphql(name = "GraphqlRegisteredWorkPatch")]
pub enum GraphqlRegisteredWorkPatch<E: SoupEntityEdges> {
    /// A registration to show.
    Upsert(GraphqlRegisteredWorkUpsert<E>),
    /// A registration to stop showing.
    Remove(GraphqlRegisteredWorkRemove),
    /// The list must be refetched.
    Invalidate(GraphqlRegisteredWorkInvalidate),
}

impl<E: SoupEntityEdges> GraphqlRegisteredWorkPatch<E> {
    /// The patch showing `entry`.
    pub(crate) fn upsert(entry: GraphqlRegisteredWork<E>) -> Self {
        Self::Upsert(GraphqlRegisteredWorkUpsert { entry })
    }

    /// The patch that stops showing `id`.
    pub(crate) fn remove(id: WorkRegistrationId) -> Self {
        Self::Remove(GraphqlRegisteredWorkRemove {
            id: ID(id.to_string()),
        })
    }

    /// The patch asking for a refetch.
    pub(crate) fn invalidate() -> Self {
        Self::Invalidate(GraphqlRegisteredWorkInvalidate { refresh: true })
    }
}
