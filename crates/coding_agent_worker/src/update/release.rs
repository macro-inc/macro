//! The latest macrod release on GitHub and this platform's asset in it.

use std::time::Duration;

#[cfg(test)]
mod test;

/// The release the install scripts and the updater both follow.
const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/macro-inc/macro/releases/latest";

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
    pub fn platform_asset(&self) -> Option<PlatformAsset> {
        self.asset_for(
            std::env::consts::OS,
            std::env::consts::ARCH,
            ARCHIVE_EXTENSION,
        )
    }

    fn asset_for(&self, os: &str, arch: &str, extension: &str) -> Option<PlatformAsset> {
        let archive_name = format!("macrod-{}-{os}-{arch}.{extension}", self.tag);
        let checksum_name = format!("{archive_name}.sha256");
        let url_of = |name: &str| {
            self.assets
                .iter()
                .find(|asset| asset.name == name)
                .map(|asset| asset.browser_download_url.clone())
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

/// Reads releases from GitHub.
pub struct ReleaseClient {
    http: reqwest::Client,
}

impl ReleaseClient {
    pub fn new() -> reqwest::Result<Self> {
        let http = reqwest::Client::builder()
            // GitHub's API rejects requests without a user agent.
            .user_agent(format!("macrod/{}", super::VERSION))
            .timeout(REQUEST_TIMEOUT)
            .build()?;
        Ok(Self { http })
    }

    /// The newest published, non-prerelease release.
    pub async fn latest(&self) -> reqwest::Result<Release> {
        self.http
            .get(LATEST_RELEASE_URL)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    }

    pub async fn download(&self, asset: &PlatformAsset) -> reqwest::Result<Downloaded> {
        let checksum = self.get(&asset.checksum_url).await?.text().await?;
        let archive = self.get(&asset.archive_url).await?.bytes().await?.to_vec();
        Ok(Downloaded { archive, checksum })
    }

    async fn get(&self, url: &str) -> reqwest::Result<reqwest::Response> {
        self.http.get(url).send().await?.error_for_status()
    }
}
