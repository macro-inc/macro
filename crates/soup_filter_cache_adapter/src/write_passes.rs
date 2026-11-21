//! The projection passes of one network write, reading storage once.

use crate::mail::ProjectionError;
use crate::{SoupFilterCacheAdapterError, WriteResponse, mail, notifications, properties};
use cache_core::engine::{Engine, PassReadSet, PassReads};
use cache_core::predicate::{PredicateIndexStorage, ProjectionMutation};
use cache_core::store::{DurableRead, WritePosition};

/// Why the projection passes of a write failed.
#[derive(Debug, thiserror::Error)]
pub enum WritePassError<E: std::error::Error + 'static> {
    /// The notification pass.
    #[error(transparent)]
    Notification(SoupFilterCacheAdapterError),
    /// The Mail or property pass.
    #[error(transparent)]
    Projection(ProjectionError<E>),
}

/// Runs the notification pass (when `reuse_stored_identity`), then the Mail
/// and property passes over `response`, after `projections`. The passes read
/// through the engine's hot tier, and the engine keeps what they read from
/// storage for the write that follows, so that write does not read it again.
pub async fn write_passes<S>(
    engine: &mut Engine<S>,
    response: &WriteResponse<'_>,
    reuse_stored_identity: bool,
    projections: Vec<ProjectionMutation>,
) -> Result<Vec<ProjectionMutation>, WritePassError<S::Error>>
where
    S: PredicateIndexStorage,
    for<'a> PassReads<'a, S>: DurableRead<Error = S::Error>,
{
    let mut passes = WritePasses::new(reuse_stored_identity, projections);
    loop {
        if let WritePassStep::Done(projections) = passes.step(engine, response).await? {
            return Ok(projections);
        }
    }
}

#[derive(Clone, Copy)]
enum Pass {
    Notifications,
    Mail,
    Properties,
}

/// What [`WritePasses::step`] did.
pub enum WritePassStep {
    /// One pass ran; the host may run reads before the next step.
    Pending,
    /// The last pass ran, and the engine keeps what the passes read.
    Done(Vec<ProjectionMutation>),
}

/// [`write_passes`] one pass at a time, so a host can run reads between
/// passes. What the earlier passes read and computed holds only while storage
/// commits nothing, so a step that finds [`cache_core::store::Storage::write_position`] moved
/// since the previous step starts the passes over.
pub struct WritePasses {
    reuse_stored_identity: bool,
    given: Vec<ProjectionMutation>,
    projections: Vec<ProjectionMutation>,
    next: Option<Pass>,
    reads: PassReadSet,
    /// Where storage stood after the previous step, once a pass has run.
    position: Option<WritePosition>,
    restarts: u32,
}

impl WritePasses {
    /// The passes of one write, after `projections`.
    pub fn new(reuse_stored_identity: bool, projections: Vec<ProjectionMutation>) -> Self {
        Self {
            reuse_stored_identity,
            given: projections.clone(),
            projections,
            next: Some(Self::first(reuse_stored_identity)),
            reads: PassReadSet::default(),
            position: None,
            restarts: 0,
        }
    }

    /// How many times a moved position started the passes over.
    pub fn restarts(&self) -> u32 {
        self.restarts
    }

    fn first(reuse_stored_identity: bool) -> Pass {
        if reuse_stored_identity {
            Pass::Notifications
        } else {
            Pass::Mail
        }
    }

    /// Runs the next pass over `response`, the same response every step.
    /// Storage without a position runs every pass in this one step, since no
    /// later step could tell whether what the earlier ones read still holds.
    pub async fn step<S>(
        &mut self,
        engine: &mut Engine<S>,
        response: &WriteResponse<'_>,
    ) -> Result<WritePassStep, WritePassError<S::Error>>
    where
        S: PredicateIndexStorage,
        for<'a> PassReads<'a, S>: DurableRead<Error = S::Error>,
    {
        let position = engine.storage().write_position();
        if self.position.is_some() && self.position != position {
            self.restart();
        }
        let reads = engine.resume_pass_reads(std::mem::take(&mut self.reads));
        let result = self.run(&reads, response, position.is_some()).await;
        self.reads = reads.finish();
        result?;
        if self.next.is_some() {
            self.position = position;
            return Ok(WritePassStep::Pending);
        }
        engine.keep_pass_reads(std::mem::take(&mut self.reads));
        Ok(WritePassStep::Done(std::mem::take(&mut self.projections)))
    }

    fn restart(&mut self) {
        self.restarts += 1;
        self.projections = self.given.clone();
        self.next = Some(Self::first(self.reuse_stored_identity));
        self.reads = PassReadSet::default();
        self.position = None;
    }

    /// Runs one pass, or every remaining pass when `one` is false.
    async fn run<R: DurableRead>(
        &mut self,
        reads: &R,
        response: &WriteResponse<'_>,
        one: bool,
    ) -> Result<(), WritePassError<R::Error>> {
        let reuse = self.reuse_stored_identity;
        while let Some(pass) = self.next {
            match pass {
                Pass::Notifications => {
                    self.projections.extend(
                        notifications::notification_projection_updates_for(reads, response)
                            .await
                            .map_err(WritePassError::Notification)?,
                    );
                    self.next = Some(Pass::Mail);
                }
                Pass::Mail => {
                    self.projections.extend(
                        mail::projection_updates_for_response(reads, response, reuse)
                            .await
                            .map_err(WritePassError::Projection)?,
                    );
                    self.next = Some(Pass::Properties);
                }
                Pass::Properties => {
                    self.projections = properties::augment_authoritative_response(
                        reads,
                        response,
                        reuse,
                        std::mem::take(&mut self.projections),
                    )
                    .await
                    .map_err(WritePassError::Projection)?;
                    self.next = None;
                }
            }
            if one {
                break;
            }
        }
        Ok(())
    }
}
