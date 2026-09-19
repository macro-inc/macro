pub(crate) const BYO_AGENT_URL: &str = "https://docs.macro.com/AI/bring-your-own";

pub(crate) enum BrowserTarget {
    Pairing(String),
    BringYourOwn,
}

pub(crate) fn open_pending_browser(pending: &mut Option<BrowserTarget>) -> Option<(String, bool)> {
    let target = pending.take()?;
    let (url, success, failure) = match target {
        BrowserTarget::Pairing(url) => (
            url,
            "sent the approval page to your browser",
            "could not launch a browser; use the pairing link",
        ),
        BrowserTarget::BringYourOwn => (
            BYO_AGENT_URL.to_owned(),
            "opened the bring your own agent guide",
            "could not launch a browser; open the bring your own agent guide manually",
        ),
    };
    Some(match launch_browser_helper(&url) {
        Ok(()) => (success.to_owned(), false),
        Err(error) => (format!("{failure} ({error})"), true),
    })
}

pub(crate) fn launch_browser_helper(url: &str) -> std::io::Result<()> {
    let executable = std::env::current_exe()?;
    std::process::Command::new(executable)
        .args(["--open-url", url])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
}

pub(crate) fn browser_status(result: std::io::Result<()>) -> (String, bool) {
    match result {
        Ok(()) => ("Opened the bring your own agent guide".to_owned(), false),
        Err(error) => (format!("Could not launch a browser: {error}"), true),
    }
}

/// Put text on the system clipboard.
pub(crate) fn copy_to_clipboard(text: &str) -> bool {
    thread_local! {
        static CLIPBOARD: std::cell::RefCell<Option<arboard::Clipboard>> = const { std::cell::RefCell::new(None) };
    }
    CLIPBOARD.with(|owner| {
        let mut owner = owner.borrow_mut();
        if owner.is_none() {
            *owner = arboard::Clipboard::new().ok();
        }
        owner
            .as_mut()
            .is_some_and(|clipboard| clipboard.set_text(text).is_ok())
    })
}
