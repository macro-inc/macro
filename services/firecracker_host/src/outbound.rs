//! Adapters: Firecracker, the jailer, files, netns, cgroups.

pub mod cgroup;
pub mod disks;
pub mod file_clone;
pub mod firecracker_api;
pub mod goldens;
pub mod host_checks;
pub mod inventory;
pub mod jails;
pub mod layout;
pub mod network;
pub mod probe;
pub mod replication;
pub mod secret_scan;
pub mod store;
pub mod zfs;
