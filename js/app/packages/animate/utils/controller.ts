import type { AnimationController, Timeline } from '../types/types';

export function controller(input: Timeline | Timeline[]): AnimationController {
  const timelines = Array.isArray(input) ? input : [input];
  let _onProgress: ((p: number) => void) | null = null;
  let _onLoop: ((count: number) => void) | null = null;
  let _onComplete: (() => void) | null = null;
  let _onResume: (() => void) | null = null;
  let _onPause: (() => void) | null = null;
  let lastTimestamp: number | null = null;
  let rafId: number | null = null;
  let _isPlaying = false;
  let _loopCount = 0;
  let _duration = 1;
  let _progress = 0;
  let _loop = false;
  let _speed = 1;

  function onLoop(callback: (count: number) => void): AnimationController {
    _onLoop = callback;
    return ctrl;
  }

  function onProgress(callback: (p: number) => void): AnimationController {
    _onProgress = callback;
    return ctrl;
  }

  function onComplete(callback: () => void): AnimationController {
    _onComplete = callback;
    return ctrl;
  }

  function tick(timestamp: number) {
    if (!_isPlaying) {
      lastTimestamp = null;
      return;
    }

    if (lastTimestamp === null) {
      lastTimestamp = timestamp;
      rafId = requestAnimationFrame(tick);
      return;
    }

    const deltaMs = timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    const deltaProgress = (deltaMs / 1000 / _duration) * _speed;
    let newProgress = _progress + deltaProgress;

    if (_loop) {
      if (newProgress > 1) {
        newProgress = newProgress % 1;
        _loopCount++;
        _onLoop?.(_loopCount);
      }
      if (newProgress < 0) {
        newProgress = 1 + (newProgress % 1);
        _loopCount++;
        _onLoop?.(_loopCount);
      }
    }
    else {
      if (newProgress >= 1) {
        renderAll(1);
        _isPlaying = false;
        lastTimestamp = null;
        _onComplete?.();
        return;
      }
      if (newProgress <= 0) {
        renderAll(0);
        _isPlaying = false;
        lastTimestamp = null;
        _onComplete?.();
        return;
      }
    }

    renderAll(newProgress);
    rafId = requestAnimationFrame(tick);
  }

  function onResume(callback: () => void): AnimationController {
    _onResume = callback;
    return ctrl;
  }

  function onPause(callback: () => void): AnimationController {
    _onPause = callback;
    return ctrl;
  }

  function renderAll(p: number) {
    _progress = p;
    for (const timeline of timelines) { timeline.render(p); }
    _onProgress?.(p);
  }

  function duration(seconds: number): AnimationController {
    _duration = seconds;
    return ctrl;
  }

  function setSpeed(s: number): AnimationController {
    _speed = s;
    return ctrl;
  }

  function seek(p: number): AnimationController {
    renderAll(p < 0 ? 0 : p > 1 ? 1 : p);
    return ctrl;
  }

  function pause(): AnimationController {
    _isPlaying = false;
    lastTimestamp = null;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    _onPause?.();
    return ctrl;
  }

  function play(): AnimationController {
    if (_isPlaying) return ctrl;
    _isPlaying = true;
    rafId = requestAnimationFrame(tick);
    _onResume?.();
    return ctrl;
  }

  function loop(): AnimationController {
    _loop = true;
    return ctrl;
  }

  function destroy(): void {
    pause();
    _onProgress = null;
    _onComplete = null;
    _onResume = null;
    _onPause = null;
    _onLoop = null;
  }

  renderAll(0);

  const ctrl: AnimationController = {
    get isPlaying() { return _isPlaying; },
    get progress() { return _progress; },
    get speed() { return _speed; },
    onProgress,
    onComplete,
    setSpeed,
    duration,
    onResume,
    destroy,
    onPause,
    onLoop,
    pause,
    loop,
    play,
    seek,
  };

  return ctrl;
}
