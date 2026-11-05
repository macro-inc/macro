//! A child process on a hidden pseudo-terminal, for CLIs that only talk to a
//! TTY. Everything the child prints accumulates in a watch channel, so a
//! caller waits for the text it needs rather than polling.

use std::ffi::OsStr;
use std::io::{Read as _, Write as _};
use std::os::fd::{AsFd as _, BorrowedFd, OwnedFd};
use std::os::unix::ffi::OsStrExt as _;
use std::os::unix::process::CommandExt as _;
use std::path::Path;
use std::process::{Child, Command, Stdio};

use rootcause::prelude::ResultExt as _;
use tokio::sync::watch;

/// Wide enough that no URL or token the CLI prints wraps.
const COLUMNS: u16 = 2000;
const ROWS: u16 = 50;
/// Output kept for matching; a TUI redrawing forever must not grow it forever.
const MAX_OUTPUT: usize = 1 << 20;

/// A running child on its own pseudo-terminal, killed with its session on
/// drop.
pub struct Pty {
    child: Child,
    master: std::fs::File,
    output: watch::Receiver<String>,
}

impl Pty {
    /// Spawn `program` with `args` as the session leader of a new terminal.
    pub fn spawn(program: &Path, args: &[&str]) -> rootcause::Result<Self> {
        use rustix::pty::{OpenptFlags, grantpt, openpt, ptsname, unlockpt};

        let master = openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY | OpenptFlags::CLOEXEC)
            .context("could not open a pseudo-terminal")?;
        grantpt(&master).context("could not grant the pseudo-terminal")?;
        unlockpt(&master).context("could not unlock the pseudo-terminal")?;
        let name = ptsname(&master, Vec::new()).context("could not name the pseudo-terminal")?;
        rustix::termios::tcsetwinsize(
            &master,
            rustix::termios::Winsize {
                ws_row: ROWS,
                ws_col: COLUMNS,
                ws_xpixel: 0,
                ws_ypixel: 0,
            },
        )
        .context("could not size the pseudo-terminal")?;
        let terminal: OwnedFd = rustix::fs::open(
            Path::new(OsStr::from_bytes(name.as_bytes())),
            rustix::fs::OFlags::RDWR | rustix::fs::OFlags::NOCTTY | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .context("could not open the pseudo-terminal's other end")?;

        let mut command = Command::new(program);
        command
            .args(args)
            .env("TERM", "xterm-256color")
            .stdin(Stdio::from(
                terminal
                    .try_clone()
                    .context("could not share the terminal")?,
            ))
            .stdout(Stdio::from(
                terminal
                    .try_clone()
                    .context("could not share the terminal")?,
            ))
            .stderr(Stdio::from(terminal));
        // SAFETY: only async-signal-safe syscalls between fork and exec.
        unsafe {
            command.pre_exec(|| {
                rustix::process::setsid()?;
                // Standard input is the terminal by now; make it this
                // session's controlling terminal, as a shell would.
                rustix::process::ioctl_tiocsctty(BorrowedFd::borrow_raw(0))?;
                Ok(())
            });
        }
        let child = command
            .spawn()
            .context(format!("could not start {}", program.display()))?;

        let mut reader = std::fs::File::from(
            master
                .as_fd()
                .try_clone_to_owned()
                .context("could not share the pseudo-terminal")?,
        );
        let (sender, output) = watch::channel(String::new());
        std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            // Ends at EOF or EIO, both meaning the child's side closed.
            while let Ok(read) = reader.read(&mut buffer) {
                if read == 0 {
                    break;
                }
                let chunk = String::from_utf8_lossy(&buffer[..read]).into_owned();
                sender.send_modify(|output| {
                    if output.len() + chunk.len() > MAX_OUTPUT {
                        output.clear();
                    }
                    output.push_str(&chunk);
                });
            }
        });

        Ok(Self {
            child,
            master: std::fs::File::from(master),
            output,
        })
    }

    /// Wait until `find` matches the output so far, or the child closes its
    /// terminal.
    pub async fn wait_for<Found>(
        &mut self,
        find: impl Fn(&str) -> Option<Found>,
    ) -> rootcause::Result<Found> {
        let mut found = None;
        let waited = self
            .output
            .wait_for(|output| {
                found = find(output);
                found.is_some()
            })
            .await;
        match (waited, found) {
            (Ok(_), Some(found)) => Ok(found),
            _ => rootcause::bail!("the program exited before printing what was expected"),
        }
    }

    /// Type `text` and press Enter.
    pub fn type_line(&mut self, text: &str) -> rootcause::Result<()> {
        self.master
            .write_all(format!("{text}\r").as_bytes())
            .context("could not type into the pseudo-terminal")?;
        Ok(())
    }
}

impl Drop for Pty {
    fn drop(&mut self) {
        let pid = rustix::process::Pid::from_child(&self.child);
        let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
