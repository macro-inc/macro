//! Session ownership and routing policy, independent of the HTTP/Redis adapters.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Owner {
    pub user: String,
    pub process: String,
    pub address: std::net::SocketAddr,
}

#[async_trait::async_trait]
pub(crate) trait Directory: Clone + Send + Sync + 'static {
    async fn lookup(&self, session: &str) -> Result<Option<Owner>, String>;
    async fn register(&self, session: &str, owner: &Owner) -> Result<(), String>;
    async fn remove(&self, session: &str) -> Result<(), String>;
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Route {
    Local,
    Forward(std::net::SocketAddr),
    Forbidden,
    Expired,
}

/// A session ID is a locator, never an authentication credential. A forwarded
/// request must arrive at the exact process incarnation recorded in the directory.
pub(super) fn route(
    owner: Option<&Owner>,
    user: &str,
    process: &str,
    forwarded: Option<&str>,
) -> Route {
    let Some(owner) = owner else {
        return Route::Expired;
    };
    if owner.user != user {
        return Route::Forbidden;
    }
    if let Some(expected_process) = forwarded
        && (expected_process != process || owner.process != process)
    {
        return Route::Expired;
    }
    if owner.process == process {
        Route::Local
    } else {
        Route::Forward(owner.address)
    }
}

#[cfg(test)]
mod test;
