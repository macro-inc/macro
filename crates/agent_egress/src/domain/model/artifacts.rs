//! The artifact routes a sandbox may reach through `/artifacts`.

use http::Method;
use macro_uuid::Uuid;

/// The route prefix the artifact endpoints are served under, on the egress
/// and on the document storage service alike.
pub const ARTIFACTS_PATH: &str = "/artifacts";

/// One of the document storage service's artifact endpoints, by allowlist.
///
/// The sandbox names the endpoint and this crate builds the URL, so nothing
/// else on the storage service - and no query string - can be reached through
/// the route.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArtifactEndpoint {
    /// `POST /artifacts`: create an artifact with its first version.
    Create,
    /// `GET /artifacts/{id}`: the artifact and its current version.
    Read(Uuid),
    /// `POST /artifacts/{id}/uploads`: presigned uploads for missing files.
    Uploads(Uuid),
    /// `POST /artifacts/{id}/versions`: publish a new version.
    Publish(Uuid),
}

impl ArtifactEndpoint {
    /// Recognize an endpoint from the method and the path after
    /// [`ARTIFACTS_PATH`] (empty, or starting with `/`).
    pub fn parse(method: &Method, path: &str) -> Option<Self> {
        if path.is_empty() || path == "/" {
            return (*method == Method::POST).then_some(Self::Create);
        }

        let mut segments = path.strip_prefix('/')?.split('/');
        let id = Uuid::try_parse(segments.next()?).ok()?;
        let endpoint = match (segments.next(), segments.next()) {
            (None, None) if *method == Method::GET => Self::Read(id),
            (Some("uploads"), None) if *method == Method::POST => Self::Uploads(id),
            (Some("versions"), None) if *method == Method::POST => Self::Publish(id),
            _ => return None,
        };
        Some(endpoint)
    }

    /// The path this endpoint has on the storage service.
    pub fn path(&self) -> String {
        match self {
            Self::Create => ARTIFACTS_PATH.to_owned(),
            Self::Read(id) => format!("{ARTIFACTS_PATH}/{id}"),
            Self::Uploads(id) => format!("{ARTIFACTS_PATH}/{id}/uploads"),
            Self::Publish(id) => format!("{ARTIFACTS_PATH}/{id}/versions"),
        }
    }
}
