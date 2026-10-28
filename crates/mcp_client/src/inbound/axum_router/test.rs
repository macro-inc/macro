use super::*;

fn params(
    code: Option<&str>,
    state: Option<&str>,
    error: Option<&str>,
    error_description: Option<&str>,
) -> AuthCallbackParams {
    AuthCallbackParams {
        code: code.map(String::from),
        state: state.map(String::from),
        error: error.map(String::from),
        error_description: error_description.map(String::from),
    }
}

#[test]
fn successful_callback_yields_code_and_state() {
    let result = parse_callback_params(params(Some("a-code"), Some("a-state"), None, None));
    assert!(matches!(result, Ok((code, state)) if code == "a-code" && state == "a-state"));
}

#[test]
fn provider_rejection_is_reported_with_description() {
    let result = parse_callback_params(params(
        None,
        Some("a-state"),
        Some("access_denied"),
        Some("user declined"),
    ));
    let Err(McpHandlerErr::OAuthRejected(message)) = result else {
        panic!("expected OAuthRejected, got {result:?}");
    };
    assert_eq!(message, "access_denied: user declined");
}

#[test]
fn provider_rejection_without_description_uses_bare_error() {
    let result = parse_callback_params(params(None, Some("a-state"), Some("access_denied"), None));
    let Err(McpHandlerErr::OAuthRejected(message)) = result else {
        panic!("expected OAuthRejected, got {result:?}");
    };
    assert_eq!(message, "access_denied");
}

#[test]
fn error_takes_precedence_over_a_stray_code() {
    // Providers shouldn't send both, but if they do, the rejection is authoritative.
    let result = parse_callback_params(params(
        Some("a-code"),
        Some("a-state"),
        Some("access_denied"),
        None,
    ));
    assert!(matches!(result, Err(McpHandlerErr::OAuthRejected(_))));
}

#[test]
fn missing_code_and_error_is_malformed() {
    let result = parse_callback_params(params(None, Some("a-state"), None, None));
    assert!(matches!(result, Err(McpHandlerErr::MalformedCallback)));
}

#[test]
fn missing_state_without_error_is_malformed() {
    let result = parse_callback_params(params(Some("a-code"), None, None, None));
    assert!(matches!(result, Err(McpHandlerErr::MalformedCallback)));
}

/// A store whose `load` can fail, as it does when stored credentials no
/// longer decrypt.
#[derive(Default)]
struct FakeStore {
    records: std::sync::Mutex<Vec<McpServerRecord>>,
    load_fails: bool,
    loads: std::sync::atomic::AtomicUsize,
}

impl McpServerStore for FakeStore {
    type Err = anyhow::Error;

    async fn save(&self, record: &McpServerRecord) -> Result<(), Self::Err> {
        self.records.lock().unwrap().push(record.clone());
        Ok(())
    }

    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        self.loads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self.load_fails {
            anyhow::bail!("credential ciphertext too short");
        }
        Ok(self
            .records
            .lock()
            .unwrap()
            .iter()
            .find(|record| &record.user_id == user_id && record.url == server_url)
            .cloned())
    }

    async fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<(), Self::Err> {
        self.records
            .lock()
            .unwrap()
            .retain(|record| !(&record.user_id == user_id && record.url == server_url));
        Ok(())
    }

    async fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        Ok(self
            .records
            .lock()
            .unwrap()
            .iter()
            .filter(|record| &record.user_id == user_id)
            .cloned()
            .collect())
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user-1@example.com").unwrap()
}

fn server() -> McpServerRecord {
    McpServerRecord {
        user_id: user(),
        url: "https://mcp.linear.app/mcp".to_owned(),
        server_name: "Linear".to_owned(),
        credentials: None,
        enabled: true,
    }
}

fn recording_hook() -> (
    McpServerRemovedHook,
    Arc<std::sync::Mutex<Vec<McpServerRecord>>>,
) {
    let removed = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = removed.clone();
    let hook: McpServerRemovedHook = Arc::new(move |record| {
        seen.lock().unwrap().push(record);
        Box::pin(async {})
    });
    (hook, removed)
}

#[tokio::test]
async fn a_server_whose_record_cannot_be_read_is_still_deleted() {
    let store = FakeStore {
        records: std::sync::Mutex::new(vec![server()]),
        load_fails: true,
        ..FakeStore::default()
    };
    let (hook, removed) = recording_hook();

    remove_server(&store, Some(&hook), &user(), "https://mcp.linear.app/mcp")
        .await
        .unwrap();

    assert!(store.records.lock().unwrap().is_empty());
    assert!(removed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_removal_hook_gets_the_removed_record() {
    let store = FakeStore {
        records: std::sync::Mutex::new(vec![server()]),
        ..FakeStore::default()
    };
    let (hook, removed) = recording_hook();

    remove_server(&store, Some(&hook), &user(), "https://mcp.linear.app/mcp")
        .await
        .unwrap();

    let removed = removed.lock().unwrap();
    assert_eq!(removed.len(), 1);
    assert_eq!(removed[0].url, "https://mcp.linear.app/mcp");
}

#[tokio::test]
async fn deleting_without_a_hook_does_not_read_the_record() {
    let store = FakeStore {
        records: std::sync::Mutex::new(vec![server()]),
        ..FakeStore::default()
    };

    remove_server(&store, None, &user(), "https://mcp.linear.app/mcp")
        .await
        .unwrap();

    assert!(store.records.lock().unwrap().is_empty());
    assert_eq!(store.loads.load(std::sync::atomic::Ordering::SeqCst), 0);
}
