//! Bounded pinned-object readers. Replays validate the prefix too, so ordering
//! across a resumed part boundary never relies on an in-memory previous worker.

use futures::StreamExt;
use sha2::{Digest, Sha256};

use crate::domain::{
    models::*,
    ports::{ByteStream, ImportStorage, PortResult},
    slack::{
        export::{ExportRecord, NormalizedRecord},
        users::{ExportUser, UserDirectory},
    },
};

pub(super) async fn users(
    storage: &impl ImportStorage,
    upload: &VerifiedUpload,
    limits: &ImportLimits,
) -> PortResult<UserDirectory> {
    if upload.registered.descriptor.upload != UploadId::Users {
        return Err(ImportError::InvalidInput.into());
    }
    upload
        .registered
        .descriptor
        .validate(limits)
        .map_err(|_| ImportError::LimitExceeded)?;
    let mut stream = storage.read(upload).await?;
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if bytes.len() as u64 + chunk.len() as u64 > upload.registered.descriptor.byte_length {
            return Err(ImportError::UploadMismatch.into());
        }
        bytes.extend_from_slice(&chunk);
    }
    verify(
        &upload.registered.descriptor,
        bytes.len() as u64,
        Sha256::digest(&bytes).into(),
    )?;
    let users: Vec<ExportUser> =
        serde_json::from_slice(&bytes).map_err(|_| ImportError::InvalidInput)?;
    UserDirectory::new(users).map_err(|_| ImportError::InvalidInput.into())
}

pub(super) struct Record {
    pub normalized: NormalizedRecord,
    pub ts: SlackTimestamp,
    pub next: Checkpoint,
    pub order: u64,
    pub committed: bool,
}

pub(super) struct ArchiveReader<'a, S> {
    storage: &'a S,
    context: &'a ClaimedConversation,
    limits: ImportLimits,
    part: Option<PartReader>,
    index: usize,
    previous: Option<SlackTimestamp>,
    order: u64,
}

impl<'a, S: ImportStorage> ArchiveReader<'a, S> {
    pub fn new(
        storage: &'a S,
        context: &'a ClaimedConversation,
        limits: ImportLimits,
    ) -> PortResult<Self> {
        let mut total = context.users.registered.descriptor.byte_length;
        for (index, part) in context.parts.iter().enumerate() {
            let descriptor = &part.registered.descriptor;
            descriptor
                .validate(&limits)
                .map_err(|_| ImportError::LimitExceeded)?;
            if descriptor.upload
                != (UploadId::ConversationPart {
                    slack_channel_id: context.metadata.slack_channel_id.clone(),
                    part_index: u32::try_from(index).map_err(|_| ImportError::LimitExceeded)?,
                })
            {
                return Err(ImportError::InvalidInput.into());
            }
            total = total
                .checked_add(descriptor.byte_length)
                .filter(|n| *n <= limits.selected_bytes)
                .ok_or(ImportError::LimitExceeded)?;
        }
        let checkpoint = context.checkpoint;
        let valid_checkpoint = if checkpoint.part_index as usize == context.parts.len() {
            checkpoint.record_index == 0
        } else {
            context
                .parts
                .get(checkpoint.part_index as usize)
                .is_some_and(|part| {
                    part.registered
                        .descriptor
                        .record_count
                        .is_some_and(|count| checkpoint.record_index < count)
                })
        };
        if !valid_checkpoint || total > limits.selected_bytes {
            return Err(ImportError::InvalidInput.into());
        }
        Ok(Self {
            storage,
            context,
            limits,
            part: None,
            index: 0,
            previous: None,
            order: 0,
        })
    }

