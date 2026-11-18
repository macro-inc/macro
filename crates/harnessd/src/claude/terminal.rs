//! A program in a pseudo-terminal, its output rendered through a terminal
//! emulator so callers read the screen a person would see.

use rustix::fs::{Mode, OFlags};
use rustix::pty::OpenptFlags;
use rustix::termios::Winsize;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::watch;

/// The screen as of the last output.
#[derive(Debug, Clone, Default)]
pub struct Screen {
    /// Each row's text.
    pub rows: Vec<String>,
    /// Increases with every chunk of output.
    pub generation: u64,
    /// The program closed the terminal: it exited.
    pub closed: bool,
}

/// Why [`Terminal::wait_for`] gave up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaitError {
    Timeout,
    Closed,
}

/// What a terminal's program is started with.
pub struct Launch<'a> {
    pub program: &'a Path,
    pub arguments: &'a [&'a str],
    pub remove_environment: &'a [&'a str],
    pub environment: &'a [(OsString, OsString)],
    pub columns: u16,
    pub rows: u16,
}

pub struct Terminal {
    child: Mutex<tokio::process::Child>,
    process_group: Option<rustix::process::Pid>,
    input: Mutex<std::fs::File>,
    screen: watch::Receiver<Screen>,
}

impl Terminal {
    /// Start `launch.program` in a new pseudo-terminal of the given size.
    pub fn spawn(launch: Launch<'_>) -> std::io::Result<Self> {
        let primary =
            rustix::pty::openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY | OpenptFlags::CLOEXEC)?;
        rustix::pty::grantpt(&primary)?;
        rustix::pty::unlockpt(&primary)?;
        rustix::termios::tcsetwinsize(
            &primary,
            Winsize {
                ws_row: launch.rows,
                ws_col: launch.columns,
                ws_xpixel: 0,
                ws_ypixel: 0,
            },
        )?;
        let secondary_path = rustix::pty::ptsname(&primary, Vec::new())?;
        let secondary = rustix::fs::open(
            secondary_path.as_c_str(),
            OFlags::RDWR | OFlags::NOCTTY | OFlags::CLOEXEC,
            Mode::empty(),
        )?;

        let mut command = tokio::process::Command::new(launch.program);
        command
            .args(launch.arguments)
            .env("TERM", "xterm-256color")
            .stdin(Stdio::from(secondary.try_clone()?))
            .stdout(Stdio::from(secondary.try_clone()?))
            .stderr(Stdio::from(secondary))
            // Its own group, so closing it ends anything it started too.
            .process_group(0)
            .kill_on_drop(true);
        for (name, value) in launch.environment {
            command.env(name, value);
        }
        for name in launch.remove_environment {
            command.env_remove(name);
        }
        let child = command.spawn()?;
        // Drops the command's copies of the secondary side, so reads see the
        // end once the program exits.
        drop(command);
        let process_group = child
            .id()
            .and_then(|id| rustix::process::Pid::from_raw(i32::try_from(id).ok()?));

        let primary = std::fs::File::from(primary);
        let output = primary.try_clone()?;
        let (screen_sender, screen) = watch::channel(Screen::default());
        let (rows, columns) = (launch.rows, launch.columns);
        std::thread::Builder::new()
            .name("harnessd-terminal".to_owned())
            .spawn(move || render(output, rows, columns, screen_sender))?;

        Ok(Self {
            child: Mutex::new(child),
            process_group,
            input: Mutex::new(primary),
            screen,
        })
    }

    /// Type `bytes` into the program.
    pub fn write(&self, bytes: &[u8]) -> std::io::Result<()> {
        let mut input = self
            .input
            .lock()
            .map_err(|_| std::io::Error::other("terminal input lock poisoned"))?;
        input.write_all(bytes)?;
        input.flush()
    }

    /// The current screen.
    pub fn screen(&self) -> Screen {
        self.screen.borrow().clone()
    }

    /// Wait until `read` finds what it looks for on the screen.
    pub async fn wait_for<Found>(
        &self,
        timeout: Duration,
        read: impl Fn(&Screen) -> Option<Found>,
    ) -> Result<Found, WaitError> {
        let mut screen = self.screen.clone();
        let deadline = tokio::time::sleep(timeout);
        tokio::pin!(deadline);
        loop {
            {
                let current = screen.borrow_and_update();
                if let Some(found) = read(&current) {
                    return Ok(found);
                }
                if current.closed {
                    return Err(WaitError::Closed);
                }
            }

            tokio::select! {
                changed = screen.changed() => {
                    if changed.is_err() {
                        return Err(WaitError::Closed);
                    }
                }
                () = &mut deadline => return Err(WaitError::Timeout),
            }
        }
    }

    /// Whether the program exited.
    pub fn closed(&self) -> bool {
        self.screen.borrow().closed
    }

    /// End the program and everything it started.
    pub fn kill(&self) {
        if let Some(process_group) = self.process_group {
            // Fails only when the group is already gone.
            let _ =
                rustix::process::kill_process_group(process_group, rustix::process::Signal::KILL);
        }
        if let Ok(mut child) = self.child.lock() {
            let _ = child.start_kill();
        }
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Feed the program's output through the emulator until it closes.
fn render(mut output: std::fs::File, rows: u16, columns: u16, screen: watch::Sender<Screen>) {
    let mut parser = vt100::Parser::new(rows, columns, 0);
    let mut buffer = [0_u8; 8192];
    loop {
        // Linux answers EIO once every copy of the secondary side closed.
        let read = match output.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        parser.process(&buffer[..read]);
        let rendered: Vec<String> = parser.screen().rows(0, columns).collect();
        screen.send_modify(|current| {
            current.rows = rendered;
            current.generation += 1;
        });
    }
    screen.send_modify(|current| current.closed = true);
}
