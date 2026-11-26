use super::*;

const NOT_ABSOLUTE: &str = "workspace must be an absolute path";
const TRAILING_SEPARATOR: &str = "workspace must not end with a slash";

fn refusal(workspace: &str) -> Option<&'static str> {
    match validate_workspace(workspace) {
        Ok(()) => None,
        Err(CreateSessionApiError::InvalidWorkspace(reason)) => Some(reason),
        Err(other) => panic!("{workspace:?} was refused for another reason: {other:?}"),
    }
}

/// A runtime sends its own machine's path, whatever this host runs on.
#[test]
fn absolute_paths_of_either_kind_of_runtime_are_accepted() {
    for workspace in [
        "/home/operator/code",
        "/",
        r"C:\Users\operator\code",
        "C:/Users/operator/code",
        r"d:\work",
        r"C:\Users/operator\mixed",
        r"C:\",
        "C:/",
        r"\\fileserver\share\code",
        r"\\?\C:\Users\operator\code",
        r"\\?\UNC\fileserver\share\code",
    ] {
        assert_eq!(refusal(workspace), None, "{workspace:?} was refused");
    }
}

#[test]
fn relative_paths_are_refused_on_either_kind_of_runtime() {
    for workspace in [
        "",
        "code/agent",
        ".",
        "..",
        r"code\agent",
        // Relative to the current directory of drive C.
        "C:",
        "C:code",
        // Relative to the root of the current drive.
        r"\Users\operator",
        r"1:\code",
    ] {
        assert_eq!(
            refusal(workspace),
            Some(NOT_ABSOLUTE),
            "{workspace:?} was not refused as relative"
        );
    }
}

#[test]
fn a_trailing_separator_is_refused_except_on_a_root() {
    for workspace in [
        "/home/operator/code/",
        r"C:\Users\operator\code\",
        "C:/Users/operator/code/",
        r"\\fileserver\share\",
        r"\\",
    ] {
        assert_eq!(
            refusal(workspace),
            Some(TRAILING_SEPARATOR),
            "{workspace:?} was not refused for its trailing separator"
        );
    }
}

#[tokio::test]
async fn a_harness_opens_a_session_in_a_windows_workspace() {
    let opener = Arc::new(RecordingOpener::default());
    let workspace = r"C:\Users\operator\code";
    let request = as_harness(body(Some(BotId::TEST_A.as_uuid()), workspace, None));

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let payload: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    // Stored and answered exactly as the runtime sent it.
    assert_eq!(payload["session"]["workspace"], workspace);
    assert_eq!(opener.opened.lock().unwrap()[0].workspace, workspace);
}
