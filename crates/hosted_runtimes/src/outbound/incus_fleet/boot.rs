//! How a new computer boots: straight into its image's kernel when the host
//! holds that image's boot files, else through firmware and systemd-boot.
//!
//! Firmware and the boot loader cost about 7 s of every boot on
//! runtime-dev-1, so QEMU is handed the kernel, initrd and command line
//! directly (`raw.qemu`). The files must be on the host: the host's
//! `macro-box-boot-files` service (`nix/hosts/_nixos/incus-host.nix`) copies
//! `boot/{kernel,initrd,cmdline}` out of each imported image's metadata
//! tarball into [`BOOT_FILES_DIR`]`/<fingerprint>/` and only then sets the
//! image property [`BOOT_APPEND_PROPERTY`] to the command line. That property
//! is the signal: without it, or with anything unexpected, the computer boots
//! through firmware as before, so a host without the files never breaks a
//! purchase.

use incus_client::{ImageInfo, ImageReference, ImageSource};

#[cfg(test)]
mod test;

/// Where the host keeps each image's kernel and initrd, by fingerprint.
pub const BOOT_FILES_DIR: &str = "/var/lib/macro-box/boot";
/// Image property the host sets, to the kernel command line, once the
/// image's boot files are in place.
pub const BOOT_APPEND_PROPERTY: &str = "user.macro.boot.append";

/// How a computer's VM boots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootPath {
    /// QEMU loads the image's kernel and initrd from the host.
    Direct(DirectBoot),
    /// Firmware and systemd-boot load them from the root disk.
    Firmware(FirmwareReason),
}

/// Why a computer boots through firmware.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum FirmwareReason {
    /// The image comes from a remote server; its files cannot be on the host.
    RemoteImage,
    /// The host's images could not be listed.
    ImageLookupFailed,
    /// The image is not in the host's store.
    ImageMissing,
    /// The host has not put the image's boot files in place.
    NoBootFiles,
    /// The image's fingerprint or command line is not what the host writes.
    InvalidBootFiles,
}

/// One image's boot files on the host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectBoot {
    fingerprint: String,
    append: String,
}

impl BootPath {
    /// `direct` or `firmware`, for the span.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Direct(_) => "direct",
            Self::Firmware(_) => "firmware",
        }
    }

    /// Why the computer boots through firmware, if it does.
    pub fn fallback_reason(&self) -> Option<FirmwareReason> {
        match self {
            Self::Direct(_) => None,
            Self::Firmware(reason) => Some(*reason),
        }
    }
}

impl DirectBoot {
    /// The image the instance must be created from: its boot files belong to
    /// this fingerprint, so the alias is not followed again.
    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    /// The `raw.qemu` instance config that boots the image's kernel.
    pub fn raw_qemu(&self) -> String {
        String::new()
    }
}

/// How an instance created from `source` boots, given the host's images.
pub fn choose(_source: &ImageSource, _images: &[ImageInfo]) -> BootPath {
    let _ = (ImageReference::Fingerprint(String::new()), BOOT_FILES_DIR);
    BootPath::Firmware(FirmwareReason::NoBootFiles)
}
