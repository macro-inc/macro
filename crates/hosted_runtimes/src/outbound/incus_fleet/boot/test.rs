use std::collections::BTreeMap;

use incus_client::{ImageAlias, ImageProtocol, ImageRemote, InstanceKind};

use super::*;

const FINGERPRINT: &str = "72a70af8772a410d53e151b0ff3b76638ed436d1a9685237b8717553b2d00eb1";
const APPEND: &str = "init=/nix/store/sy4vysfr3cip99sa1x676vdjp644wjna-nixos-system-macro-computer/init console=tty1 console=ttyS0 quiet root=fstab loglevel=3";

fn macro_box_alias() -> ImageSource {
    ImageSource {
        reference: ImageReference::Alias(ImageAlias::try_new("macro-box/2026-11-17").unwrap()),
        remote: None,
    }
}

fn listed(properties: &[(&str, &str)]) -> Vec<ImageInfo> {
    vec![
        ImageInfo {
            fingerprint: "51ec8110e72849c2c96d0301b480a9b4a16af93907fc484728e01011cddeb1a3"
                .to_owned(),
            aliases: vec![ImageAlias::try_new("macro-box/2026-11-13").unwrap()],
            kind: InstanceKind::VirtualMachine,
            size_bytes: 1,
            properties: BTreeMap::new(),
        },
        ImageInfo {
            fingerprint: FINGERPRINT.to_owned(),
            aliases: vec![ImageAlias::try_new("macro-box/2026-11-17").unwrap()],
            kind: InstanceKind::VirtualMachine,
            size_bytes: 1,
            properties: properties
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect(),
        },
    ]
}

#[test]
fn an_image_whose_boot_files_are_on_the_host_boots_its_kernel_directly() {
    let boot = choose(
        &macro_box_alias(),
        &listed(&[("os", "NixOS"), (BOOT_APPEND_PROPERTY, APPEND)]),
    );

    let BootPath::Direct(direct) = &boot else {
        panic!("expected a direct boot, got {boot:?}");
    };
    assert_eq!(direct.fingerprint(), FINGERPRINT);
    assert_eq!(
        direct.raw_qemu(),
        "-kernel /var/lib/macro-box/boot/72a70af8772a410d53e151b0ff3b76638ed436d1a9685237b8717553b2d00eb1/kernel \
         -initrd /var/lib/macro-box/boot/72a70af8772a410d53e151b0ff3b76638ed436d1a9685237b8717553b2d00eb1/initrd \
         -append 'init=/nix/store/sy4vysfr3cip99sa1x676vdjp644wjna-nixos-system-macro-computer/init console=tty1 console=ttyS0 quiet root=fstab loglevel=3'"
    );
    assert_eq!(boot.label(), "direct");
    assert_eq!(boot.fallback_reason(), None);
}

#[test]
fn a_fingerprint_reference_finds_its_image_too() {
    let source = ImageSource {
        reference: ImageReference::Fingerprint(FINGERPRINT.to_owned()),
        remote: None,
    };

    let boot = choose(&source, &listed(&[(BOOT_APPEND_PROPERTY, APPEND)]));

    assert!(matches!(boot, BootPath::Direct(_)), "{boot:?}");
}

#[test]
fn an_image_without_boot_files_on_the_host_boots_through_firmware() {
    let boot = choose(&macro_box_alias(), &listed(&[("os", "NixOS")]));

    assert_eq!(boot, BootPath::Firmware(FirmwareReason::NoBootFiles));
    assert_eq!(boot.label(), "firmware");
    assert_eq!(
        boot.fallback_reason()
            .map(|reason| reason.as_ref().to_owned()),
        Some("no_boot_files".to_owned())
    );
}

#[test]
fn an_image_the_host_does_not_list_boots_through_firmware() {
    let source = ImageSource {
        reference: ImageReference::Alias(ImageAlias::try_new("macro-box/2026-12-01").unwrap()),
        remote: None,
    };

    assert_eq!(
        choose(&source, &listed(&[(BOOT_APPEND_PROPERTY, APPEND)])),
        BootPath::Firmware(FirmwareReason::ImageMissing)
    );
}

#[test]
fn a_remote_image_boots_through_firmware() {
    let source = ImageSource {
        reference: ImageReference::Alias(ImageAlias::try_new("macro-box/2026-11-17").unwrap()),
        remote: Some(ImageRemote {
            server: "https://images.example.com".to_owned(),
            protocol: ImageProtocol::Simplestreams,
        }),
    };

    assert_eq!(
        choose(&source, &listed(&[(BOOT_APPEND_PROPERTY, APPEND)])),
        BootPath::Firmware(FirmwareReason::RemoteImage)
    );
}

#[test]
fn a_command_line_the_host_would_not_write_boots_through_firmware() {
    for append in [
        // Would end raw.qemu's quoting.
        "init=/nix/store/abc-nixos-system/init quiet' -device evil",
        "init=/nix/store/abc-nixos-system/init\n-device evil",
        // Not a NixOS system's init.
        "init=/bin/sh",
        "",
    ] {
        assert_eq!(
            choose(
                &macro_box_alias(),
                &listed(&[(BOOT_APPEND_PROPERTY, append)])
            ),
            BootPath::Firmware(FirmwareReason::InvalidBootFiles),
            "{append:?}"
        );
    }
}
