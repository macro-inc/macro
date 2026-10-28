//! The latest macrod release on GitHub and this platform's asset in it.

use std::time::Duration;

#[cfg(test)]
mod test;

/// The release the install scripts and the updater both follow.
const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/macro-inc/macro/releases/latest";

/// What a mirror serves in place of GitHub's release API: the same object,
/// of which only `tag_name` is read.
const MIRROR_MANIFEST: &str = "latest.json";

/// Where releases come from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReleaseSource {
    /// The repository's GitHub releases.
    GitHub,
    /// `MACROD_UPDATE_SOURCE`: a base URL or a local directory holding
    /// `latest.json` (GitHub's release object; `tag_name` is enough) and the
    /// release's archives and `.sha256` files beside it, named as on GitHub.
    /// For testing an update without publishing one.
    Mirror(String),
}

impl ReleaseSource {
    /// The mirror named by `override_source`, or GitHub.
    pub fn new(override_source: Option<&str>) -> Self {
        match override_source.map(str::trim) {
            Some(source) if !source.is_empty() => {
                Self::Mirror(source.trim_end_matches('/').to_owned())
            }
            _ => Self::GitHub,
        }
    }

    fn mirror_file(base: &str, name: &str) -> String {
        format!("{base}/{name}")
    }
}

/// Covers a slow connection pulling a ~30 MB archive.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// The archive format the release workflow uses for this platform.
#[cfg(windows)]
const ARCHIVE_EXTENSION: &str = "zip";
#[cfg(not(windows))]
const ARCHIVE_EXTENSION: &str = "tar.gz";

/// A release tag's position in the release order. Tags are calendar
/// versions, `vYYYY.MM.DD.N`; older tags carry no build number, which counts
/// as build 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ReleaseVersion {
    year: u16,
    month: u8,
    day: u8,
    build: u16,
}

impl ReleaseVersion {
    /// The version a release tag names, or `None` for any other ref (a
    /// branch build, a pre-release suffix).
    pub fn parse(tag: &str) -> Option<Self> {
        let (_, year, month, day, build) =
            lazy_regex::regex_captures!(r"^v(\d{4})\.(\d{1,2})\.(\d{1,2})(?:\.(\d{1,5}))?$", tag)?;
        Some(Self {
            year: year.parse().ok()?,
            month: month.parse().ok()?,
            day: day.parse().ok()?,
            build: if build.is_empty() {
                0
            } else {
                build.parse().ok()?
            },
        })
    }
}

impl std::fmt::Display for ReleaseVersion {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "v{}.{}.{}.{}",
            self.year, self.month, self.day, self.build
        )
    }
}

/// The parts of GitHub's release object the updater reads.
#[derive(Debug, serde::Deserialize)]
pub struct Release {
    #[serde(rename = "tag_name")]
    pub tag: String,
    #[serde(default)]
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, serde::Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

/// This platform's archive in a release, with its checksum file.
#[derive(Debug, PartialEq, Eq)]
pub struct PlatformAsset {
    pub archive_name: String,
    archive_url: String,
    checksum_url: String,
}

impl Release {
    /// The tagged archive for this OS and CPU, e.g.
    /// `macrod-v2026.10.27.2-linux-x86_64.tar.gz`, and its `.sha256`. The
    /// tagged name rather than the version-less one, so the download cannot
    /// race a newer release.
    pub fn platform_asset(&self, source: &ReleaseSource) -> Option<PlatformAsset> {
        self.asset_for(
            source,
            std::env::consts::OS,
            std::env::consts::ARCH,
            ARCHIVE_EXTENSION,
        )
    }

    fn asset_for(
        &self,
        source: &ReleaseSource,
        os: &str,
        arch: &str,
        extension: &str,
    ) -> Option<PlatformAsset> {
        let archive_name = format!("macrod-{}-{os}-{arch}.{extension}", self.tag);
        let checksum_name = format!("{archive_name}.sha256");
        let url_of = |name: &str| match source {
            ReleaseSource::GitHub => self
                .assets
                .iter()
                .find(|asset| asset.name == name)
                .map(|asset| asset.browser_download_url.clone()),
            // A mirror's files are found by name; a missing one fails the
            // download instead.
            ReleaseSource::Mirror(base) => Some(ReleaseSource::mirror_file(base, name)),
        };
        Some(PlatformAsset {
            archive_url: url_of(&archive_name)?,
            checksum_url: url_of(&checksum_name)?,
            archive_name,
        })
    }
}

/// An archive and the checksum file published beside it.
pub struct Downloaded {
    pub archive: Vec<u8>,
    pub checksum: String,
}

/// Reads releases from GitHub or a mirror.
pub struct ReleaseClient {
    http: reqwest::Client,
    source: ReleaseSource,
}

impl ReleaseClient {
    pub fn new(source: ReleaseSource) -> reqwest::Result<Self> {
        let http = reqwest::Client::builder()
            // GitHub's API rejects requests without a user agent.
            .user_agent(format!("macrod/{}", super::VERSION))
            .timeout(REQUEST_TIMEOUT)
            .build()?;
        Ok(Self { http, source })
    }

    pub fn source(&self) -> &ReleaseSource {
        &self.source
    }

    /// The newest published, non-prerelease release.
    pub async fn latest(&self) -> Result<Release, FetchError> {
        let manifest = match &self.source {
            ReleaseSource::GitHub => {
                return Ok(self
                    .http
                    .get(LATEST_RELEASE_URL)
                    .header(reqwest::header::ACCEPT, "application/vnd.github+json")
                    .send()
                    .await?
                    .error_for_status()?
                    .json()
                    .await?);
            }
            ReleaseSource::Mirror(base) => ReleaseSource::mirror_file(base, MIRROR_MANIFEST),
        };
        Ok(serde_json::from_slice(&self.fetch(&manifest).await?)?)
    }

    pub async fn download(&self, asset: &PlatformAsset) -> Result<Downloaded, FetchError> {
        let checksum =
            String::from_utf8_lossy(&self.fetch(&asset.checksum_url).await?).into_owned();
        let archive = self.fetch(&asset.archive_url).await?;
        Ok(Downloaded { archive, checksum })
    }

    /// An http(s) URL, or a path on this machine (a mirror directory).
    async fn fetch(&self, location: &str) -> Result<Vec<u8>, FetchError> {
        if location.starts_with("http://") || location.starts_with("https://") {
            Ok(self
                .http
                .get(location)
                .send()
                .await?
                .error_for_status()?
                .bytes()
                .await?
                .to_vec())
        } else {
            let path = location.strip_prefix("file://").unwrap_or(location);
            Ok(tokio::fs::read(path).await?)
        }
    }
}

/// Why a release or its files could not be read.
#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    File(#[from] std::io::Error),
    #[error("malformed release manifest")]
    Manifest(#[from] serde_json::Error),
}
