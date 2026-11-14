//! A Macro user: the one who links inboxes and calls the API.

#![expect(
    clippy::disallowed_methods,
    reason = "test support: database DDL and seed rows are not checked against the query cache"
)]

use reqwest::Method;
use rootcause::prelude::*;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::api::{ApiClient, ApiResponse};
use crate::inbox::{Inbox, Provider, ProviderHandle};
use crate::stack::Stack;

/// The scope a Gmail inbox is linked with.
const GMAIL_SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";

/// A Macro user of a [`Stack`].
#[derive(Clone)]
pub struct User {
    email: String,
    api: ApiClient,
    db: PgPool,
    gmail: gmail_emulator::GmailEmulator,
    outlook: outlook_emulator::OutlookEmulator,
}

impl User {
    pub(crate) async fn create(stack: &Stack, email: &str) -> Result<Self, Report> {
        let fusion_user_id = Uuid::now_v7();
        let macro_user_id = format!("macro|{email}");
        let db = stack.db().clone();

        sqlx::query(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        )
        .bind(fusion_user_id)
        .bind(email)
        .bind(format!("cus_{}", fusion_user_id.simple()))
        .execute(&db)
        .await
        .context("could not create the Macro user")?;
        sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#)
            .bind(&macro_user_id)
            .bind(email)
            .bind(fusion_user_id)
            .execute(&db)
            .await
            .context("could not create the Macro user's profile")?;

        Ok(Self {
            email: email.to_owned(),
            api: ApiClient {
                http: stack.http().clone(),
                api_url: stack.api_url().to_owned(),
                graphql_url: stack.graphql_url(),
                internal_api_key: stack.internal_api_key().to_owned(),
                macro_user_id,
                fusion_user_id,
            },
            db,
            gmail: stack.gmail().clone(),
            outlook: stack.outlook().clone(),
        })
    }

    /// Runs a GraphQL operation as the user, as the web app does, and
    /// answers its `data`; an `errors` answer fails the call. Needs a stack
    /// started with `document_storage: true`.
    pub async fn graphql(&self, query: &str, variables: &Value) -> Result<Value, Report> {
        self.api.graphql(query, variables).await
    }

    /// The user's address, which is also their first inbox's.
    pub fn email(&self) -> &str {
        &self.email
    }

    /// The user's Macro id, `macro|<email>`.
    pub fn macro_id(&self) -> &str {
        &self.api.macro_user_id
    }

    /// The user's id at the identity provider.
    pub fn fusion_id(&self) -> Uuid {
        self.api.fusion_user_id
    }

    /// Links the Gmail mailbox with the user's own address and waits for its
    /// first backfill. The mailbox is created empty at the emulator unless
    /// the scenario seeded it already.
    pub async fn link_gmail(&self) -> Result<Inbox, Report> {
        self.link(Provider::Gmail, &self.email).await
    }

    /// Links the Outlook mailbox with the user's own address and waits for
    /// its first import. The mailbox is created empty at the emulator unless
    /// the scenario seeded it already.
    pub async fn link_outlook(&self) -> Result<Inbox, Report> {
        self.link(Provider::Outlook, &self.email).await
    }

    /// Links the mailbox `address` at `provider` and waits for its first
    /// sync to complete.
    pub async fn link(&self, provider: Provider, address: &str) -> Result<Inbox, Report> {
        let inbox = self.start_link(provider, address).await?;
        inbox.wait_until_synced().await?;
        Ok(inbox)
    }

    /// Links the mailbox `address` at `provider` and returns as soon as the
    /// API accepted it, with the first sync still running.
    ///
    /// This is the end of the sign-in flow: the user has consented at the
    /// provider, the authentication service holds their grant (here: the
    /// emulator's stand-in does), and the client calls `POST /email/init`.
    pub async fn start_link(&self, provider: Provider, address: &str) -> Result<Inbox, Report> {
        let attempt = Uuid::now_v7();
        match provider {
            Provider::Gmail => {
                let known = self.gmail.mailboxes();
                if !known.iter().any(|mailbox| mailbox.email == address) {
                    self.gmail.add_mailbox(&gmail_emulator::SeedMailbox {
                        email: address.to_owned(),
                        ..Default::default()
                    })?;
                }
            }
            Provider::Outlook => {
                let known = self.outlook.mailboxes();
                if !known.iter().any(|mailbox| mailbox.email == address) {
                    self.outlook.add_mailbox(&outlook_emulator::SeedMailbox {
                        email: address.to_owned(),
                        ..Default::default()
                    })?;
                }
                // The grant the authentication service would hold for the attempt.
                self.outlook.link_mailbox(&attempt.to_string(), address)?;
            }
        }

        sqlx::query(
            "INSERT INTO in_progress_user_link \
                 (id, macro_user_id, linked_email, email_provider, requested_google_scopes, granted_google_scopes) \
             VALUES ($1, $2, $3, $4::email_user_provider_enum, $5, $5)",
        )
        .bind(attempt)
        .bind(self.api.fusion_user_id)
        .bind(address)
        .bind(provider.as_str())
        .bind(match provider {
            Provider::Gmail => vec![GMAIL_SCOPE.to_owned()],
            Provider::Outlook => Vec::new(),
        })
        .execute(&self.db)
        .await
        .context("could not record the finished sign-in")?;

        let linked = self
            .post(&format!("/email/init?link_id={attempt}"), None)
            .await?
            .ok()
            .context(format!("could not link the {provider:?} mailbox {address}"))?;
        let link_id: Uuid = linked["link_id"]
            .as_str()
            .and_then(|id| id.parse().ok())
            .ok_or_else(|| report!("POST /email/init answered no link id: {linked}"))?;

        let handle = match provider {
            Provider::Gmail => ProviderHandle::Gmail(self.gmail.clone()),
            Provider::Outlook => {
                // Token requests name the link from here on, and are
                // answered while a grant made for it is held.
                self.outlook
                    .link_attempt(&link_id.to_string(), &attempt.to_string())?;
                ProviderHandle::Outlook(self.outlook.clone())
            }
        };
        Ok(Inbox::new(
            self.clone(),
            handle,
            address.to_owned(),
            link_id,
        ))
    }

