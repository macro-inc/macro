//! `teammate-boot run`: an agent teammate's launcher, inside its sandbox
//! (the container or the hosted unit). It counts the previous run, rolls
//! the code back when it must, prepares the workspace and then becomes
//! `bun cli.ts run`; or it exits with the code that says why it didn't
//! (`teammate_lifecycle::exit`). It replaces `start-agent` and
//! `agent-stopped`.
//!
//! It runs only on Unix (the container and the hosted guest are Linux).

#[cfg(unix)]
mod unix {

    use std::path::PathBuf;
    use std::process::ExitCode;

    use clap::{Parser, Subcommand};
    use teammate_lifecycle::exit::{PREVIOUS_EXIT_VARIABLE, PreviousExit};
    use teammate_lifecycle::runner::git::ProcessGit;
    use teammate_lifecycle::runner::local::{BunRuntime, LocalFs};
    use teammate_lifecycle::runner::{Boot, BootOutcome, BootPaths, Runtime as _};

    #[derive(Debug, Parser)]
    #[command(name = "teammate-boot", about = "Start an agent teammate's runtime")]
    struct Arguments {
        #[command(subcommand)]
        command: Command,
    }

    #[derive(Debug, Subcommand)]
    enum Command {
        /// Boot and run the runtime.
        Run(RunArguments),
    }

    #[derive(Debug, clap::Args)]
    struct RunArguments {
        /// The repository clone.
        #[arg(long)]
        workspace: PathBuf,
        /// The `last-good` state file.
        #[arg(long)]
        last_good: PathBuf,
        /// The `failed-boots` state file.
        #[arg(long)]
        failed_boots: PathBuf,
        /// The `boot-head` state file.
        #[arg(long)]
        boot_head: PathBuf,
        /// The image's runtime directory (its `bun.lock` and `node_modules`).
        #[arg(long)]
        runtime: PathBuf,
        /// The git credential helper program.
        #[arg(long)]
        credential_helper: PathBuf,
        /// The credentials file the helper reads.
        #[arg(long)]
        helper_credentials: PathBuf,
        /// `agent.env`.
        #[arg(long, env = "MUPPET_CREDENTIALS_FILE")]
        credentials: PathBuf,
        /// The previous run's exit as the supervisor saw it: `unknown` or a
        /// code.
        #[arg(long, env = PREVIOUS_EXIT_VARIABLE)]
        previous_exit: PreviousExit,
    }

    /// A boot that failed on an effect is a crash, counted like one.
    const FAILED: u8 = 1;

    /// A stop's signal during the boot: 128 + SIGTERM, a clean stop to the
    /// supervisor that asked for it.
    const TERMINATED: u8 = 143;

    pub(crate) fn main() -> ExitCode {
        tracing_subscriber::fmt()
            .with_writer(std::io::stderr)
            .with_target(false)
            .with_ansi(false)
            .init();
        let Arguments {
            command: Command::Run(arguments),
        } = Arguments::parse();
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                tracing::error!(error = %error, "could not start");
                return ExitCode::from(FAILED);
            }
        };
        let paths = BootPaths {
            workspace: arguments.workspace,
            last_good: arguments.last_good,
            failed_boots: arguments.failed_boots,
            boot_head: arguments.boot_head,
            runtime: arguments.runtime,
            credentials: arguments.credentials,
        };
        let boot = Boot {
            git: ProcessGit::new(
                paths.workspace.clone(),
                &arguments.credential_helper,
                &arguments.helper_credentials,
            ),
            fs: LocalFs,
            paths: &paths,
        };

        let outcome = runtime.block_on(async {
            let terminate =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate());
            let Ok(mut terminate) = terminate else {
                return Some(boot.run(arguments.previous_exit).await);
            };
            // A stop drops the boot, and with it every child's process group.
            tokio::select! {
                outcome = boot.run(arguments.previous_exit) => Some(outcome),
                _ = terminate.recv() => None,
            }
        });
        drop(runtime);

        match outcome {
            None => ExitCode::from(TERMINATED),
            Some(Err(error)) => {
                tracing::error!(error = %error, "the boot failed");
                ExitCode::from(FAILED)
            }
            Some(Ok(BootOutcome::Exit(end))) => {
                tracing::error!(code = end.code(), "{end}");
                ExitCode::from(end.code())
            }
            Some(Ok(BootOutcome::Run { head })) => {
                // The docker contract test waits for this line.
                eprintln!("starting the runtime at {head}");
                let error = BunRuntime.exec(&paths.workspace);
                tracing::error!(error = %error, "could not start the runtime");
                ExitCode::from(FAILED)
            }
        }
    }
}

#[cfg(unix)]
fn main() -> std::process::ExitCode {
    unix::main()
}

#[cfg(not(unix))]
fn main() -> std::process::ExitCode {
    eprintln!("teammate-boot runs only on Linux");
    std::process::ExitCode::FAILURE
}
