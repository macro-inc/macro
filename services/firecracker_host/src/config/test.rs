use std::time::Duration;

use super::{Config, ConfigError, DiskStorage, Invalid};

/// A complete file, as the host's NixOS module writes it.
const FILE: &str = r#"
host_name = "microvm-1"
listen = "100.64.0.7:8444"

[tls]
certificate = "/run/credentials/tls-certificate"
key = "/run/credentials/tls-key"
client_certificates = ["/run/credentials/client-0"]

[binaries]
firecracker = "/opt/firecracker/bin/firecracker"
jailer = "/opt/firecracker/bin/jailer"
firecracker_version = "v1.18.0"

[storage]
images_dir = "/srv/images"
golden_root_disk_gib = 20

[storage.disks]
kind = "zfs"
dataset = "tank/firecracker"

[network]
slots = 64
prefix = "fch"
veth_base = "10.201.0.0"
dns = ["1.1.1.1"]
uplink = "ens4"
api_sources = ["100.64.0.1"]

[jail]
uid_base = 1000000000
memory_overhead_mib = 256

[guest]
shutdown_grace = 30
golden_boot_timeout = 600
guest_agent_timeout = 30
"#;

fn checked(text: &str) -> Result<Config, ConfigError> {
    let config: Config = toml::from_str(text).map_err(|source| ConfigError::Parse {
        path: "test.toml".into(),
        source,
    })?;
    config.check()?;
    Ok(config)
}

#[test]
fn a_complete_file_loads_with_defaults_for_what_it_leaves_out() {
    let config = checked(FILE).unwrap();
    assert_eq!(config.network.slots, 64);
    assert!(matches!(
        config.storage.disks,
        DiskStorage::Zfs { ref dataset } if dataset == "tank/firecracker"
    ));
    assert_eq!(config.guest.shutdown_grace, Duration::from_secs(30));
    assert_eq!(config.guest.concurrent_launches, 8);
    assert!(config.network.guest_destinations.is_empty());
    assert!(config.network.control_plane.is_none());
}

#[test]
fn an_xfs_directory_is_the_other_storage() {
    let text = FILE.replace(
        "kind = \"zfs\"\ndataset = \"tank/firecracker\"",
        "kind = \"xfs\"\ndirectory = \"/srv/durable\"",
    );
    let config = checked(&text).unwrap();
    assert!(matches!(config.storage.disks, DiskStorage::Xfs { .. }));
}

#[test]
fn an_unknown_key_fails() {
    let text = FILE.replace("[jail]\n", "[jail]\nnice = 5\n");
    assert!(matches!(checked(&text), Err(ConfigError::Parse { .. })));
}

#[test]
fn a_missing_key_fails() {
    let text = FILE.replace("uplink = \"ens4\"\n", "");
    assert!(matches!(checked(&text), Err(ConfigError::Parse { .. })));
}

#[test]
fn a_wildcard_listen_is_refused() {
    let text = FILE.replace("100.64.0.7:8444", "0.0.0.0:8444");
    assert!(matches!(
        checked(&text),
        Err(ConfigError::Invalid(Invalid::WildcardListen))
    ));
}

#[test]
fn guests_need_a_resolver() {
    let text = FILE.replace("dns = [\"1.1.1.1\"]", "dns = []");
    assert!(matches!(
        checked(&text),
        Err(ConfigError::Invalid(Invalid::NoDns))
    ));
}

#[test]
fn slots_fit_the_veth_range() {
    for slots in ["0", "16385"] {
        let text = FILE.replace("slots = 64", &format!("slots = {slots}"));
        assert!(
            matches!(
                checked(&text),
                Err(ConfigError::Invalid(Invalid::SlotCount))
            ),
            "{slots}"
        );
    }
    let text = FILE.replace("slots = 64", "slots = 16384");
    assert!(checked(&text).is_ok());
}

#[test]
fn the_prefix_names_interfaces() {
    for prefix in ["", "toolong7", "Fch", "f-h"] {
        let text = FILE.replace("prefix = \"fch\"", &format!("prefix = \"{prefix}\""));
        assert!(
            matches!(
                checked(&text),
                Err(ConfigError::Invalid(Invalid::NetworkPrefix))
            ),
            "{prefix:?}"
        );
    }
}

#[test]
fn vm_uids_stay_clear_of_system_users() {
    let text = FILE.replace("uid_base = 1000000000", "uid_base = 30000");
    assert!(matches!(
        checked(&text),
        Err(ConfigError::Invalid(Invalid::UidBase))
    ));
}

#[test]
fn launches_and_client_certificates_cannot_be_empty() {
    let text = FILE.replace(
        "guest_agent_timeout = 30\n",
        "guest_agent_timeout = 30\nconcurrent_launches = 0\n",
    );
    assert!(matches!(
        checked(&text),
        Err(ConfigError::Invalid(Invalid::NoLaunches))
    ));
    let text = FILE.replace(
        "client_certificates = [\"/run/credentials/client-0\"]",
        "client_certificates = []",
    );
    assert!(matches!(
        checked(&text),
        Err(ConfigError::Invalid(Invalid::NoClientCertificates))
    ));
}