    pub async fn next(&mut self) -> PortResult<Option<Record>> {
        let Some(upload) = self.context.parts.get(self.index) else {
            return Ok(None);
        };
        if self.part.is_none() {
            self.part = Some(PartReader::new(
                self.storage.read(upload).await?,
                self.limits.record_bytes,
            ));
        }
        let part = self.part.as_mut().expect("opened part");
        let line = part
            .line(&upload.registered.descriptor)
            .await?
            .ok_or(ImportError::UploadMismatch)?;
        let position = Checkpoint {
            part_index: self.index as u32,
            record_index: part.records - 1,
        };
        let record: ExportRecord =
            serde_json::from_slice(&line).map_err(|_| ImportError::InvalidInput)?;
        let outer_ts = record.outer.ts;
        let normalized = record
            .normalize(self.context.metadata.slack_channel_id.clone())
            .map_err(|_| ImportError::InvalidInput)?;
        let ts = match &normalized {
            NormalizedRecord::Message(message) => message.identity.ts,
            NormalizedRecord::Skipped(_) => outer_ts.ok_or(ImportError::InvalidInput)?,
        };
        if self.previous.is_some_and(|previous| ts <= previous) {
            return Err(ImportError::InvalidInput.into());
        }
        self.previous = Some(ts);
        let mut next = Checkpoint {
            part_index: self.index as u32,
            record_index: part.records,
        };
        if Some(part.records) == upload.registered.descriptor.record_count {
            // Verify exact count, bytes, final LF and digest before checkpointing
            // the part boundary. Any extra line is an explicit mismatch.
            if part.line(&upload.registered.descriptor).await?.is_some() {
                return Err(ImportError::UploadMismatch.into());
            }
            self.index += 1;
            self.part = None;
            next = Checkpoint {
                part_index: self.index as u32,
                record_index: 0,
            };
        }
        let order = self.order;
        self.order += 1;
        let checkpoint = self.context.checkpoint;
        let committed = (position.part_index, position.record_index)
            < (checkpoint.part_index, checkpoint.record_index);
        Ok(Some(Record {
            normalized,
            ts,
            next,
            order,
            committed,
        }))
    }
}

struct PartReader {
    stream: ByteStream,
    chunk: Vec<u8>,
    offset: usize,
    bytes: u64,
    records: u32,
    hash: Sha256,
    record_limit: u64,
}

impl PartReader {
    fn new(stream: ByteStream, record_limit: u64) -> Self {
        Self {
            stream,
            chunk: Vec::new(),
            offset: 0,
            bytes: 0,
            records: 0,
            hash: Sha256::new(),
            record_limit,
        }
    }

    async fn line(&mut self, descriptor: &UploadDescriptor) -> PortResult<Option<Vec<u8>>> {
        let mut line = Vec::new();
        loop {
            if self.offset == self.chunk.len() {
                let Some(chunk) = self.stream.next().await else {
                    if !line.is_empty() || Some(self.records) != descriptor.record_count {
                        return Err(ImportError::UploadMismatch.into());
                    }
                    verify(descriptor, self.bytes, self.hash.clone().finalize().into())?;
                    return Ok(None);
                };
                self.chunk = chunk?;
                self.offset = 0;
                self.bytes = self
                    .bytes
                    .checked_add(self.chunk.len() as u64)
                    .filter(|n| *n <= descriptor.byte_length)
                    .ok_or(ImportError::UploadMismatch)?;
                self.hash.update(&self.chunk);
            }
            let rest = &self.chunk[self.offset..];
            let newline = rest.iter().position(|byte| *byte == b'\n');
            let take = newline.map_or(rest.len(), |index| index + 1);
            if line.len() as u64 + take as u64 > self.record_limit {
                return Err(ImportError::LimitExceeded.into());
            }
            line.extend_from_slice(&rest[..take]);
            self.offset += take;
            if newline.is_some() {
                self.records = self
                    .records
                    .checked_add(1)
                    .ok_or(ImportError::LimitExceeded)?;
                if self.records > descriptor.record_count.ok_or(ImportError::InvalidInput)? {
                    return Err(ImportError::UploadMismatch.into());
                }
                return Ok(Some(line));
            }
        }
    }
}

fn verify(descriptor: &UploadDescriptor, bytes: u64, hash: [u8; 32]) -> PortResult<()> {
    let digest: String = hash.iter().map(|byte| format!("{byte:02x}")).collect();
    if bytes != descriptor.byte_length || digest != descriptor.sha256.as_str() {
        return Err(ImportError::UploadMismatch.into());
    }
    Ok(())
}
