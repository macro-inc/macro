use super::*;
use macro_user_id::cowlike::CowLike;
use oauth2::TokenResponse as _;
use std::sync::Mutex;

/// In-memory store holding one user's rows by URL.
#[derive(Default)]
struct MemoryStore {
    rows: Mutex<Vec<McpServerRecord>>,
}

impl MemoryStore {
    fn holding(rows: Vec<McpServerRecord>) -> Self {
        Self {
            rows: Mutex::new(rows),
        }
    }

    fn rows(&self) -> Vec<McpServerRecord> {
        self.rows.lock().unwrap().clone()
    }
}

impl McpServerStore for MemoryStore {
    type Err = anyhow::Error;

    async fn save(&self, record: &McpServerRecord) -> Result<(), Self::Err> {
        let mut rows = self.rows.lock().unwrap();
        rows.retain(|row| row.url != record.url);
        rows.push(record.clone());
        Ok(())
    }

    async fn load(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        Ok(self.rows().into_iter().find(|row| row.url == server_url))
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<(), Self::Err> {
        self.rows
            .lock()
            .unwrap()
            .retain(|row| row.url != server_url);
        Ok(())
    }

    async fn list(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        Ok(self.rows())
    }
}

/// Answers every user with the same link state.
struct FixedTokens(anyhow::Result<Option<String>>);

#[async_trait::async_trait]
impl LinkedGithubTokens for FixedTokens {
    async fn access_token(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Option<String>> {
        match &self.0 {
            Ok(token) => Ok(token.clone()),
            Err(error) => Err(anyhow::anyhow!("{error}")),
        }
    }
}

const WIKI: &str = "https://wiki.example.com/mcp";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user@example.com")
        .unwrap()
        .into_owned()
}

fn row(url: &str, enabled: bool) -> McpServerRecord {
    McpServerRecord {
        user_id: user(),
        url: url.to_owned(),
        server_name: "Stored".to_owned(),
        credentials: None,
        enabled,
    }
}

fn store(
    rows: Vec<McpServerRecord>,
    tokens: Option<anyhow::Result<Option<String>>>,
) -> WithLinkedGithub<MemoryStore> {
    WithLinkedGithub::new(
        MemoryStore::holding(rows),
        tokens.map(|answer| Arc::new(FixedTokens(answer)) as Arc<dyn LinkedGithubTokens>),
    )
}

fn bearer(record: &McpServerRecord) -> Option<String> {
    let token = record.credentials.as_ref()?.token_response.as_ref()?;
    Some(token.access_token().secret().to_owned())
}

#[tokio::test]
async fn a_linked_user_has_github_connected_without_adding_it() {
    let store = store(vec![row(WIKI, true)], Some(Ok(Some("ghu_link".into()))));

    let records = store.list(&user()).await.unwrap();

    let github = records
        .iter()
        .find(|record| record.url == GITHUB_MCP_SERVER_URL)
        .expect("GitHub listed");
    assert!(github.enabled);
    assert_eq!(bearer(github).as_deref(), Some("ghu_link"));
    assert_eq!(records.len(), 2);
}

#[tokio::test]
async fn the_link_replaces_a_stored_github_grant_and_keeps_its_toggle() {
    let github_url = format!("{GITHUB_MCP_SERVER_URL}/");
    let store = store(
        vec![row(&github_url, false)],
        Some(Ok(Some("ghu_link".into()))),
    );

    let records = store.list(&user()).await.unwrap();

    assert_eq!(records.len(), 1);
    assert!(!records[0].enabled);
    assert_eq!(bearer(&records[0]).as_deref(), Some("ghu_link"));
}

#[tokio::test]
async fn an_unlinked_user_reads_the_stored_rows_unchanged() {
    for tokens in [None, Some(Ok(None)), Some(Err(anyhow::anyhow!("down")))] {
        let store = store(vec![row(WIKI, true)], tokens);

        let records = store.list(&user()).await.unwrap();

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].url, WIKI);
        assert!(
            store
                .load(&user(), GITHUB_MCP_SERVER_URL)
                .await
                .unwrap()
                .is_none()
        );
    }
}

#[tokio::test]
async fn loading_github_answers_with_the_link() {
    let store = store(Vec::new(), Some(Ok(Some("ghu_link".into()))));

    let github = store
        .load(&user(), GITHUB_MCP_SERVER_URL)
        .await
        .unwrap()
        .expect("GitHub loaded");

    assert_eq!(bearer(&github).as_deref(), Some("ghu_link"));
    assert!(store.load(&user(), WIKI).await.unwrap().is_none());
}

#[tokio::test]
async fn saving_the_linked_record_persists_the_toggle_but_never_the_token() {
    let store = store(Vec::new(), Some(Ok(Some("ghu_link".into()))));
    let mut github = store
        .load(&user(), GITHUB_MCP_SERVER_URL)
        .await
        .unwrap()
        .expect("GitHub loaded");
    github.enabled = false;

    store.save(&github).await.unwrap();

    let rows = store.inner.rows();
    assert_eq!(rows.len(), 1);
    assert!(!rows[0].enabled);
    assert!(rows[0].credentials.is_none());
}
