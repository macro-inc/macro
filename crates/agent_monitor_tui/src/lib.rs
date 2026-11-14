//! The agent monitor's terminal viewer (`macrod monitor`): a dense,
//! Bloomberg-style board of every agent on the machine, drawn with ratatui
//! from the collector's `Subscribe` stream or from an in-process demo fleet.
//!
//! - [`view`]: the mirrored state, updated by [`view::ViewState::apply`].
//! - [`keys`]: the pure key machine, [`keys::step`].
//! - [`app`]: page stack, cursors and filters.
//! - [`ui`]: drawing, with [`ui::draw`] as the entry point.
//! - [`body`]: the BODY pane's trait and its vitals placeholder.
//! - [`run`]: the entry point macrod calls (Unix only).
#![deny(missing_docs)]

pub mod app;
pub mod body;
#[cfg(unix)]
pub mod feed;
mod format;
pub mod keys;
#[cfg(unix)]
pub mod runner;
pub mod theme;
pub mod ui;
pub mod view;

pub use theme::ThemeName;
#[cfg(unix)]
pub use unix::{FeedChoice, Options, ViewerError, run, run_feed};

#[cfg(unix)]
mod unix {
    use std::io;
    use std::path::PathBuf;

    use crate::app::App;
    use crate::feed::{self, Feed};
    use crate::runner;
    use crate::theme::ThemeName;
    use crate::view::ViewState;

    /// Where the viewer reads from.
    #[derive(Clone, Debug)]
    pub enum FeedChoice {
        /// The collector on this socket.
        Socket(PathBuf),
        /// The scripted demo fleet, in process, with this seed.
        Demo {
            /// The script's seed.
            seed: u64,
        },
    }

    /// How the viewer runs.
    #[derive(Clone, Debug)]
    pub struct Options {
        /// Where updates come from.
        pub feed: FeedChoice,
        /// Frames per second while something animates; 0 stops animation.
        pub fps: u8,
        /// The BODY figure to start on, by name or number (from 1); the
        /// default figure when `None` or unknown.
        pub figure: Option<String>,
        /// The colour theme it starts in.
        pub theme: ThemeName,
    }

    /// Why the viewer stopped with an error.
    #[derive(Debug, thiserror::Error)]
    pub enum ViewerError {
        /// The terminal could not be drawn to.
        #[error("terminal error: {0}")]
        Terminal(#[from] io::Error),
    }

    /// The BODY pane: the mesh man.
    #[cfg(feature = "mesh-man")]
    fn body(figure: Option<&str>) -> Box<dyn crate::body::BodyPane> {
        let mut body = crate::body::mesh::MeshBody::for_terminal();
        if let Some(figure) = figure {
            body.select_figure(figure);
        }
        Box::new(body)
    }

    /// The BODY pane: the vitals panel, built without the mesh man.
    #[cfg(not(feature = "mesh-man"))]
    fn body(_figure: Option<&str>) -> Box<dyn crate::body::BodyPane> {
        Box::new(crate::body::Vitals::default())
    }

    /// Takes over the terminal and runs the viewer until the user quits.
    /// Must be called inside a tokio runtime.
    pub async fn run(options: Options) -> Result<(), ViewerError> {
        let (feed, label) = match options.feed {
            FeedChoice::Socket(socket) => (feed::socket(socket), None),
            FeedChoice::Demo { seed } => (feed::demo(seed), Some(String::from("DEMO"))),
        };
        run_with(
            feed,
            label,
            options.fps,
            options.theme,
            options.figure.as_deref(),
        )
        .await
    }

    /// [`run`] on a feed the caller built, such as [`feed::in_process`]
    /// over a store it hosts; `label` is shown in the header.
    pub async fn run_feed(
        feed: Feed,
        label: Option<String>,
        fps: u8,
        theme: ThemeName,
    ) -> Result<(), ViewerError> {
        run_with(feed, label, fps, theme, None).await
    }

    async fn run_with(
        feed: Feed,
        label: Option<String>,
        fps: u8,
        theme: ThemeName,
        figure: Option<&str>,
    ) -> Result<(), ViewerError> {
        let mut app = App::new(ViewState::new(body(figure)), label);
        app.set_theme(theme);
        let input = runner::spawn_input();
        let mut terminal = ratatui::init();
        let result = runner::run_loop(
            &mut terminal,
            &mut app,
            feed.updates,
            feed.transcripts,
            input,
            fps,
        )
        .await;
        ratatui::restore();
        result.map_err(ViewerError::from)
    }
}
