use async_graphql::{Context, ErrorExtensions, ID, Object, SimpleObject};
use contacts::domain::models::{
    contact::Contact,
    page::{ContactCursor, ContactPageSize, MAX_CONTACT_PAGE_SIZE},
    query::{ContactLookup, ContactSearch},
};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::Base64Str;

use crate::ContactsGraphqlContext;

/// One viewer's directory entry, not a globally shared user profile or CRM contact.
#[derive(SimpleObject)]
pub struct GraphqlContact {
    /// Stable identity of the viewer/person pair. Names do not affect this key.
    id: ID,
    /// Target user identifier, also used for people who have not joined Macro.
    user_id: ID,
    /// Email address derived from the target user identifier.
    email: String,
    /// Macro profile name, then this viewer's address-book name; null means use email fallback.
    name: Option<String>,
}

impl From<Contact> for GraphqlContact {
    fn from(contact: Contact) -> Self {
        Self {
            id: contact.id.as_uuid().into(),
            email: contact.user_id.email_str().to_owned(),
            user_id: contact.user_id.to_string().into(),
            name: contact.name,
        }
    }
}

/// A bounded contact-ID-ordered page; an empty page may still have a continuation.
#[derive(SimpleObject)]
pub struct GraphqlContactPage {
    /// Authorized contacts, including self in sorted position.
    nodes: Vec<GraphqlContact>,
    /// Opaque continuation, or null only when the source is exhausted.
    next_cursor: Option<String>,
}

/// Flattenable directory fields of an already-authenticated GraphQL viewer.
pub struct GraphqlContactsQuery {
    viewer: MacroUserIdStr<'static>,
}

impl GraphqlContactsQuery {
    /// Construct from the authenticated root's viewer, never a client-provided ID.
    pub fn new(viewer: MacroUserIdStr<'static>) -> Self {
        Self { viewer }
    }

    async fn lookup(
        &self,
        ctx: &Context<'_>,
        lookup: ContactLookup,
    ) -> async_graphql::Result<Vec<GraphqlContact>> {
        ctx.data::<ContactsGraphqlContext>()?
            .reads
            .lookup(self.viewer.clone(), lookup)
            .await
            .map(|contacts| contacts.into_iter().map(Into::into).collect())
            .map_err(unavailable)
    }
}

fn bad_input() -> async_graphql::Error {
    async_graphql::Error::new("invalid contact request")
        .extend_with(|_, extensions| extensions.set("code", "BAD_USER_INPUT"))
}

fn unavailable(error: rootcause::Report) -> async_graphql::Error {
    tracing::error!(error = ?error, "contact directory unavailable");
    async_graphql::Error::new("contact directory unavailable")
        .extend_with(|_, extensions| extensions.set("code", "INTERNAL_SERVER_ERROR"))
}

/// Directory reads authorized by the enclosing authenticated user object.
#[Object]
impl GraphqlContactsQuery {
    /// Resolve up to 500 exact target user IDs, omitting unrelated or unknown people.
    #[tracing::instrument(name = "contacts.graphql.lookup_ids", skip_all, fields(count = user_ids.len()), err(Debug))]
    async fn contacts_by_user_ids(
        &self,
        ctx: &Context<'_>,
        #[graphql(
            desc = "Target user IDs, not GraphqlContact record IDs; empty input returns no contacts."
        )]
        user_ids: Vec<ID>,
    ) -> async_graphql::Result<Vec<GraphqlContact>> {
        if user_ids.len() > usize::from(MAX_CONTACT_PAGE_SIZE) {
            return Err(bad_input());
        }
        let ids = user_ids
            .into_iter()
            .map(|id| MacroUserIdStr::try_from(id.to_string()).map_err(|_| bad_input()))
            .collect::<Result<Vec<_>, _>>()?;
        self.lookup(ctx, ContactLookup::new(ids).ok_or_else(bad_input)?)
            .await
    }

    /// Resolve up to 500 exact email addresses, restricted to the viewer's contacts or self.
    #[tracing::instrument(name = "contacts.graphql.lookup_emails", skip_all, fields(count = emails.len()), err(Debug))]
    async fn contacts_by_emails(
        &self,
        ctx: &Context<'_>,
        #[graphql(
            desc = "Email addresses normalized by the user-ID parser; empty input returns no contacts."
        )]
        emails: Vec<String>,
    ) -> async_graphql::Result<Vec<GraphqlContact>> {
        if emails.len() > usize::from(MAX_CONTACT_PAGE_SIZE) {
            return Err(bad_input());
        }
        let ids = emails
            .into_iter()
            .map(|email| MacroUserIdStr::try_from_email(&email).map_err(|_| bad_input()))
            .collect::<Result<Vec<_>, _>>()?;
        self.lookup(ctx, ContactLookup::new(ids).ok_or_else(bad_input)?)
            .await
    }

    /// Read one page of the viewer's personal contacts with resolved names.
    #[tracing::instrument(name = "contacts.graphql.page", skip_all, fields(limit, has_cursor = after.is_some()), err(Debug))]
    async fn contacts(
        &self,
        ctx: &Context<'_>,
        #[graphql(desc = "Maximum contacts to read, from 1 to 500; defaults to 100.")]
        limit: Option<i32>,
        #[graphql(desc = "Opaque nextCursor from an earlier page in this directory.")]
        after: Option<String>,
        #[graphql(
            desc = "Optional name/email subsequence filter, at most 512 UTF-8 bytes. Results stay in source-ID order; a scan-budget-limited page may be empty with nextCursor."
        )]
        search: Option<String>,
    ) -> async_graphql::Result<GraphqlContactPage> {
        let limit = match limit {
            None => ContactPageSize::DEFAULT,
            Some(limit) => u16::try_from(limit)
                .ok()
                .and_then(ContactPageSize::new)
                .ok_or_else(bad_input)?,
        };
        let after = after
            .map(|raw| {
                let position = Base64Str::<String>::new_from_string(raw)
                    .decode_json()
                    .map_err(|_| bad_input())?;
                ContactCursor::from_position(position).ok_or_else(bad_input)
            })
            .transpose()?;
        let search = search
            .map(|query| ContactSearch::new(&query).ok_or_else(bad_input))
            .transpose()?;
        let reads = &ctx.data::<ContactsGraphqlContext>()?.reads;
        let page = match search {
            Some(search) => {
                reads
                    .search(self.viewer.clone(), search, after, limit)
                    .await
            }
            None => reads.page(self.viewer.clone(), after, limit).await,
        }
        .map_err(unavailable)?;
        Ok(GraphqlContactPage {
            nodes: page.contacts.into_iter().map(Into::into).collect(),
            next_cursor: page
                .next_cursor
                .map(|cursor| Base64Str::encode_json(cursor.position()).type_erase()),
        })
    }
}