    /// `GET path` as the user.
    pub async fn get(&self, path: &str) -> Result<ApiResponse, Report> {
        self.request(Method::GET, path, None, None).await
    }

    /// `POST path` as the user.
    pub async fn post(&self, path: &str, body: Option<&Value>) -> Result<ApiResponse, Report> {
        self.request(Method::POST, path, None, body).await
    }

    /// `PUT path` as the user.
    pub async fn put(&self, path: &str, body: Option<&Value>) -> Result<ApiResponse, Report> {
        self.request(Method::PUT, path, None, body).await
    }

    /// `PATCH path` as the user.
    pub async fn patch(&self, path: &str, body: Option<&Value>) -> Result<ApiResponse, Report> {
        self.request(Method::PATCH, path, None, body).await
    }

    /// `DELETE path` as the user.
    pub async fn delete(&self, path: &str, body: Option<&Value>) -> Result<ApiResponse, Report> {
        self.request(Method::DELETE, path, None, body).await
    }

    /// Any request as the user, on the inbox `link` when given (the
    /// `X-Email-Link-Id` header). Without it the API uses the user's primary
    /// inbox where a route needs one.
    pub async fn request(
        &self,
        method: Method,
        path: &str,
        link: Option<Uuid>,
        body: Option<&Value>,
    ) -> Result<ApiResponse, Report> {
        self.api.request(method, path, link, body).await
    }

    /// Any request as the user to the document storage service (the item
    /// lists, CRM and document routes the web app calls). Needs a stack
    /// started with `document_storage: true`.
    pub async fn document_storage_request(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<ApiResponse, Report> {
        self.api.document_storage_request(method, path, body).await
    }

    /// One page of the email threads an item list shows the user, as the
    /// web app asks for them (`POST /items/soup/ast` on document storage,
    /// every other kind of item left out). `request` adds to the body: the
    /// email filter `ef`, a CRM scope `ecd`, `emailView`, `limit`,
    /// `sort_method`. `cursor` is the `next_cursor` of the page before.
    /// The threads are the answer's `items`, each with its `data`.
    pub async fn email_list_page(
        &self,
        request: &Value,
        cursor: Option<&str>,
    ) -> Result<ApiResponse, Report> {
        const NOTHING: &str = "00000000-0000-0000-0000-000000000000";
        let leave_out = json!({ "l": { "id": NOTHING } });
        let mut body = json!({
            "calf": leave_out,
            "df": leave_out,
            "ccf": leave_out,
            "fef": leave_out,
            "cf": { "l": { "cid": NOTHING } },
            "chanf": { "l": { "ChannelId": NOTHING } },
            "cthf": { "l": { "ThreadId": NOTHING } },
            "pf": { "l": { "pid": NOTHING } },
            "callf": { "l": { "CallId": NOTHING } },
            "sort_method": "updated_at",
        });
        if let (Some(body), Some(request)) = (body.as_object_mut(), request.as_object()) {
            body.extend(request.clone());
        }
        let path = match cursor {
            Some(cursor) => format!("/items/soup/ast?cursor={}", urlencoding::encode(cursor)),
            None => "/items/soup/ast".to_owned(),
        };
        self.document_storage_request(Method::POST, &path, Some(&body))
            .await
    }

    /// Searches as the web app does (`POST /search` on document storage,
    /// on a stack with `search`). `request` is the body: `query`,
    /// `match_type` (`exact` or `partial`) and optionally `filters` and
    /// `search_on`. The hits are the answer's `results`. Indexing follows
    /// the mail by a moment, so wait for a hit with [`eventually`].
    pub async fn search(&self, request: &Value) -> Result<ApiResponse, Report> {
        self.document_storage_request(Method::POST, "/search", Some(request))
            .await
    }

    pub(crate) fn http(&self) -> &reqwest::Client {
        &self.api.http
    }
}
