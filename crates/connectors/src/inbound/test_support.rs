//! What the inbound tests share: users, an authorization service that takes
//! a user's name as their token, and a two-app catalog directory.

use crate::domain::discovery::{AppDirectory, AppTool, Catalog, CatalogApp, CatalogPage};
use crate::domain::models::ConnectorId;
use crate::domain::service::Connectors;
use crate::fake::FakeConnectors;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState, ValidatedCredential,
};
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;
use std::sync::Arc;

/// The user a token of `name` signs in as.
pub(crate) fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@example.com"))
        .unwrap()
        .into_owned()
}

/// Signs a bearer token `<name>` in as [`user`]`(name)`; refuses `invalid`.
#[derive(Clone)]
pub(crate) struct NameIsToken;

impl MacroAuthorizationService for NameIsToken {
    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt).await.map(ValidatedCredential::session)
    }

    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt == "invalid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: format!("macro|{jwt}@example.com"),
            fusion_user_id: Default::default(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_internal(
        &self,
        _key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// The authorization state over [`NameIsToken`].
pub(crate) fn authorization() -> MacroAuthorizationState<NameIsToken> {
    MacroAuthorizationState::new(Arc::new(NameIsToken))
}

/// A directory of `linear` and `notion`, each advertising one tool.
pub(crate) struct TwoApps;

fn entry(slug: &str, name: &str) -> CatalogApp {
    CatalogApp {
        id: ConnectorId::parse(slug).unwrap(),
        name: name.to_owned(),
        description: Some(format!("{name} from the directory")),
        icon_url: None,
        categories: vec!["Productivity".to_owned()],
        org_setup: None,
    }
}

#[async_trait::async_trait]
impl AppDirectory for TwoApps {
    async fn search(
        &self,
        _user: &MacroUserIdStr<'static>,
        _search: Option<&str>,
        _cursor: Option<&str>,
        _limit: u32,
    ) -> Result<CatalogPage, Report> {
        Ok(CatalogPage {
            apps: vec![entry("linear", "Linear"), entry("notion", "Notion")],
            next_cursor: Some("page-2".to_owned()),
        })
    }

    async fn retrieve(
        &self,
        _user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Option<CatalogApp>, Report> {
        Ok(match app.as_str() {
            "linear" => Some(entry("linear", "Linear")),
            "notion" => Some(entry("notion", "Notion")),
            _ => None,
        })
    }

    async fn tools(
        &self,
        _user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Vec<AppTool>, Report> {
        Ok(vec![AppTool {
            name: format!("{app}_search"),
            description: format!("Search {app}"),
        }])
    }
}

/// The services and the catalog over `fake`.
pub(crate) fn services(fake: &FakeConnectors) -> (Connectors, Catalog<Connectors>) {
    let connectors = fake.build();
    let catalog = Catalog::new(Arc::new(TwoApps), connectors.clone());
    (connectors, catalog)
}
