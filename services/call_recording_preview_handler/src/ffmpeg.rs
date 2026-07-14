#[cfg(test)]
mod test;

use std::{path::Path, process::Output, time::Duration};

use anyhow::{Context, bail};
use tokio::process::Command;

const COMMAND_OUTPUT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
pub(crate) struct FfmpegTools {
    ffmpeg_path: std::path::PathBuf,
    ffprobe_path: std::path::PathBuf,
}

impl FfmpegTools {
    pub(crate) fn new(
        ffmpeg_path: impl Into<std::path::PathBuf>,
        ffprobe_path: impl Into<std::path::PathBuf>,
    ) -> Self {
        Self {
            ffmpeg_path: ffmpeg_path.into(),
            ffprobe_path: ffprobe_path.into(),
        }
    }

    #[tracing::instrument(skip(self, source_url), err)]
    pub(crate) async fn create_preview_jpeg(
        &self,
        source_url: &str,
        output_path: &Path,
    ) -> anyhow::Result<()> {
        let duration = probe_duration(&self.ffprobe_path, source_url).await?;
        let midpoint_seconds = duration / 2.0;

        extract_frame_with_fallback(&self.ffmpeg_path, source_url, midpoint_seconds, output_path)
            .await
    }
}

#[tracing::instrument(skip(source_url), err)]
pub(crate) async fn probe_duration(ffprobe_path: &Path, source_url: &str) -> anyhow::Result<f64> {
    let mut command = Command::new(ffprobe_path);
    command
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=1")
        .arg(source_url);

    let output = command_output(&mut command, "ffprobe").await?;

    ensure_command_success(&output, "ffprobe")?;
    let stdout = std::str::from_utf8(&output.stdout).context("ffprobe output was not UTF-8")?;

    parse_duration(stdout)
}

pub(crate) fn parse_duration(output: &str) -> anyhow::Result<f64> {
    let duration_text = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .context("ffprobe did not return a duration")?;

    let duration = duration_text
        .parse::<f64>()
        .with_context(|| format!("failed to parse ffprobe duration {duration_text:?}"))?;

    if duration.is_finite() && duration >= 0.0 {
        return Ok(duration);
    }

    bail!("ffprobe returned invalid duration {duration}")
}

#[tracing::instrument(skip(source_url), err)]
async fn extract_frame_with_fallback(
    ffmpeg_path: &Path,
    source_url: &str,
    midpoint_seconds: f64,
    output_path: &Path,
) -> anyhow::Result<()> {
    remove_file_if_present(output_path).await?;

    let midpoint_result =
        extract_frame(ffmpeg_path, source_url, midpoint_seconds, output_path).await;
    if file_has_data(output_path).await? {
        return Ok(());
    }

    match midpoint_result {
        Ok(()) => tracing::warn!("midpoint ffmpeg extraction produced no frame; retrying at start"),
        Err(error) => {
            tracing::warn!(error=?error, "midpoint ffmpeg extraction failed without a frame; retrying at start");
        }
    }

    remove_file_if_present(output_path).await?;
    extract_frame(ffmpeg_path, source_url, 0.0, output_path)
        .await
        .context("failed to extract preview frame at start of recording")?;

    if file_has_data(output_path).await? {
        return Ok(());
    }

    bail!("ffmpeg completed but did not create a preview frame")
}

#[tracing::instrument(skip(source_url), err)]
async fn extract_frame(
    ffmpeg_path: &Path,
    source_url: &str,
    seek_seconds: f64,
    output_path: &Path,
) -> anyhow::Result<()> {
    let mut command = Command::new(ffmpeg_path);
    command
        .arg("-y")
        .arg("-ss")
        .arg(format_seek_seconds(seek_seconds))
        .arg("-i")
        .arg(source_url)
        .arg("-frames:v")
        .arg("1")
        .arg("-q:v")
        .arg("2")
        .arg(output_path);

    let output = command_output(&mut command, "ffmpeg").await?;

    ensure_command_success(&output, "ffmpeg")
}

async fn command_output(command: &mut Command, command_name: &str) -> anyhow::Result<Output> {
    command.kill_on_drop(true);
    let output = tokio::time::timeout(COMMAND_OUTPUT_TIMEOUT, command.output())
        .await
        .with_context(|| format!("timed out running {command_name}"))?;

    output.with_context(|| format!("failed to run {command_name}"))
}

fn ensure_command_success(output: &Output, command_name: &str) -> anyhow::Result<()> {
    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    bail!(
        "{command_name} failed with status {}. stdout: {} stderr: {}",
        output.status,
        stdout.trim(),
        stderr.trim(),
    )
}

async fn file_has_data(path: &Path) -> anyhow::Result<bool> {
    match tokio::fs::metadata(path).await {
        Ok(metadata) => Ok(metadata.len() > 0),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("failed to inspect {}", path.display())),
    }
}

async fn remove_file_if_present(path: &Path) -> anyhow::Result<()> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to remove {}", path.display())),
    }
}

fn format_seek_seconds(seconds: f64) -> String {
    format!("{seconds:.3}")
}
