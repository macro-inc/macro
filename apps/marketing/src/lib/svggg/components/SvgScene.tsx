import {
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
} from 'solid-js';
import { isTouchDevice } from '../signals.tsx/svgSignals';
import type { Mat4, OrbitAxis, Vec3, ViewBox } from '../types/svgTypes';
import { ParentMatrixContext, ViewBoxContext } from '../utils/svgContext';
import { multiply, transformToMatrixYXZ } from '../utils/svgMatrix';
import { getViewBoxCenter } from '../utils/svgUtils';

interface OrbitConstraints {
  zoom?: { min?: number; max?: number };
  x?: { min?: number; max?: number };
  y?: { min?: number; max?: number };
  z?: { min?: number; max?: number };
}

interface SvgSceneProps {
  orbitConstraints?: OrbitConstraints;
  orbitAxes?: [OrbitAxis, OrbitAxis];
  style?: JSX.CSSProperties | string;
  translation?: Partial<Vec3>;
  rotation?: Partial<Vec3>;
  orbitControls?: boolean;
  scale?: Partial<Vec3>;
  scrollLock?: boolean;
  snapBack?: boolean;
  viewBox: string;
}

export function SvgScene(props: ParentProps<SvgSceneProps>) {
  const [minX, minY, width, height] = props.viewBox.split(' ').map(Number);
  const viewBox: ViewBox = { minX, minY, width, height };

  const [orbitPitch, setOrbitPitch] = createSignal(0);
  const [orbitYaw, setOrbitYaw] = createSignal(0);
  const [orbitRoll, setOrbitRoll] = createSignal(0);

  const [targetPitch, setTargetPitch] = createSignal(0);
  const [targetYaw, setTargetYaw] = createSignal(0);
  const [targetRoll, setTargetRoll] = createSignal(0);

  const [zoomScale, setZoomScale] = createSignal(1);
  const [isDragging, setIsDragging] = createSignal(false);

  let containerRef!: HTMLDivElement;
  let lastX = 0;
  let lastY = 0;
  let isRightMouse = false;

  const sensitivity = 0.5;
  const zoomSensitivity = 0.001;
  const lerpFactor = 0.08;

  function clamp(value: number, min?: number, max?: number): number {
    if (min !== undefined && value < min) return min;
    if (max !== undefined && value > max) return max;
    return value;
  }

  function clampPitch(value: number): number {
    const constraints = props.orbitConstraints?.x;
    const defaultMin = -90;
    const defaultMax = 90;
    return clamp(
      value,
      constraints?.min ?? defaultMin,
      constraints?.max ?? defaultMax
    );
  }

  function clampYaw(value: number): number {
    const constraints = props.orbitConstraints?.y;
    return clamp(value, constraints?.min, constraints?.max);
  }

  function clampRoll(value: number): number {
    const constraints = props.orbitConstraints?.z;
    return clamp(value, constraints?.min, constraints?.max);
  }

  const verticalAxis = () => props.orbitAxes?.[0] ?? 'x';
  const horizontalAxis = () => props.orbitAxes?.[1] ?? 'y';

  let animationFrameId: number | null = null;

  function lerp(current: number, target: number, factor: number) {
    return current + (target - current) * factor;
  }

  function animate() {
    const currentPitch = orbitPitch();
    const currentYaw = orbitYaw();
    const currentRoll = orbitRoll();
    const tPitch = targetPitch();
    const tYaw = targetYaw();
    const tRoll = targetRoll();

    const threshold = 0.01;
    const needsAnimation =
      Math.abs(tPitch - currentPitch) > threshold ||
      Math.abs(tYaw - currentYaw) > threshold ||
      Math.abs(tRoll - currentRoll) > threshold;

    if (needsAnimation) {
      setOrbitPitch(lerp(currentPitch, tPitch, lerpFactor));
      setOrbitYaw(lerp(currentYaw, tYaw, lerpFactor));
      setOrbitRoll(lerp(currentRoll, tRoll, lerpFactor));
      animationFrameId = requestAnimationFrame(animate);
    } else {
      setOrbitPitch(tPitch);
      setOrbitYaw(tYaw);
      setOrbitRoll(tRoll);
      animationFrameId = null;
    }
  }

  function startAnimation() {
    if (animationFrameId === null) {
      animationFrameId = requestAnimationFrame(animate);
    }
  }

  const combinedMatrix = createMemo((): Mat4 => {
    const center = getViewBoxCenter(viewBox);

    const orbitMatrix = transformToMatrixYXZ({
      rx: orbitPitch(),
      ry: orbitYaw(),
      rz: orbitRoll(),
      tx: 0,
      ty: 0,
      tz: 0,
      sx: 1,
      sy: 1,
      sz: 1,
      cx: center.x,
      cy: center.y,
      cz: center.z,
    });

    const cameraMatrix = transformToMatrixYXZ({
      rx: props.rotation?.x ?? 0,
      ry: props.rotation?.y ?? 0,
      rz: props.rotation?.z ?? 0,
      tx: props.translation?.x ?? 0,
      ty: props.translation?.y ?? 0,
      tz: props.translation?.z ?? 0,
      sx: (props.scale?.x ?? 1) * zoomScale(),
      sy: (props.scale?.y ?? 1) * zoomScale(),
      sz: (props.scale?.z ?? 1) * zoomScale(),
      cx: center.x,
      cy: center.y,
      cz: center.z,
    });

    return multiply(cameraMatrix, orbitMatrix);
  });

  function applyOrbitDelta(deltaX: number, deltaY: number, rollOnly = false) {
    if (rollOnly) {
      setTargetRoll((r) => clampRoll(r + deltaX * sensitivity));
    } else {
      const vAxis = verticalAxis();
      const hAxis = horizontalAxis();

      switch (hAxis) {
        case 'y':
          setTargetYaw((y) => clampYaw(y + deltaX * sensitivity));
          break;
        case 'x':
          setTargetPitch((p) => clampPitch(p + deltaX * sensitivity));
          break;
        default:
          setTargetRoll((r) => clampRoll(r - deltaX * sensitivity));
      }

      switch (vAxis) {
        case 'x':
          setTargetPitch((p) => clampPitch(p - deltaY * sensitivity));
          break;
        case 'y':
          setTargetYaw((y) => clampYaw(y - deltaY * sensitivity));
          break;
        default:
          setTargetRoll((r) => clampRoll(r - deltaY * sensitivity));
      }
    }

    startAnimation();
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging() || !props.orbitControls) {
      return;
    }

    const deltaX = e.clientX - lastX;
    const deltaY = e.clientY - lastY;

    applyOrbitDelta(deltaX, deltaY, isRightMouse);

    lastX = e.clientX;
    lastY = e.clientY;
  }

  function snapBack() {
    if (props.snapBack === false) return;
    setTargetPitch(0);
    setTargetYaw(0);
    setTargetRoll(0);
    startAnimation();
  }

  function handleMouseUp() {
    setIsDragging(false);
    isRightMouse = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    snapBack();
  }

  function handleMouseDown(e: MouseEvent) {
    if (!props.orbitControls) {
      return;
    }
    e.preventDefault();

    setIsDragging(true);
    lastX = e.clientX;
    lastY = e.clientY;
    isRightMouse = e.button === 2;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleContextMenu(e: MouseEvent) {
    if (props.orbitControls) {
      e.preventDefault();
    }
  }

  function handleWheel(e: WheelEvent) {
    if (!props.orbitControls) {
      return;
    }
    if (!props.scrollLock) {
      return;
    }
    e.preventDefault();

    const minZoom = props.orbitConstraints?.zoom?.min ?? 0.1;
    const maxZoom = props.orbitConstraints?.zoom?.max ?? 10;
    const delta = -e.deltaY * zoomSensitivity;
    setZoomScale((scale) =>
      Math.max(minZoom, Math.min(maxZoom, scale + delta * scale))
    );
  }

  let lastTouchX = 0;
  let lastTouchY = 0;

  function handleTouchStart(e: TouchEvent) {
    if (!props.orbitControls) {
      return;
    }
    if (isTouchDevice()) {
      return;
    }
    if (e.touches.length === 1) {
      setIsDragging(true);
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }
  }

  function handleTouchMove(e: TouchEvent) {
    if (!props.orbitControls) {
      return;
    }
    if (isTouchDevice()) {
      return;
    }
    e.preventDefault();

    if (e.touches.length === 1 && isDragging()) {
      const deltaX = e.touches[0].clientX - lastTouchX;
      const deltaY = e.touches[0].clientY - lastTouchY;

      applyOrbitDelta(deltaX, deltaY);

      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }
  }

  function handleTouchEnd() {
    setIsDragging(false);
    snapBack();
  }

  onMount(() => {
    containerRef.addEventListener('touchstart', handleTouchStart, {
      passive: true,
    });
    containerRef.addEventListener('touchmove', handleTouchMove, {
      passive: false,
    });
    containerRef.addEventListener('wheel', handleWheel, { passive: false });
    containerRef.addEventListener('contextmenu', handleContextMenu);
    containerRef.addEventListener('mousedown', handleMouseDown);
    containerRef.addEventListener('touchend', handleTouchEnd);

    onCleanup(() => {
      containerRef.removeEventListener('contextmenu', handleContextMenu);
      containerRef.removeEventListener('touchstart', handleTouchStart);
      containerRef.removeEventListener('mousedown', handleMouseDown);
      containerRef.removeEventListener('touchmove', handleTouchMove);
      containerRef.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('mousemove', handleMouseMove);
      containerRef.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mouseup', handleMouseUp);
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    });
  });

  function getWorldMatrix() {
    return combinedMatrix();
  }

  return (
    <ViewBoxContext.Provider value={viewBox}>
      <ParentMatrixContext.Provider value={getWorldMatrix}>
        <div
          ref={containerRef}
          style={{
            cursor:
              props.orbitControls && !isTouchDevice()
                ? isDragging()
                  ? 'grabbing'
                  : 'grab'
                : 'default',
            'touch-action':
              props.orbitControls && !isTouchDevice() ? 'none' : 'auto',
            'user-select':
              props.orbitControls && !isTouchDevice() ? 'none' : 'auto',
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox={props.viewBox}
            style={props.style}
          >
            <g>{props.children}</g>
          </svg>
        </div>
      </ParentMatrixContext.Provider>
    </ViewBoxContext.Provider>
  );
}
