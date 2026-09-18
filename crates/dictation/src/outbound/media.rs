//! Inspect browser recording containers without transcoding or temporary files.

use crate::domain::{AudioFormat, DictationError, Recording, RecordingInspector};
use std::{
    io::{Cursor, ErrorKind},
    time::Duration,
};
use symphonia::core::{
    codecs::{CodecParameters, audio::well_known::CODEC_ID_OPUS},
    errors::Error,
    formats::{FormatOptions, probe::Hint},
    io::MediaSourceStream,
    meta::MetadataOptions,
};

/// Symphonia demuxes WebM/Opus, MP4/AAC, Ogg/Opus, and WAV in memory.
/// Reading packet timestamps does not require an Opus decoder or re-encoding.
pub struct SymphoniaRecordingInspector;

impl RecordingInspector for SymphoniaRecordingInspector {
    #[tracing::instrument(name = "dictation.inspect_audio", skip_all, err, fields(
        audio.format = recording.format().extension(),
        audio.bytes = recording.bytes().len(),
    ))]
    async fn duration(&self, recording: Recording) -> Result<Duration, DictationError> {
        // Container parsing is CPU work; it must not block the async executor.
        // Blocking tasks do not inherit the request's tracing context.
        let span = tracing::Span::current();
        tokio::task::spawn_blocking(move || span.in_scope(|| inspect(recording)))
            .await
            .map_err(|error| {
                tracing::error!(panicked = error.is_panic(), "audio inspection task failed");
                DictationError::InvalidAudio
            })?
    }
}

#[tracing::instrument(name = "dictation.parse_audio", skip_all, err, fields(
    audio.duration_seconds = tracing::field::Empty,
    audio.packet_count = tracing::field::Empty,
    dictation.inspection_stage = "probe",
))]
fn inspect(recording: Recording) -> Result<Duration, DictationError> {
    let span = tracing::Span::current();
    let mut hint = Hint::new();
    hint.with_extension(recording.format().extension());
    let (bytes, format, _) = recording.into_parts();
    let source = MediaSourceStream::new(Box::new(Cursor::new(bytes)), Default::default());
    let mut reader = symphonia::default::get_probe()
        .probe(
            &hint,
            source,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|_| DictationError::InvalidAudio)?;
    span.record("dictation.inspection_stage", "track");
    let track = reader
        .tracks()
        .iter()
        .find(|track| {
            track
                .codec_params
                .as_ref()
                .is_some_and(CodecParameters::is_audio)
        })
        .ok_or(DictationError::InvalidAudio)?;
    let track_id = track.id;
    let codec = track
        .codec_params
        .as_ref()
        .and_then(CodecParameters::audio)
        .ok_or(DictationError::InvalidAudio)?
        .codec;
    let time_base = track.time_base.ok_or(DictationError::InvalidAudio)?;
    let mut end = 0.0_f64;
    let mut first = None;
    let mut packet_count = 0_u64;
    span.record("dictation.inspection_stage", "packets");
    loop {
        let packet = match reader.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            // MediaRecorder leaves its streaming WebM segment open at EOF.
            Err(Error::IoError(error))
                if format == AudioFormat::Webm && error.kind() == ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => return Err(DictationError::InvalidAudio),
        };
        if packet.track_id == track_id {
            packet_count += 1;
            let timestamp = time_base
                .calc_time(packet.pts)
                .ok_or(DictationError::InvalidAudio)?
                .as_secs_f64();
            // Chrome omits BlockDuration/DefaultDuration. Read Opus framing
            // through the codec library; no decoding or handwritten bit parser.
            let duration = if packet.dur.is_zero() && codec == CODEC_ID_OPUS {
                let samples = opus_pure::packet::samples_48k(&packet.data)
                    .map_err(|_| DictationError::InvalidAudio)?;
                samples as f64 / 48_000.0
            } else {
                time_base
                    .calc_duration(packet.dur)
                    .ok_or(DictationError::InvalidAudio)?
                    .as_secs_f64()
            };
            first.get_or_insert(timestamp);
            end = end.max(timestamp + duration);
        }
    }
    span.record("audio.packet_count", packet_count);
    span.record("dictation.inspection_stage", "duration");
    let seconds = end - first.ok_or(DictationError::InvalidAudio)?;
    if seconds <= 0.0 {
        return Err(DictationError::InvalidAudio);
    }
    let duration =
        Duration::try_from_secs_f64(seconds).map_err(|_| DictationError::InvalidAudio)?;
    span.record("audio.duration_seconds", duration.as_secs_f64());
    span.record("dictation.inspection_stage", "complete");
    Ok(duration)
}

#[cfg(test)]
mod test;
