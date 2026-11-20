# Android performance benchmark

Measures how long the native Android app takes to start, switch views, open a
channel, open documents and go back, on an emulator or device with the app
signed in. The numbers are the app's own perf spans (the ones Datadog shows for
`@app.platform:android`), read live from the WebView over DevTools, so lab and
field numbers compare. It only taps through views and opens items: it never
types, sends, edits or changes settings. Opening an item still records it as
viewed, as any reader does (see [Targets](#targets)).

```sh
cd apps/web
just android-benchmark --serial emulator-5580
# the same as: bun scripts/android-benchmark/run.ts --serial emulator-5580
```

It writes `android-benchmark-results/android-benchmark-<time>-cpu<rates>.json`
and prints a summary table per [CPU profile](#cpu-profile). Add
`--cpu-throttle 4` for a phone-like WebView CPU.

## What a number means

Each timed step starts at the touch (the page's `pointerdown` timestamp for the
`adb input tap`) and ends when the flow the tap started reaches its paint
opportunity: the end of its root span, two animation frames after the view
reported ready. The root is:

| Step | Root span | Ends when |
| --- | --- | --- |
| `cold-start` | `app.boot` | The first view is ready; timed from just before `am start`, so it includes process and WebView start. `cold-start.boot-span` is the span alone, from navigation start, as the field reports it. |
| `view.<name>` | `navigation` | The dock view is ready (its `view.*` phase and the data phases under it). |
| `view.notifications` | `navigation` | As above, and its first feed rows are painted: the view reports ready with the feed's skeleton, and the rows can arrive seconds later. |
| `channel.open` | `list.open` (`entity.type=channel`) | The channel's messages are shown (`channel.messages.view`). |
| `document.small.open`, `document.large.open` | `list.open` (`entity.type=document`) and the `doc.editor` root it starts | The editor has initialized with the document's content; the later of the two. |
| `channel.back`, `document.back` | `navigation` | The list is back. |

`spanMs` in the results is the root's own `ui.elapsed_ms` (from the handler,
not the touch), which is what Datadog reports. Content a step also waits
for (Notifications' rows) is timed in the page: from the touch on, it checks
in animation frames after each DOM change for the first such row a touch
would reach, and records the frame after it, the same paint opportunity the
spans end at. `contentMs` is that time from the touch, and `readyMs` the later
of it and the spans. For views without such content, channels and back
navigations `readyMs − spanMs` is the time from the touch to the handler; for
documents `readyMs` runs on to the end of `doc.editor`, and for Notifications
to its rows' paint.

Before the first timed step of a launch the harness waits for the boot
`view.app` flow (the app shell's route view) to end, then `--boot-settle`.
While that flow is open, a view the first dock tap opens joins it as a phase
instead of the tap's own `navigation`, which then ends early and reports
about a third of the switch. The flow ends seconds after `app.boot`, later
at 4×; `boots` in the results lists when it ended for each launch, and the
summary prints the median.

Every iteration force-stops the app and launches it again, so each step runs
first **cold** (the first visit in a fresh process; app storage, the native
GraphQL cache and the WebView's HTTP cache are kept) and then **warm** (a
revisit in the same process). Clearing app storage would sign the app out, so
there is no cold-storage run.

Each sample also records, from the same traces: HTTP and GraphQL client spans,
native GraphQL cache IPC requests, Soup reads answered locally (`soup.local`)
or from the network (`soup.network`), which phases were already loaded
(`<phase>.waited=false`), and requests the WebView itself sent while the step
ran (analytics excluded; Tauri IPC on Android is not an HTTP request, so native
HTTP shows up only as `http …` spans). `spans` lists the flow's spans relative to the touch (frequent tiny
cache and reconcile spans are counted, not listed), for finding where the time went;
an HTTP or GraphQL client span ends at its response headers, and its `bodyMs` is the
time from there until its body was read (`http.body_ms`, `graphql.body_ms`).
`hostLoad` is the host's load average at the time. `target` says which
targets-file item a step opened (see [Targets](#targets)).

## Build the benchmark APK

`run.ts` needs a build that exports every perf span and keeps its WebView
debuggable. `build.sh` makes one: the production frontend and release native
code (R8, release Rust), against production services, with OTA updates off so
the bundle under test is the one built here. Three existing build variables
differ from a store build: `VITE_OTEL_ENV=benchmark` (perf sampling keeps
every user outside `prod`), `VITE_ENABLE_BROWSER_OTEL=true`, and
`VITE_OTEL_EXPORTER_URL=/__benchmark/otlp/v1/traces`, a same-origin path that
Tauri answers and the harness reads; no span reaches Datadog. Release
WebViews are already debuggable, because the app enables Tauri's `devtools`
feature.

```sh
bash scripts/android-benchmark/build.sh --target x86_64 \
  --signing ~/.macro-android-test-signing/keystore.properties
adb -s emulator-5580 install -r \
  tauri/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

Sign with a throwaway test key, never the Play upload key; it cannot update a
Play-installed app. `--signing` is required, and the script refuses to build
when `gen/android/keystore.properties` already points at another
configuration. `build.sh` takes the public PostHog key from the
production bundle unless `VITE_POSTHOG_API_KEY` is set, so feature flags match
the shipped app. Prerequisites are those of [Android development](../../../../docs/development/android.md);
on an x86_64 Linux host build `--target x86_64` for an x86_64 emulator.

## Emulator

Use your own AVD on a fixed port and always pass `--serial`. The baseline used:

```sh
avdmanager create avd -n <name> -k "system-images;android-36;google_apis_playstore;x86_64" -d pixel_6
# config.ini: hw.cpu.ncore=4, hw.ramSize=4096M, hw.gpu.enabled=yes, hw.gpu.mode=swangle_indirect
emulator -avd <name> -port 5580 -no-window -no-audio -no-boot-anim \
  -gpu swangle_indirect -no-snapshot -cores 4 -memory 4096
```

On a host without a GPU use `swangle_indirect`: with `swiftshader_indirect`
the emulator crashed (SIGSEGV in its renderer) when the app dismissed a
toast. Sign in once by hand, dismiss the notification prompt with **Not now**
(enabling it registers the emulator for push), and leave the app on Home.

## Targets

The channel and documents to open are named in
`~/.config/macro-android-benchmark/targets.json` (override with `--targets`),
outside the repository because they name account content:

```json
{
  "channels": [
    { "name": "<exact title in Chat>", "id": "<channel id>" },
    { "name": "<another channel>", "id": "<channel id>" }
  ],
  "smallDocument": { "name": "<title under Files › Shared with me>", "id": "<id>" },
  "largeDocument": { "name": "<title under Files › Shared with me>", "id": "<id>" }
}
```

A single `"channel": { "name": …, "id": … }` still works; with both,
`channel` is the first candidate and `channels` follow.

List rows carry no ids in the page, so the harness finds them by title and
then checks that the route contains the configured id, failing the step if
not: pick items whose titles are unique in their list. Lists are virtual, so
a row far down is not in the page: the harness scrolls the list from the top
until the row renders, reading further pages as the list does, for up to
20 s. Scrolling is untimed: when a step had to scroll to its target, the
harness waits at least a second, until the list has stopped loading
(`aria-busy`) and its height has held for half a second, and finds the row
again before the timed tap.

The harness never opens a row that shows unread items (an unread rail or dot,
or a mention count), because opening it would mark them read. A list can
also move between finding the row and the touch landing (a row above it gets
a message and moves up), so the page checks the touch itself: unless it lands
inside the row it found, and that row still shows no unread, the page drops
the touch and the events after it, and the step fails. Active channels
turn unread often, so list several channels: when preparing the channel
scenario each iteration uses the first candidate that is in the list and
shows no unread, and skips the others with a warning. When every candidate
shows unread, the iteration skips its channel steps and records a
`channel.prepare` failure. Each channel sample (open and back) records its
`target`: the candidate's position (`index` of `of`) and a short
hash of its id (`fingerprint`), never its name. The summary has a `target`
column and puts different targets in separate rows, warning when a run used
more than one. Put the quietest channels first, as a run that moves to
another candidate measures a different channel. Documents have one candidate
each; the guard sees only unread markers on list rows, which document rows do
not show, so pick documents without unread comments.

Each scenario that opens items checks, when it prepares, that the app reached
its list and that every item it opens is there, before its first step. A
scenario that cannot prepare before it has ever measured a step stops the run
with an error (a target file without the item, a renamed control, a target
not in its list); later in a
run it skips that iteration's steps and records a `<scenario>.prepare`
failure. Opening still records the items as viewed, which reorders Recent
lists and can move the channel's read position; the harness finds rows by
title, so the order does not matter.

## Options

| Option | Default | |
| --- | --- | --- |
| `--serial` | `$ANDROID_SERIAL` | Required. |
| `--iterations` | 10 | Fresh processes. Each runs every selected scenario cold, then warm. |
| `--scenarios` | all | `cold-start,views,channel,document`. |
| `--settle` | 1500 | Milliseconds between steps. |
| `--boot-settle` | 5000 | Milliseconds after the boot `view.app` flow ends before the first tap. |
| `--targets` | `~/.config/macro-android-benchmark/targets.json` | Items to open. |
| `--out` | `android-benchmark-results` | Results directory (git-ignored). |
| `--label` | | Stored in the results. |
| `--port` | 9333 | Host port for the DevTools forward. |
| `--cpu-throttle` | 1 | WebView CPU slowdown: 1, or 2 to 20; a list such as `1,4` alternates within each iteration. See [CPU profile](#cpu-profile). |

## CPU profile

The emulator gives the WebView a fast desktop-class core. Android phones run
the app's JavaScript, style and layout about four times slower, so unthrottled
lab view switches read like an iPhone's, not an Android phone's.
`--cpu-throttle <rate>` slows the WebView renderer by that factor with DevTools
(`Emulation.setCPUThrottlingRate`; 4 is Chrome's "mid-tier mobile" preset). At
4× the lab's median view switch (Notifications excluded) was 1.75–1.79 s in
two runs, against 1.65 s for Android in the field; at 1× it was 0.40–0.42 s,
close to iOS in the field (0.29 s).

| Profile | Use it for |
| --- | --- |
| `--cpu-throttle 1` (default) | Comparing with earlier runs; flows bound by IPC, the network or native code (cold channel open, cold start), which throttling does not make phone-like. |
| `--cpu-throttle 4` | Work on the WebView's main thread: view switches, document opens, rendering. Judge view-switch changes here. |
| `--cpu-throttle 1,4` | Both in one run, alternating within each iteration so both see the same host load. It launches the app twice per iteration and takes more than twice as long, as the 4× steps are slower. Its cold-start rows have twice the samples. |

The default stays one profile because most runs compare two builds at one
profile, and running both would double every run.

How the harness applies it:

- DevTools attaches only once the WebView is up, and the rate is set after the
  `app.boot` span has arrived, so `cold-start` and `cold-start.boot-span` are
  never throttled. Their rows sit under 1× in every run. The work the app does
  after boot (`--boot-settle`) runs throttled, as on a phone, so it takes
  longer and can overlap the first cold steps more.
- The rate lasts as long as the DevTools connection that set it: a relaunch or
  a new attach resets it to 1×. The harness sets it after every launch and
  checks it before and after every timed step by timing a fixed loop in the
  page against the same loop before throttling. A step fails when the measured
  slowdown is nearer 1× than the rate (below its square root), which a lapsed
  throttle would show; host load only makes the loop slower. This is why rates
  between 1 and 2 are refused: the check could not tell them from 1×. The `cpu`
  column is the median measured slowdown.
- Each timed sample records `cpuThrottle` and `cpuThrottleMeasured` (before,
  after; cold-start samples only `cpuThrottle`), each summary row its
  `cpuThrottle`, `meta.cpuThrottle` the rates of the run, and the file name
  ends in `-cpu4x` or `-cpu1x-4x`. Compare rows only at the same rate. A run
  that measured no step at one of its rates exits with an error.

Caveats:

- Throttling slows only the WebView renderer's main thread. The Android UI
  thread, Rust and other native code, the network and rendering on the GPU
  side run at emulator speed, so a flow that waits on them gets no slower.
- This software-rendered emulator already draws frames about twice as slowly
  as a phone (about 33 ms while animating, against 8–16 ms). Tauri IPC calls
  wait for the Android UI thread, about one frame each while anything
  animates, so IPC-bound flows such as the cold channel open are slower in the
  lab than on phones at either rate. Don't read them at 4× as phone numbers.
- At 4× the spread grows with the times, by about the same share of the
  median as at 1×; see [Noise and comparing builds](#noise-and-comparing-builds).

## Noise and comparing builds

The summary reports median, p90, min/max, a robust spread (`sd~`, 1.4826 ×
the median absolute deviation) and `detect`, the smallest difference between
two runs' medians that the spread lets you detect at 95% confidence and 80%
power. To compare two builds, run each with the same iterations on the same
AVD, alternating the builds (ABAB), and treat differences below the larger of
`detect` and the run-to-run drift in the baseline report as noise.
`compare.ts` lines two results files up step by step and warns, marking the
row, when a step opened different targets in the two runs (or in one), or
when a file predates target records:

```sh
bun scripts/android-benchmark/compare.ts android-benchmark-results/<a>.json android-benchmark-results/<b>.json
``` Other
emulators or heavy jobs on the host widen the spread; note the host load.

At 4× `detect` is 13–49% of a step's median for 10 iterations (median 28%,
against 25% at 1× in the same runs, host load 11–77), and two runs' medians
differed by a median 5%, at most 19%, for view switches and document opens. The
median over all view switches moved 2% between those runs. More iterations
narrow `detect` by the square root: 40 halve it.

A step fails rather than producing a number when its spans or the content it
waits for never arrive, the route afterwards is not the expected one, the
target is missing or shows unread, or the CPU throttle is not in force.
Failures are listed in the JSON. An iteration fails when the boot `view.app`
flow never ends. A cold start fails when the app exported its first
spans before DevTools attached (the exporter batches for five seconds, so this
is rare).

## Checking spans against the screen

`visual.ts` records the screen with `screenrecord` while running one step,
finds the frame where Android's touch dot appears and the frame after which
the screen stops changing, and compares that with the step's span time. It
needs `ffmpeg` (`FFMPEG=/path/to/ffmpeg`). It turns on Show touches for the
run and restores it. `--step` takes an open or view step (a back step depends
on the open before it); a screen that has not stayed still for a second
before recording stops counts as unsettled and gets no screen time.

```sh
bun scripts/android-benchmark/visual.ts --serial emulator-5580 --step document.large.open --iterations 5
```

`--cpu-throttle` takes one rate here, and the results file name ends in it.
`--keep` keeps the recordings for inspection. They show real account content: keep them
out of the repository and pull requests.

## Files

| File | |
| --- | --- |
| `run.ts` | The benchmark CLI. |
| `compare.ts`, `comparison.ts` | Step-by-step comparison of two results files (tested in `comparison.test.ts`). |
| `targets.ts` | The targets file and choosing among channel candidates (tested in `targets.test.ts`). |
| `scenarios.ts` | Scenarios, their tap targets and the spans that finish them. |
| `harness.ts` | Launching, preparing and timing one step. |
| `session.ts` | DevTools connection: span capture, tap times, element lookup, CPU throttle. |
| `measure.ts` | Turns a step's spans into a sample. |
| `device.ts` | `adb` calls, always with `-s <serial>`. |
| `otlp.ts`, `stats.ts` | OTLP JSON parsing and summary statistics (tested in `analysis.test.ts`). |
| `throttle.ts` | `--cpu-throttle` parsing and the check that the rate is in force (tested in `throttle.test.ts`). |
| `visual.ts` | Screen-recording check of one step. |
| `build.sh`, `posthog-key.ts` | Benchmark APK build. |
