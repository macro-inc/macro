use super::*;
use crate::domain::models::{CatalogEntry, CatalogPage, PipedreamConnection};
use std::sync::Mutex;

struct Directory {
    fail_tools: bool,
    tool_count: usize,
    seen: Mutex<Vec<String>>,
}

fn entry() -> CatalogEntry {
    CatalogEntry {
        app_slug: "linear".into(),
        display_name: "Linear".into(),
        description: None,
        icon_url: None,
    }
}

impl ConnectorDirectory for Directory {
    async fn search(
        &self,
        search: Option<&str>,
        _cursor: Option<&str>,
        limit: u32,
    ) -> anyhow::Result<CatalogPage> {
        assert_eq!(search, Some("Linear"));
        assert_eq!(limit, 10);
        Ok(CatalogPage {
            entries: vec![entry()],
            next_cursor: Some("next".into()),
        })
    }
    async fn retrieve(&self, slug: &str) -> anyhow::Result<Option<CatalogEntry>> {
        Ok((slug == "linear").then(entry))
    }
}

impl ConnectorCapabilities for Directory {
    async fn tools(
        &self,
        user: &MacroUserIdStr<'static>,
        slug: &str,
    ) -> anyhow::Result<Vec<ConnectorTool>> {
        self.seen.lock().unwrap().push(user.to_string());
        assert_eq!(slug, "linear");
        if self.fail_tools {
            anyhow::bail!("upstream unavailable");
        }
        Ok((0..self.tool_count)
            .map(|i| ConnectorTool {
                name: format!("tool_{i}"),
                description: "Find issues".into(),
            })
            .collect())
    }
}

struct Store {
    enabled: Option<bool>,
    seen: Mutex<Vec<String>>,
}
impl ConnectionStore for Store {
    type Err = String;
    async fn save(&self, _: &PipedreamConnection) -> Result<(), String> {
        panic!("discovery must not write")
    }
    async fn delete(&self, _: &MacroUserIdStr<'static>, _: &str) -> Result<(), String> {
        panic!("discovery must not delete")
    }
    async fn list(&self, _: &MacroUserIdStr<'static>) -> Result<Vec<PipedreamConnection>, String> {
        panic!("inspect only the requested app")
    }
    async fn load(
        &self,
        user: &MacroUserIdStr<'static>,
        slug: &str,
    ) -> Result<Option<PipedreamConnection>, String> {
        self.seen.lock().unwrap().push(user.to_string());
        Ok(self.enabled.map(|enabled| PipedreamConnection {
            user_id: user.clone(),
            app_slug: slug.into(),
            server_name: "Linear".into(),
            account_id: "account".into(),
            enabled,
        }))
    }
}

fn service(
    enabled: Option<bool>,
    fail_tools: bool,
    tool_count: usize,
) -> ConnectorDiscovery<Directory, Store> {
    ConnectorDiscovery::new(
        Some(Arc::new(Directory {
            fail_tools,
            tool_count,
            seen: Mutex::default(),
        })),
        Arc::new(Store {
            enabled,
            seen: Mutex::default(),
        }),
    )
}
fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("caller@example.com").unwrap()
}
fn inspect(slug: &str) -> DiscoveryRequest {
    DiscoveryRequest::Inspect {
        app_slug: slug.into(),
    }
}

#[tokio::test]
async fn search_is_bounded_and_does_not_read_accounts_or_tools() {
    let svc = service(None, false, 1);
    let result = svc
        .discover(
            &user(),
            &DiscoveryRequest::Search {
                query: " Linear ".into(),
            },
        )
        .await
        .unwrap();
    assert!(matches!(
        result,
        DiscoveryResult::Search {
            more_results: true,
            ..
        }
    ));
    assert!(svc.connections.seen.lock().unwrap().is_empty());
    assert!(
        svc.directory
            .as_ref()
            .unwrap()
            .seen
            .lock()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn inspection_scopes_status_and_capabilities_to_caller() {
    for enabled in [None, Some(false), Some(true)] {
        let svc = service(enabled, false, 1);
        let DiscoveryResult::Inspect {
            connected, tools, ..
        } = svc.discover(&user(), &inspect("linear")).await.unwrap()
        else {
            panic!("inspection expected")
        };
        assert_eq!(connected, enabled == Some(true));
        assert_eq!(tools[0].description, "Find issues");
        assert_eq!(*svc.connections.seen.lock().unwrap(), [user().to_string()]);
        assert_eq!(
            *svc.directory.as_ref().unwrap().seen.lock().unwrap(),
            [user().to_string()]
        );
    }
}

#[tokio::test]
async fn invented_slug_is_rejected_before_account_or_capability_lookup() {
    let svc = service(None, false, 1);
    assert!(svc.discover(&user(), &inspect("invented")).await.is_err());
    assert!(svc.connections.seen.lock().unwrap().is_empty());
    assert!(
        svc.directory
            .as_ref()
            .unwrap()
            .seen
            .lock()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn capability_failure_is_not_misrepresented_as_supported() {
    assert!(
        service(None, true, 1)
            .discover(&user(), &inspect("linear"))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn large_capability_lists_report_truncation() {
    let result = service(None, false, 101)
        .discover(&user(), &inspect("linear"))
        .await
        .unwrap();
    let DiscoveryResult::Inspect {
        tools,
        tools_truncated,
        ..
    } = result
    else {
        panic!("inspection expected")
    };
    assert_eq!(tools.len(), MAX_TOOLS);
    assert!(tools_truncated);
}

#[tokio::test]
async fn unconfigured_deployments_and_empty_searches_fail_explicitly() {
    let mut svc = service(None, false, 0);
    assert!(
        svc.discover(&user(), &DiscoveryRequest::Search { query: "  ".into() })
            .await
            .is_err()
    );
    svc.directory = None;
    assert!(svc.discover(&user(), &inspect("linear")).await.is_err());
}
