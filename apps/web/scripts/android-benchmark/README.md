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

It writes `android-benchmark-results/android-benchmark-<time>.json` and prints
a summary table.

## What a number means

Each timed step starts at the touch (the page's `pointerdown` timestamp for the
`adb input tap`) and ends when the flow the tap started reaches its paint
opportunity: the end of its root span, two animation frames after the view
reported ready. The root is:

| Step | Root span | Ends when |
| --- | --- | --- |
| `cold-start` | `app.boot` | The first view is ready; timed from just before `am start`, so it includes process and WebView start. `cold-start.boot-span` is the span alone, from navigation start, as the field reports it. |
| `view.<name>` | `navigation` | The dock view is ready (its `view.*` phase and the data phases under it). |
| `channel.open` | `list.open` (`entity.type=channel`) | The channel's messages are shown (`channel.messages.view`). |
| `document.small.open`, `document.large.open` | `list.open` (`entity.type=document`) and the `doc.editor` root it starts | The editor has initialized with the document's content; the later of the two. |
| `channel.back`, `document.back` | `navigation` | The list is back. |

`spanMs` in the results is the root's own `ui.elapsed_ms` (from the handler,
not the touch), which is what Datadog reports. For views, channels and back
navigations `readyMs − spanMs` is the time from the touch to the handler; for
documents `readyMs` runs on to the end of `doc.editor`.

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
`hostLoad` is the host's load average at the time.

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
  "channel": { "name": "<exact title in Chat>", "id": "<channel id>" },
  "smallDocument": { "name": "<title under Files › Shared with me>", "id": "<id>" },
  "largeDocument": { "name": "<title under Files › Shared with me>", "id": "<id>" }
}
```

List rows carry no ids in the page, so the harness finds them by title and
then checks that the route contains the configured id, failing the step if
not: pick items whose titles are unique in their list.

Pick a channel with no unread messages (the harness refuses a row that shows
unread items, because opening it would mark them read) and documents without
unread comments (the guard sees only unread markers on list rows, which
document rows do not show). Opening still records the items as viewed, which
reorders Recent lists and can move the channel's read position; the harness
finds rows by title, so the order does not matter.

## Options

| Option | Default | |
| --- | --- | --- |
| `--serial` | `$ANDROID_SERIAL` | Required. |
| `--iterations` | 10 | Fresh processes. Each runs every selected scenario cold, then warm. |
| `--scenarios` | all | `cold-start,views,channel,document`. |
| `--settle` | 1500 | Milliseconds between steps. |
| `--boot-settle` | 5000 | Milliseconds after the first view before the first tap. |
| `--targets` | `~/.config/macro-android-benchmark/targets.json` | Items to open. |
| `--out` | `android-benchmark-results` | Results directory (git-ignored). |
| `--label` | | Stored in the results. |
| `--port` | 9333 | Host port for the DevTools forward. |

## Noise and comparing builds

The summary reports median, p90, min/max, a robust spread (`sd~`, 1.4826 ×
the median absolute deviation) and `detect`, the smallest difference between
two runs' medians that the spread lets you detect at 95% confidence and 80%
power. To compare two builds, run each with the same iterations on the same
AVD, alternating the builds (ABAB), and treat differences below the larger of
`detect` and the run-to-run drift in the baseline report as noise. Other
emulators or heavy jobs on the host widen the spread; note the host load.

A step fails rather than producing a number when its spans never arrive, the
route afterwards is not the expected one, or the target is missing. Failures
are listed in the JSON. A cold start fails when the app exported its first
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

`--keep` keeps the recordings for inspection. They show real account content: keep them
out of the repository and pull requests.

## Files

| File | |
| --- | --- |
| `run.ts` | The benchmark CLI. |
| `scenarios.ts` | Scenarios, their tap targets and the spans that finish them. |
| `harness.ts` | Launching, preparing and timing one step. |
| `session.ts` | DevTools connection: span capture, tap times, element lookup. |
| `measure.ts` | Turns a step's spans into a sample. |
| `device.ts` | `adb` calls, always with `-s <serial>`. |
| `otlp.ts`, `stats.ts` | OTLP JSON parsing and summary statistics (tested in `analysis.test.ts`). |
| `visual.ts` | Screen-recording check of one step. |
| `build.sh`, `posthog-key.ts` | Benchmark APK build. |
