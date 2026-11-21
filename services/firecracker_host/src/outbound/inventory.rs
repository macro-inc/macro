//! Which jails exist on the host: the jailer's chroots under
//! `jails/firecracker/` and the VM cgroups under `<unit>/vms`. A process
//! outlives the agent, so after a crash either can exist without a record
//! that points at it.

use std::collections::BTreeSet;
use std::io::ErrorKind;
use std::path::Path;

use crate::domain::ports::Jail;
use crate::outbound::layout::JailId;

#[cfg(test)]
mod test;

/// Jail names in `chroots` (the jailer's `<base>/firecracker`) and
/// `cgroups` (the VMs' parent cgroup), by owner. A missing directory has
/// none; any other read failure is returned.
pub fn jails(chroots: &Path, cgroups: &Path) -> std::io::Result<Vec<Jail>> {
    let mut names = BTreeSet::new();
    for directory in [chroots, cgroups] {
        let entries = match std::fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        for entry in entries {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            if let Some(name) = entry.file_name().to_str() {
                names.insert(name.to_owned());
            }
        }
    }
    Ok(names.iter().map(|name| owner(name)).collect())
}

/// Whose jail `name` is; a name the jailer could not have made is
/// unrecognized.
pub fn owner(name: &str) -> Jail {
    JailId::parse(name).map_or_else(|_| Jail::Unrecognized(name.to_owned()), |id| id.owner())
}
