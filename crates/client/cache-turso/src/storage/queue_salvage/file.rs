//! The side file: frames appended one after another, each checked, so a torn
//! one hides nothing written before it.

use super::{QUEUE_ROW_COLUMNS, RecordKey, SalvagedQueue, Shadow};
use turso_core::{Numeric, Value};
use uuid::Uuid;

/// Length, checksum and kind.
const FRAME_HEADER: usize = 4 + 8 + 1;
const FORMAT_VERSION: u8 = 1;

const QUEUE: u8 = 1;
const READ_ATTEMPT: u8 = 2;
const IMPORT_ATTEMPT: u8 = 3;

/// What a side file says: the last queue written to it, how often reading a
/// database's queue was started, and how often importing that queue was.
///
/// An attempt is written down before it starts and the file goes once a queue
/// is imported, so an attempt found here ended without one.
#[derive(Debug, Default)]
pub struct SalvageFile {
    queue: Option<SalvagedQueue>,
    end: u64,
    reads: u32,
    imports: u32,
}

impl SalvageFile {
    /// Reads every whole frame; what follows the last of them is ignored.
    pub fn decode(bytes: &[u8]) -> Self {
        let mut file = Self::default();
        let mut input = bytes;
        while let Some((kind, body, rest)) = split_frame(input) {
            let end = (bytes.len() - rest.len()) as u64;
            match kind {
                QUEUE => {
                    let Some(queue) = Reader(body).queue() else {
                        break;
                    };
                    file = Self {
                        queue: Some(queue),
                        reads: file.reads,
                        ..Self::default()
                    };
                }
                READ_ATTEMPT => file.reads += 1,
                IMPORT_ATTEMPT => file.imports += 1,
                _ => break,
            }
            file.end = end;
            input = rest;
        }
        file
    }

    /// Returns whether the file says nothing at all.
    pub fn is_blank(&self) -> bool {
        self.end == 0
    }

    /// Returns where the next frame goes.
    pub fn end(&self) -> u64 {
        self.end
    }

    /// Returns how many reads of a database's queue were started.
    pub fn reads(&self) -> u32 {
        self.reads
    }

    /// Returns how many imports of the queue were started.
    pub fn imports(&self) -> u32 {
        self.imports
    }

    /// Returns the queue no database is known to hold yet.
    pub fn queue(&self) -> Option<&SalvagedQueue> {
        self.queue.as_ref()
    }

    /// Consumes the file's queue.
    pub fn into_queue(self) -> Option<SalvagedQueue> {
        self.queue
    }

    /// The frame that says reading a database's queue has started.
    pub fn read_attempt() -> Vec<u8> {
        frame(READ_ATTEMPT, &[])
    }

    /// The frame that says importing the queue has started.
    pub fn import_attempt() -> Vec<u8> {
        frame(IMPORT_ATTEMPT, &[])
    }
}

impl SalvagedQueue {
    /// The frame that holds this queue.
    pub fn to_frame(&self) -> Vec<u8> {
        let mut body = vec![FORMAT_VERSION];
        body.extend(self.id.as_bytes());
        body.extend(self.rounds.to_le_bytes());
        body.push(u8::from(self.complete));
        body.extend(self.sequence.to_le_bytes());
        match &self.source {
            Some(source) => {
                body.push(1);
                write_bytes(&mut body, source);
            }
            None => body.push(0),
        }
        write_rows(&mut body, &self.rows);
        write_len(&mut body, self.shadows.len());
        for shadow in &self.shadows {
            body.extend(shadow.owner.to_le_bytes());
            write_row(&mut body, &shadow.document);
            for facts in &shadow.facts {
                write_rows(&mut body, facts);
            }
        }
        write_len(&mut body, self.records.len());
        for (key, value) in &self.records {
            write_bytes(&mut body, key.typename.as_bytes());
            write_bytes(&mut body, key.id.as_bytes());
            write_bytes(&mut body, value);
        }
        frame(QUEUE, &body)
    }
}

fn frame(kind: u8, body: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(FRAME_HEADER + body.len());
    write_len(&mut frame, body.len());
    frame.extend(checksum(kind, body).to_le_bytes());
    frame.push(kind);
    frame.extend(body);
    frame
}

