//! Best-effort discovery of the harness child process, for display.
//!
//! The ACP SDK spawns the harness inside its connection and keeps the child
//! handle to itself, so the only way to name its pid is to look at this
//! process's own children. Display-only: `None` here says nothing reliable
//! about whether a harness is running.

#[cfg(test)]
mod test;

/// A direct child of this process: pid and command basename.
pub(crate) type Child = (u32, String);

/// The pid and name of the spawned harness process, when one can be found.
pub(crate) fn harness_child(harness_command: &str) -> Option<Child> {
    let output = std::process::Command::new("ps")
        .args(["-axo", "pid=,ppid=,comm="])
        .output()
        .ok()?;
    let table = String::from_utf8_lossy(&output.stdout);
    pick(children(&table, std::process::id()), harness_command)
}

/// Direct children of `parent` in a `ps -axo pid=,ppid=,comm=` table.
fn children(table: &str, parent: u32) -> Vec<Child> {
    table
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid: u32 = fields.next()?.parse().ok()?;
            let ppid: u32 = fields.next()?.parse().ok()?;
            // The command may itself contain spaces; the rest of the row is it.
            let command = fields.collect::<Vec<_>>().join(" ");
            (ppid == parent && !command.is_empty()).then(|| (pid, basename(&command)))
        })
        .collect()
}

/// Which child is the harness: the one named like the configured command, or
/// the only child there is - wrapper launchers (`npx`, `uvx`) run the agent
/// under another name, and with one child there is nothing else it could be.
fn pick(children: Vec<Child>, harness_command: &str) -> Option<Child> {
    let target = basename(harness_command);
    if let Some(found) = children.iter().find(|(_, name)| *name == target) {
        return Some(found.clone());
    }
    if children.len() == 1 {
        return children.into_iter().next();
    }
    None
}

/// The last path component, or the whole string when it has none.
fn basename(command: &str) -> String {
    std::path::Path::new(command)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| command.to_owned())
}
