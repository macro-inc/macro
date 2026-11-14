//! The run loop: an input thread feeding a channel, then `select!` over
//! input, the update stream, the open transcript, and a frame timer. It draws
//! only when something changed, at most 30 times a second; the timer runs at
//! `fps` while something animates and once a second (the clock) otherwise.

use std::io;
use std::sync::Arc;
use std::time::Duration;

use chrono::{Local, Utc};
use crossterm::event::Event;
use futures::{Stream, StreamExt as _};
use ratatui::Terminal;
use ratatui::backend::Backend;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use agent_monitor::client::ClientEvent;
use agent_monitor::domain::model::{AgentId, TranscriptItem};
use agent_monitor::domain::source::TranscriptFeed;

use crate::app::App;
use crate::keys::Key;
use crate::ui::{self, Clock};
use crate::view::Link;

/// The shortest time between two draws (30 per second).
const MIN_FRAME: Duration = Duration::from_millis(33);

/// Transcript items asked for when an agent is opened.
const TRANSCRIPT_TAIL: usize = 200;

/// What a transcript follow reports.
enum Followed {
    Item(TranscriptItem),
    Failed(String),
}

/// The transcript being followed, and how to stop it.
struct Follow {
    agent: AgentId,
    stop: CancellationToken,
}

/// Reads terminal events on a thread, since crossterm's read blocks. The
/// thread ends when the receiver is dropped and the next event arrives.
pub fn spawn_input() -> mpsc::UnboundedReceiver<Event> {
    let (sender, receiver) = mpsc::unbounded_channel();
    std::thread::spawn(move || {
        while let Ok(event) = crossterm::event::read() {
            if sender.send(event).is_err() {
                return;
            }
        }
    });
    receiver
}

/// The local clock for a frame.
fn local_clock() -> Clock {
    Clock {
        now: Utc::now(),
        offset: *Local::now().offset(),
    }
}

/// Runs the viewer until the user quits or input closes.
pub async fn run_loop<B, U>(
    terminal: &mut Terminal<B>,
    app: &mut App,
    updates: U,
    transcripts: Arc<dyn TranscriptFeed>,
    mut input: mpsc::UnboundedReceiver<Event>,
    fps: u8,
) -> io::Result<()>
where
    B: Backend,
    U: Stream<Item = ClientEvent> + Unpin,
{
    let mut updates = updates.fuse();
    let tracker = TaskTracker::new();
    let (followed_sender, mut followed) = mpsc::channel::<(AgentId, Followed)>(256);
    let mut follow: Option<Follow> = None;

    let frame_interval = Duration::from_secs(1) / u32::from(fps.max(1));
    let mut last_draw: Option<Instant> = None;
    let mut last_tick = Instant::now();

    loop {
        sync_follow(app, &mut follow, &transcripts, &tracker, &followed_sender);

        let now = Instant::now();
        let since_draw = last_draw.map_or(MIN_FRAME, |at| now - at);
        if app.view.dirty && since_draw >= MIN_FRAME {
            terminal.draw(|frame| ui::draw(frame, app, local_clock()))?;
            app.view.dirty = false;
            last_draw = Some(now);
        }
        if app.quit {
            break;
        }

        let wait = if app.view.dirty {
            MIN_FRAME.saturating_sub(since_draw)
        } else if fps > 0 && app.animating() {
            frame_interval
        } else {
            // Wake on the next whole second, for the header clock.
            let millis = u64::from(Utc::now().timestamp_subsec_millis());
            Duration::from_millis(1000 - millis.min(999))
        };

        tokio::select! {
            event = input.recv() => match event {
                Some(Event::Key(event)) => {
                    if let Some(key) = Key::from_event(event) {
                        app.key(key);
                    }
                }
                Some(Event::Resize(_, _)) => app.view.dirty = true,
                Some(_) => {}
                None => break,
            },
            Some(event) = updates.next() => apply_client_event(app, event),
            Some((agent, message)) = followed.recv() => match message {
                Followed::Item(item) => app.view.transcript_item(&agent, item),
                Followed::Failed(error) => app.view.transcript_error(&agent, error),
            },
            () = tokio::time::sleep(wait) => {
                let elapsed = last_tick.elapsed();
                last_tick = Instant::now();
                if app.animating() {
                    app.view.body.tick(elapsed);
                }
                app.view.dirty = true;
            }
        }
    }

    if let Some(follow) = follow {
        follow.stop.cancel();
    }
    tracker.close();
    Ok(())
}

fn apply_client_event(app: &mut App, event: ClientEvent) {
    match event {
        ClientEvent::Connected(_) => app.view.set_link(Link::Live),
        ClientEvent::Update(update) => app.view.apply(*update),
        ClientEvent::Reconnecting { reason, .. } => app.view.set_link(Link::Reconnecting(reason)),
        ClientEvent::Incompatible { protocol } => app.view.set_link(Link::Incompatible(protocol)),
    }
}

/// Starts following the open agent's transcript, or stops following one no
/// longer open.
fn sync_follow(
    app: &mut App,
    follow: &mut Option<Follow>,
    transcripts: &Arc<dyn TranscriptFeed>,
    tracker: &TaskTracker,
    sender: &mpsc::Sender<(AgentId, Followed)>,
) {
    let target = app.transcript_target().cloned();
    if follow.as_ref().map(|follow| &follow.agent) == target.as_ref() {
        return;
    }

    if let Some(previous) = follow.take() {
        previous.stop.cancel();
    }
    let Some(agent_id) = target else {
        app.view.transcript = None;
        return;
    };
    // The row may not have arrived yet; try again on the next pass.
    let Some(agent) = app.view.agents.get(&agent_id).cloned() else {
        return;
    };

    app.view.open_transcript(agent_id.clone());
    let stop = CancellationToken::new();
    *follow = Some(Follow {
        agent: agent_id.clone(),
        stop: stop.clone(),
    });

    let transcripts = transcripts.clone();
    let sender = sender.clone();
    // One span per follow, so the collector's FollowTranscript handler (which
    // adopts the client's trace context) joins the viewer's trace.
    let span = tracing::info_span!(
        "macrod.monitor.viewer.follow_transcript",
        agent_id = %agent_id,
    );
    let task = async move {
        let opened = tokio::select! {
            () = stop.cancelled() => return,
            opened = transcripts.follow(&agent, TRANSCRIPT_TAIL) => opened,
        };
        let mut items = match opened {
            Ok(items) => items,
            Err(error) => {
                let _ = sender
                    .send((agent_id, Followed::Failed(error.to_string())))
                    .await;
                return;
            }
        };
        loop {
            let item = tokio::select! {
                () = stop.cancelled() => return,
                item = items.next() => item,
            };
            let Some(item) = item else { return };
            if sender
                .send((agent_id.clone(), Followed::Item(item)))
                .await
                .is_err()
            {
                return;
            }
        }
    };
    tracker.spawn(task.instrument(span));
}
