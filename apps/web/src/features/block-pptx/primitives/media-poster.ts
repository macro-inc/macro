/**
 * Posters for new clips: a video's frame about a second in (or a drawn
 * film frame when the browser cannot decode it), and a speaker icon for
 * audio, as PNG base64 with their pixel size.
 */

export interface Poster {
  /** PNG, base64. */
  data: string;
  width: number;
  height: number;
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Poster> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!blob) throw new Error('Could not draw the poster.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), width: canvas.width, height: canvas.height };
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  return { canvas, ctx };
}

/** Waits for `event` on `target`, failing on `error` or after `ms`. */
function once(target: HTMLMediaElement, event: string, ms = 8000) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('timed out')), ms);
    const ok = () => done();
    const fail = () => done(new Error('could not load'));
    function done(error?: Error) {
      clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener('error', fail);
      if (error) reject(error);
      else resolve();
    }
    target.addEventListener(event, ok);
    target.addEventListener('error', fail);
  });
}

/** A dark 16:9 frame with a play mark, for clips the browser cannot show. */
function filmFrame(): Promise<Poster> {
  const { canvas, ctx } = canvasOf(640, 360);
  ctx.fillStyle = '#1f1f1f';
  ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(320, 180, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f1f1f';
  ctx.beginPath();
  ctx.moveTo(305, 155);
  ctx.lineTo(305, 205);
  ctx.lineTo(345, 180);
  ctx.closePath();
  ctx.fill();
  return canvasPng(canvas);
}

/** The frame about a second into `file` (a tenth in, for short clips). */
export async function videoPoster(file: Blob): Promise<Poster> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await once(video, 'loadeddata');
    const at = Math.min(1, (video.duration || 0) / 10);
    if (at > 0) {
      video.currentTime = at;
      await once(video, 'seeked');
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return await filmFrame();
    const scale = Math.min(1, 1920 / width);
    const { canvas, ctx } = canvasOf(
      Math.round(width * scale),
      Math.round(height * scale)
    );
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await canvasPng(canvas);
  } catch {
    return filmFrame();
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** PowerPoint's speaker icon for audio. */
export function audioPoster(): Promise<Poster> {
  const { canvas, ctx } = canvasOf(128, 128);
  ctx.fillStyle = '#5b5b5b';
  ctx.beginPath();
  ctx.moveTo(22, 50);
  ctx.lineTo(46, 50);
  ctx.lineTo(74, 24);
  ctx.lineTo(74, 104);
  ctx.lineTo(46, 78);
  ctx.lineTo(22, 78);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5b5b5b';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  for (const r of [18, 32]) {
    ctx.beginPath();
    ctx.arc(80, 64, r, -Math.PI / 4, Math.PI / 4);
    ctx.stroke();
  }
  return canvasPng(canvas);
}
