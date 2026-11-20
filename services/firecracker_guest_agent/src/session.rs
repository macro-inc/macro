//! One exec: read the start frame, run the program, stream its output, report
//! its exit. The host closing the connection kills the program.

use std::os::unix::process::ExitStatusExt;
use std::process::Stdio;

use firecracker_host_api::exec::{ExecRequest, Frame, FrameError, read_frame, write_frame};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;

#[cfg(test)]
mod test;

/// Bytes read from the program's stdout or stderr per frame.
const OUTPUT_CHUNK_BYTES: usize = 64 * 1024;

/// Frames queued for the host before the program's output waits.
const OUTGOING_FRAMES: usize = 64;

/// Serve one connection until the program's exit has been reported.
pub async fn serve(stream: impl AsyncRead + AsyncWrite + Send + 'static) -> Result<(), FrameError> {
    let (mut reader, mut writer) = tokio::io::split(stream);

    let request = match read_frame(&mut reader).await? {
        Some(Frame::Start(request)) => request,
        Some(_) => {
            let failed = Frame::Failed("the first exec frame must be start".to_owned());
            return write_frame(&mut writer, &failed).await;
        }
        None => return Ok(()),
    };
    // The host agent's trace id: this agent exports no traces, so its log
    // lines are found from the host's trace by this field.
    let span = tracing::info_span!(
        "firecracker_guest_agent.exec",
        trace_id = request.trace_id.as_deref().unwrap_or_default(),
        program = request.argv.first().map(String::as_str).unwrap_or_default(),
        uid = request.uid,
    );
    tracing::Instrument::instrument(run(request, reader, writer), span).await
}

/// Run `request`'s program and relay its frames until its exit is reported.
async fn run(
    request: ExecRequest,
    reader: impl AsyncRead + Send + Unpin + 'static,
    mut writer: impl AsyncWrite + Send + Unpin + 'static,
) -> Result<(), FrameError> {
    let mut child = match spawn(&request) {
        Ok(child) => child,
        Err(error) => {
            tracing::warn!(error = ?error, "could not start the program");
            let failed = Frame::Failed(format!("could not start {:?}: {error}", request.argv));
            return write_frame(&mut writer, &failed).await;
        }
    };
    // Its arrival, so a host-side wait splits into the exec arriving late
    // and the program taking long.
    tracing::info!(pid = child.id(), "exec started");

    // Every frame for the host goes through one writer task, so stdout and
    // stderr chunks never interleave inside a frame.
    let (outgoing, mut outgoing_frames) = mpsc::channel::<Frame>(OUTGOING_FRAMES);
    let writer_task = tokio::spawn(async move {
        while let Some(frame) = outgoing_frames.recv().await {
            write_frame(&mut writer, &frame).await?;
        }
        Ok::<_, FrameError>(())
    });

    let stdout_pump = child
        .stdout
        .take()
        .map(|stdout| tokio::spawn(pump(stdout, outgoing.clone(), Frame::Stdout)));
    let stderr_pump = child
        .stderr
        .take()
        .map(|stderr| tokio::spawn(pump(stderr, outgoing.clone(), Frame::Stderr)));
    let mut input = tokio::spawn(feed_stdin(reader, child.stdin.take()));

    let exit_frame = tokio::select! {
        status = child.wait() => match status {
            Ok(status) => {
                // Drain what the program wrote before reporting its exit.
                for pump in [stdout_pump, stderr_pump].into_iter().flatten() {
                    let _ = pump.await;
                }
                Frame::Exited(exit_code(status))
            }
            Err(error) => Frame::Failed(format!("could not wait for the program: {error}")),
        },
        // The host went away (or broke the protocol): nobody reads the
        // output any more, so the program goes too.
        _ = &mut input => {
            kill(&mut child).await;
            return Ok(());
        }
    };
    input.abort();
    match &exit_frame {
        Frame::Exited(code) => tracing::info!(exit_code = code, "exec ended"),
        Frame::Failed(reason) => tracing::warn!(reason = %reason, "exec failed"),
        _ => {}
    }

    // A full queue only means the host reads slowly; the exit still goes last.
    let _ = outgoing.send(exit_frame).await;
    drop(outgoing);
    writer_task
        .await
        .map_err(|error| FrameError::Io(std::io::Error::other(error)))?
}

fn spawn(request: &ExecRequest) -> std::io::Result<Child> {
    let (program, arguments) = request
        .argv
        .split_first()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "empty argv"))?;

    // With `PATH` in the request's environment, `Command` looks the program
    // up there, not in the agent's.
    let mut command = Command::new(program);
    command
        .args(arguments)
        .env_clear()
        .envs(&request.env)
        .current_dir(&request.cwd)
        .uid(request.uid)
        .gid(request.gid)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command.spawn()
}

async fn pump(
    mut output: impl AsyncRead + Unpin,
    outgoing: mpsc::Sender<Frame>,
    frame: fn(Vec<u8>) -> Frame,
) {
    let mut buffer = vec![0u8; OUTPUT_CHUNK_BYTES];
    loop {
        match output.read(&mut buffer).await {
            Ok(0) | Err(_) => return,
            Ok(read) => {
                if outgoing.send(frame(buffer[..read].to_vec())).await.is_err() {
                    return;
                }
            }
        }
    }
}

/// Copy the host's stdin frames to the program until the host closes the
/// connection; returns then, which kills the program if it still runs.
async fn feed_stdin(mut reader: impl AsyncRead + Unpin, mut stdin: Option<ChildStdin>) {
    loop {
        match read_frame(&mut reader).await {
            Ok(Some(Frame::Stdin(bytes))) => {
                if let Some(pipe) = stdin.as_mut()
                    && pipe.write_all(&bytes).await.is_err()
                {
                    stdin = None;
                }
            }
            Ok(Some(Frame::CloseStdin)) => stdin = None,
            Ok(Some(_)) | Ok(None) | Err(_) => return,
        }
    }
}

async fn kill(child: &mut Child) {
    let _ = child.start_kill();
    let _ = child.wait().await;
}

/// The exit code, or 128 + the signal that killed the program, as shells do.
fn exit_code(status: std::process::ExitStatus) -> i32 {
    match (status.code(), status.signal()) {
        (Some(code), _) => code,
        (None, Some(signal)) => 128 + signal,
        (None, None) => -1,
    }
}
