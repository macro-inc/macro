//! The stream's NDJSON lines.

#[cfg(test)]
mod test;

use crate::lane::{LaneId, LaneKind, Paging};
use bytes::Bytes;
use serde::Serialize;
use serde_json::{Map, Value};

/// One NDJSON line of the stream.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Frame {
    /// A lane the stream runs, sent before anything else of the lane: how the
    /// cache reads and writes its pages.
    Lane {
        /// The lane; also the key of its saved state in the cache.
        lane: LaneId,
        /// The operation every page of the lane runs, whose document the
        /// client sent with the request.
        operation_name: String,
        /// Where the pages keep their items.
        paging: Paging,
        /// What the cache does with the pages.
        kind: LaneKind,
        /// When the lane's pass started; the cache stores it as the lane's
        /// watermark once the lane completes.
        pass_started_at: String,
    },
    /// One executed page.
    Page {
        /// The lane the page belongs to.
        lane: LaneId,
        /// The page's index within the lane in this stream, from 0.
        page: u32,
        /// Exactly what the server executed for this page.
        variables: Map<String, Value>,
        /// The GraphQL response (`data`, optional `errors`), as
        /// `POST /soup/graphql` would return it.
        response: Value,
        /// How many items the page holds.
        items: u32,
        /// What the client sends back to continue the lane after this page;
        /// `None` (`null`) when the lane does not resume across streams or no
        /// page follows in this lane: it completed, reached `maxItems`, or
        /// failed.
        resume: Option<Value>,
    },
    /// A lane finished.
    LaneDone {
        /// The lane.
        lane: LaneId,
        /// Pages the lane sent in this stream.
        pages: u32,
        /// Items the lane sent in this stream.
        items: u32,
        /// Why the lane stopped.
        reason: LaneDoneReason,
    },
    /// A lane failed and sends no `LaneDone`; the stream carries on with the
    /// next lane.
    LaneError {
        /// The lane.
        lane: LaneId,
        /// What went wrong, in server-chosen text.
        message: String,
    },
    /// The stream is waiting for its turn to run the next page. Sent at
    /// intervals while it waits, so the connection is not taken for idle.
    Waiting,
    /// The stream finished. A stream that closes without it was interrupted.
    End {
        /// Why the stream stopped.
        reason: EndReason,
    },
}

/// Why a lane finished.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, strum::IntoStaticStr)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum LaneDoneReason {
    /// The last page had no next cursor.
    Complete,
    /// The lane sent at least its `maxItems`.
    MaxItems,
}

/// Why the stream finished.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, strum::IntoStaticStr)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum EndReason {
    /// Every lane ran: each one sent `LaneDone` or `LaneError`.
    Complete,
    /// The stream sent its `maxPages`.
    MaxPages,
    /// The stream ran for its longest allowed time; lanes resume from their
    /// last page's `resume`.
    Deadline,
    /// The stream itself failed (a frame could not be encoded).
    Error,
}

impl Frame {
    /// Encodes the frame as one NDJSON line, trailing newline included.
    /// Compact JSON escapes newlines inside strings, so the line has no other.
    pub fn to_line(&self) -> Result<Bytes, serde_json::Error> {
        let mut line = serde_json::to_vec(self)?;
        line.push(b'\n');
        Ok(Bytes::from(line))
    }
}
