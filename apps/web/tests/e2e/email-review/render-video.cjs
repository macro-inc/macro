const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const output =
  process.env.EMAIL_REVIEW_OUTPUT || '/tmp/email-exhaustive-review';
async function render() {
  const results = JSON.parse(
    fs.readFileSync(path.join(output, 'results.json'))
  );
  const expected = [];
  for (const chapter of [
    'reading',
    'compose',
    'attachments',
    'resilience',
    'mobile',
    'advanced',
    'integration',
  ]) {
    await require('./chapters/' + chapter + '.cjs')(async (name) =>
      expected.push(name)
    );
  }
  assert.deepEqual(
    results.map((r) => r.name),
    expected,
    'Render only the complete ordered scene inventory'
  );
  assert.ok(
    results.every((r) => r.passed),
    'Resolve every failed scene before publishing a passing recording'
  );
  for (const key of ['runId', 'revision', 'sourceDiffHash'])
    assert.equal(
      new Set(results.map((r) => r[key])).size,
      1,
      `Mixed ${key} evidence`
    );
  const run = (args) =>
    execFileSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { stdio: 'inherit' }
    );
  const escape = (text) =>
    String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const assertions = results.reduce((n, r) => n + r.steps.length, 0);
  const title = path.join(output, 'video-introduction.txt');
  fs.writeFileSync(
    title,
    [
      'MACRO EMAIL — LOCAL CHROME VERIFICATION',
      '',
      `${results.length} scenes | ${assertions} browser assertions`,
      'Synthetic users, 4 inboxes, 17 threads, 120-message history',
      'Real local APIs, drafts, attachments, schedules and Undo',
      '',
      'Seeded Gmail accounts have no provider OAuth grant.',
      'The harness holds account health healthy and translates local storage URLs.',
      'Failure-injection chapters identify their substituted responses.',
      'AI tool output is seeded; edits use the real API.',
      'Phone chapters emulate touch and viewport size in Chrome.',
      'Provider delivery, LLM generation and native keyboards are not exercised.',
      '',
      `Source ${results[0].revision.slice(0, 9)} | ${results[0].runId}`,
    ].join('\n')
  );
  const intro = path.join(output, 'video', '00-introduction.webm');
  run([
    '-f',
    'lavfi',
    '-i',
    'color=c=0x141816:s=1440x1000:r=25:d=10',
    '-vf',
    `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile=${title}:fontcolor=white:fontsize=26:line_spacing=15:x=55:y=100`,
    '-c:v',
    'libvpx',
    '-b:v',
    '1M',
    '-threads',
    '4',
    intro,
  ]);
  const clips = [
    { name: 'Introduction and evidence limits', file: intro },
    ...results.map((r) => ({
      name: r.name + ' — ' + r.description,
      file: path.join(output, 'video', r.name + '.webm'),
    })),
  ];
  const chapters = [];
  let elapsed = 0;
  for (const clip of clips) {
    const duration = Number(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          clip.file,
        ],
        { encoding: 'utf8' }
      )
    );
    assert.ok(Number.isFinite(duration) && duration > 0, clip.file);
    chapters.push({ ...clip, start: elapsed, duration });
    elapsed += duration;
  }
  const list = path.join(output, 'concat.txt');
  fs.writeFileSync(
    list,
    clips
      .map((c) => "file '" + c.file.replaceAll("'", "'\\''") + "'")
      .join('\n')
  );
  const meta = path.join(output, 'chapters.ffmetadata');
  fs.writeFileSync(
    meta,
    ';FFMETADATA1\n' +
      chapters
        .map(
          (c) =>
            `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.start * 1000)}\nEND=${Math.round((c.start + c.duration) * 1000)}\ntitle=${c.name.replace(/[=;#\\\n]/g, ' ')}\n`
        )
        .join('')
  );
  const video = path.join(output, 'email-verification.mp4');
  run([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-i',
    meta,
    '-map_metadata',
    '1',
    '-map',
    '0:v:0',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '4',
    '-movflags',
    '+faststart',
    video,
  ]);
  fs.writeFileSync(
    path.join(output, 'chapters.json'),
    JSON.stringify(chapters, null, 2)
  );
  const time = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  fs.copyFileSync(
    path.resolve(__dirname, '../../../../../docs/EMAIL_LOCAL_VERIFICATION.md'),
    path.join(output, 'EMAIL_LOCAL_VERIFICATION.md')
  );
  fs.writeFileSync(
    path.join(output, 'index.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Email verification</title><style>body{background:#141816;color:#eee;font:16px system-ui;max-width:1400px;margin:30px auto;padding:0 20px}video{width:100%;max-height:75vh}button{background:#22372d;color:white;border:0;padding:9px;text-align:left;margin:3px;cursor:pointer}details{border-top:1px solid #405047;padding:12px 0}a{color:#a8dcc0}small{color:#aaa}</style><h1>Local email verification</h1><p>${results.length} scenes · ${assertions} assertions · ${time(elapsed)} · source ${escape(results[0].revision.slice(0, 9))}</p><p>Real local services with synthetic seed data. Account-health substitutions, storage routing, fault injection, and device/provider limits are disclosed in the video introduction and <a href="EMAIL_LOCAL_VERIFICATION.md">report</a>.</p><video id="video" controls preload="metadata" src="email-verification.mp4"></video><h2>Chapters</h2>${chapters.map((c) => `<button onclick="document.getElementById('video').currentTime=${c.start};document.getElementById('video').play()">${time(c.start)} ${escape(c.name)}</button>`).join('')}<h2>Assertions</h2>${results.map((r) => `<details><summary>✓ ${escape(r.name)} — ${escape(r.description)}</summary><small>${escape(r.evidence)}</small><ul>${r.steps.map((s) => `<li>✓ ${escape(s.label)}</li>`).join('')}</ul><a href="artifacts/${encodeURIComponent(r.name)}.png">Final screenshot</a></details>`).join('')}<p><a href="results.json">Raw run evidence</a> · <a href="email-verification.mp4">Download MP4</a></p></html>`
  );
  console.log(
    JSON.stringify(
      {
        video,
        scenes: results.length,
        assertions,
        duration: elapsed,
        html: path.join(output, 'index.html'),
      },
      null,
      2
    )
  );
}
render().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
