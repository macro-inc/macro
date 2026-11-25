//! [`HostImages`] through the host agent's image and system disk routes,
//! and for [`ConfiguredFleet`], whose Docker backend upgrades nothing.

use firecracker_host_api::{
    ErrorCode, ImageFileDigest, ImageFileSource, ImageState, ReplaceSystemDisk, Sha256Digest,
    SourceUrl, StageImage,
};

use super::{FirecrackerFleet, FirecrackerFleetError};
use crate::domain::ids::ComputerId;
use crate::domain::image::GuestImage;
use crate::domain::image_upgrade::{
    HostImageError, HostImages, ImageFile, ImageFileName, ImageSource, ImageVersion, Sha256,
    StagedImage,
};
use crate::outbound::configured_fleet::ConfiguredFleet;

fn wire_name(name: ImageFileName) -> firecracker_host_api::ImageFileName {
    match name {
        ImageFileName::Vmlinux => firecracker_host_api::ImageFileName::Vmlinux,
        ImageFileName::RootfsExt4 => firecracker_host_api::ImageFileName::RootfsExt4,
        ImageFileName::BootArgs => firecracker_host_api::ImageFileName::BootArgs,
    }
}

fn domain_name(name: firecracker_host_api::ImageFileName) -> ImageFileName {
    match name {
        firecracker_host_api::ImageFileName::Vmlinux => ImageFileName::Vmlinux,
        firecracker_host_api::ImageFileName::RootfsExt4 => ImageFileName::RootfsExt4,
        firecracker_host_api::ImageFileName::BootArgs => ImageFileName::BootArgs,
    }
}

fn domain_files(files: Vec<ImageFileDigest>) -> Result<Vec<ImageFile>, FirecrackerFleetError> {
    files
        .into_iter()
        .map(|file| {
            Ok(ImageFile {
                name: domain_name(file.name),
                sha256: Sha256::try_new(file.sha256.as_str())
                    .map_err(|error| FirecrackerFleetError::Image(error.to_string()))?,
                bytes: file.bytes,
            })
        })
        .collect()
}

fn staged(state: ImageState) -> Result<StagedImage, FirecrackerFleetError> {
    Ok(match state {
        ImageState::Ready { files } => StagedImage::Ready(files.map(domain_files).transpose()?),
        ImageState::Staging => StagedImage::Staging,
        ImageState::Failed { reason } => StagedImage::Failed(reason),
        ImageState::Conflict { files } => StagedImage::Conflict(domain_files(files)?),
    })
}

impl HostImageError for FirecrackerFleetError {
    fn is_golden_not_ready(&self) -> bool {
        matches!(self, Self::Client(error) if error.code() == Some(ErrorCode::GoldenNotReady))
    }
}

impl HostImages for FirecrackerFleet {
    type Err = FirecrackerFleetError;

    #[tracing::instrument(name = "firecracker_fleet.stage_image", skip(self, sources), fields(host = %self.config.host_name), err)]
    async fn stage_image(
        &self,
        image: &ImageVersion,
        sources: &[ImageSource],
    ) -> Result<StagedImage, FirecrackerFleetError> {
        let files = sources
            .iter()
            .map(|source| {
                Ok(ImageFileSource {
                    name: wire_name(source.file.name),
                    url: SourceUrl(source.url.expose().to_owned()),
                    sha256: Sha256Digest::try_new(source.file.sha256.as_str())
                        .map_err(|error| FirecrackerFleetError::Image(error.to_string()))?,
                    bytes: source.file.bytes,
                })
            })
            .collect::<Result<Vec<_>, FirecrackerFleetError>>()?;
        let answer = self
            .client
            .stage_image(&StageImage {
                image: image.image().clone(),
                files,
            })
            .await?;
        staged(answer.state)
    }

    async fn staged_image(
        &self,
        image: &ImageVersion,
    ) -> Result<StagedImage, FirecrackerFleetError> {
        match self
            .client
            .images()
            .await?
            .into_iter()
            .find(|staged| staged.image == *image.image())
        {
            Some(found) => staged(found.state),
            None => Ok(StagedImage::Absent),
        }
    }

    #[tracing::instrument(name = "firecracker_fleet.replace_system_disk", skip(self), fields(host = %self.config.host_name), err)]
    async fn replace_system_disk(
        &self,
        computer_id: ComputerId,
        image: &GuestImage,
    ) -> Result<GuestImage, FirecrackerFleetError> {
        let computer = self
            .client
            .replace_system_disk(
                computer_id,
                &ReplaceSystemDisk {
                    image: image.clone(),
                },
            )
            .await?;
        Ok(computer.image)
    }
}

/// Why a [`ConfiguredFleet`] could not upgrade.
#[derive(Debug, thiserror::Error)]
pub enum ConfiguredImageError {
    /// The Firecracker host failed.
    #[error(transparent)]
    Firecracker(#[from] FirecrackerFleetError),
    /// The local Docker fleet has no system disks to replace.
    #[error("the local Docker fleet does not upgrade images")]
    Unsupported,
}

impl HostImageError for ConfiguredImageError {
    fn is_golden_not_ready(&self) -> bool {
        match self {
            Self::Firecracker(error) => error.is_golden_not_ready(),
            Self::Unsupported => false,
        }
    }
}

impl HostImages for ConfiguredFleet {
    type Err = ConfiguredImageError;

    async fn stage_image(
        &self,
        image: &ImageVersion,
        sources: &[ImageSource],
    ) -> Result<StagedImage, ConfiguredImageError> {
        match self {
            Self::Firecracker(fleet) => Ok(fleet.stage_image(image, sources).await?),
            Self::Docker(_) => Err(ConfiguredImageError::Unsupported),
        }
    }

    async fn staged_image(
        &self,
        image: &ImageVersion,
    ) -> Result<StagedImage, ConfiguredImageError> {
        match self {
            Self::Firecracker(fleet) => Ok(fleet.staged_image(image).await?),
            Self::Docker(_) => Err(ConfiguredImageError::Unsupported),
        }
    }

    async fn replace_system_disk(
        &self,
        computer_id: ComputerId,
        image: &GuestImage,
    ) -> Result<GuestImage, ConfiguredImageError> {
        match self {
            Self::Firecracker(fleet) => Ok(fleet.replace_system_disk(computer_id, image).await?),
            Self::Docker(_) => Err(ConfiguredImageError::Unsupported),
        }
    }
}