/// The first whole frame's kind and body, and what follows it.
fn split_frame(input: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let mut reader = Reader(input);
    let len = reader.len()?;
    let expected = u64::from_le_bytes(reader.array()?);
    let [kind] = reader.array()?;
    let body = reader.take(len)?;
    (checksum(kind, body) == expected).then_some((kind, body, reader.0))
}

/// FNV-1a.
fn checksum(kind: u8, body: &[u8]) -> u64 {
    std::iter::once(&kind)
        .chain(body)
        .fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
        })
}

/// A queue's frame is far below 4 GiB: it lives in this worker's memory.
fn write_len(out: &mut Vec<u8>, len: usize) {
    out.extend((len as u32).to_le_bytes());
}

fn write_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    write_len(out, bytes.len());
    out.extend(bytes);
}

fn write_rows(out: &mut Vec<u8>, rows: &[Vec<Value>]) {
    write_len(out, rows.len());
    for row in rows {
        write_row(out, row);
    }
}

fn write_row(out: &mut Vec<u8>, row: &[Value]) {
    write_len(out, row.len());
    for value in row {
        match value {
            Value::Null => out.push(0),
            Value::Numeric(Numeric::Integer(value)) => {
                out.push(1);
                out.extend(value.to_le_bytes());
            }
            Value::Numeric(Numeric::Float(value)) => {
                out.push(2);
                out.extend(f64::from(*value).to_le_bytes());
            }
            Value::Text(value) => {
                out.push(3);
                write_bytes(out, value.as_str().as_bytes());
            }
            Value::Blob(value) => {
                out.push(4);
                write_bytes(out, value);
            }
        }
    }
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Option<&'a [u8]> {
        let (taken, rest) = self.0.split_at_checked(len)?;
        self.0 = rest;
        Some(taken)
    }

    fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        self.take(N)?.try_into().ok()
    }

    fn len(&mut self) -> Option<usize> {
        usize::try_from(u32::from_le_bytes(self.array()?)).ok()
    }

    fn i64(&mut self) -> Option<i64> {
        Some(i64::from_le_bytes(self.array()?))
    }

    fn bytes(&mut self) -> Option<&'a [u8]> {
        let len = self.len()?;
        self.take(len)
    }

    fn text(&mut self) -> Option<String> {
        String::from_utf8(self.bytes()?.to_vec()).ok()
    }

    fn many<T>(&mut self, mut read: impl FnMut(&mut Self) -> Option<T>) -> Option<Vec<T>> {
        // Not preallocated: the length is untrusted.
        (0..self.len()?).map(|_| read(self)).collect()
    }

    fn value(&mut self) -> Option<Value> {
        match self.array()? {
            [0] => Some(Value::Null),
            [1] => Some(Value::from_i64(self.i64()?)),
            [2] => Some(Value::from_f64(f64::from_le_bytes(self.array()?))),
            [3] => Some(Value::from_text(self.text()?)),
            [4] => Some(Value::from_blob(self.bytes()?.to_vec())),
            _ => None,
        }
    }

    fn row(&mut self) -> Option<Vec<Value>> {
        self.many(Self::value)
    }

    fn queue(mut self) -> Option<SalvagedQueue> {
        if self.array()? != [FORMAT_VERSION] {
            return None;
        }
        let id = Uuid::from_bytes(self.array()?);
        let rounds = u32::from_le_bytes(self.array()?);
        let complete = match self.array()? {
            [0] => false,
            [1] => true,
            _ => return None,
        };
        let sequence = self.i64()?;
        let source = match self.array()? {
            [0] => None,
            [1] => Some(self.bytes()?.to_vec()),
            _ => return None,
        };
        let rows = self.many(|reader| reader.row().filter(|row| row.len() == QUEUE_ROW_COLUMNS))?;
        let shadows = self.many(|reader| {
            Some(Shadow {
                owner: reader.i64()?,
                document: reader.row()?,
                facts: [
                    reader.many(Self::row)?,
                    reader.many(Self::row)?,
                    reader.many(Self::row)?,
                    reader.many(Self::row)?,
                ],
            })
        })?;
        let records = self.many(|reader| {
            Some((
                RecordKey {
                    typename: reader.text()?,
                    id: reader.text()?,
                },
                reader.bytes()?.to_vec(),
            ))
        })?;
        self.0.is_empty().then_some(SalvagedQueue {
            id,
            source,
            rounds,
            complete,
            sequence,
            rows,
            shadows,
            records,
        })
    }
}
