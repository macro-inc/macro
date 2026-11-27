/**
 * The 3D portrait renderer. This module and its imports are the lazy chunk: nothing here loads until
 * `mount` is called. It owns one WebGL context and frees everything in `dispose`.
 *
 * It adds no DOM listeners and runs no idle loop. It draws when `update` or `resize` change
 * something, and for the length of the short transitions those start.
 */
import { animate } from 'motion';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import type { Look, PresetId } from '../presets';
import { CX, type Head } from './head';
import {
  averageSkinColor,
  loadPortraitAssets,
  type PortraitAssets,
} from './portrait-assets';
import { type MorphKey, type RenderState, resolve } from './resolve';
import { CANON, LIGHTS, MOTION, type V3, YAW_PER_STEP } from './scene-settings';
import {
  postFragment,
  postVertex,
  propFragment,
  propVertex,
  skinFragment,
  skinVertex,
} from './shaders';

export type PortraitHandle = {
  /** Draw this draft. `pose` is the five-step view pose, -2..2; fractions are allowed while dragging. */
  update(preset: PresetId, look: Look, pose: number): void;
  /** CSS pixel size of the canvas box. The renderer sets the backing size. */
  resize(width: number, height: number): void;
  /** A self-contained PNG data URL of the draft at the canonical front angle, or undefined if the context is lost. */
  captureCanonical(): string | undefined;
  dispose(): void;
};

type AnimationChannel =
  | 'detail'
  | 'shape'
  | 'yaw'
  | 'distance'
  | 'height'
  | 'light';

const MORPH_KEYS: MorphKey[] = [
  'faceWidth',
  'jawDef',
  'cheekHigh',
  'cheekFull',
  'noseWide',
  'noseLen',
  'tipUp',
  'hump',
  'tipRound',
  'tipSharp',
  'eyeTilt',
  'browWide',
  'browArch',
  'browFlat',
  'browRidge',
  'browOuterUp',
  'browFurrow',
  'smile',
  'smirk',
  'lipsFull',
  'neckWide',
  'forehead',
  'ageSag',
];

export async function mount(
  canvas: HTMLCanvasElement,
  assets: PortraitAssets,
  signal?: AbortSignal,
  onRenderError?: () => void
): Promise<PortraitHandle> {
  signal?.throwIfAborted();
  // Throws when WebGL2 is not available; the caller then keeps its 2D fallback.
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'low-power',
  });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.autoClear = true;
  renderer.debug.onShaderError = () => {
    throw new Error('The portrait shader could not compile');
  };
  const disposables: { dispose(): void }[] = [];
  let disposed = false;
  const track = <T extends { dispose(): void }>(item: T) => {
    if (disposed) item.dispose();
    else disposables.push(item);
    return item;
  };
  const running = new Map<AnimationChannel, { stop(): void }>();
  let frame = 0;

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    cancelAnimationFrame(frame);
    for (const control of running.values()) control.stop();
    running.clear();
    for (const item of disposables) item.dispose();
    for (const item of dynamic) item.dispose();
    disposables.length = 0;
    dynamic.clear();
    renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
  }
  const dynamic = new Set<{ dispose(): void }>();

  signal?.addEventListener('abort', dispose, { once: true });

  try {
    const [head, tColor, tNormal, tSpec] = await loadPortraitAssets(
      assets,
      signal,
      track
    );
    signal?.throwIfAborted();
    return configure(head, tColor, tNormal, tSpec);
  } catch (error) {
    dispose();
    throw error;
  }

  function configure(
    head: Head,
    tColor: Texture,
    tNormal: Texture,
    tSpec: Texture
  ): PortraitHandle {
    const average = averageSkinColor(tColor);

    // Shared light uniforms: one object, referenced by every material.
    const lights = {
      uKeyDir: { value: new Vector3() },
      uKeyCol: { value: new Vector3() },
      uFillDir: { value: new Vector3() },
      uFillCol: { value: new Vector3() },
      uRimDir: { value: new Vector3() },
      uRimCol: { value: new Vector3() },
      uSky: { value: new Vector3() },
      uGround: { value: new Vector3() },
    };
    const glow = new Vector3();

    const skinMaterial = track(
      new ShaderMaterial({
        vertexShader: skinVertex,
        fragmentShader: skinFragment,
        uniforms: {
          ...lights,
          tColor: { value: tColor },
          tNormal: { value: tNormal },
          tSpec: { value: tSpec },
          uTone: { value: new Vector3() },
          uAvg: { value: new Vector3(average.r, average.g, average.b) },
          uHair: { value: new Vector3() },
          uIris: { value: new Vector3() },
          uFlush: { value: 0 },
          uFreckles: { value: 0 },
          uAge: { value: 0 },
          uStubble: { value: 0 },
          uClean: { value: 0 },
          uScalp: { value: 0 },
          uBrow: { value: 1 },
          uBrowCut: { value: 0 },
          uMark: { value: 0 },
          uEyeBright: { value: 1 },
          uOpen: { value: 1 },
          uSlope: { value: 0 },
          uCx: { value: CX },
        },
      })
    );
    const propMaterial = (
      color: V3 | Vector3,
      kind: number,
      options: {
        gloss?: number;
        spec?: number;
        weight?: number;
        screen?: number;
        glow?: number;
        depth?: number;
        double?: boolean;
      } = {}
    ) =>
      new ShaderMaterial({
        vertexShader: propVertex,
        fragmentShader: propFragment,
        side: options.double ? DoubleSide : undefined,
        uniforms: {
          ...lights,
          uColor: {
            value: color instanceof Vector3 ? color : new Vector3(...color),
          },
          uKind: { value: kind },
          uGloss: { value: options.gloss ?? 12 },
          uSpec: { value: options.spec ?? 0.1 },
          uWeight: { value: options.weight ?? 0.5 },
          uScreen: { value: options.screen ?? 1 },
          uGlow: { value: options.glow ?? 0 },
          uDepthScale: { value: options.depth ?? 4 },
        },
      });

    // Scene graph: pivot turns the head about its own axis; flip mirrors it for mirrored presets.
    const scene = new Scene();
    const pivot = new Group();
    pivot.position.set(CX, 0, 0.1);
    const flip = new Group();
    const content = new Group();
    content.position.set(-CX, 0, -0.1);
    scene.add(pivot);
    pivot.add(flip);
    flip.add(content);

    const skinGeometry = track(new BufferGeometry());
    const positionAttribute = new BufferAttribute(head.position, 3);
    const normalAttribute = new BufferAttribute(head.normal, 3);
    const beardAttribute = new BufferAttribute(new Float32Array(head.count), 1);
    skinGeometry.setAttribute('position', positionAttribute);
    skinGeometry.setAttribute('normal', normalAttribute);
    skinGeometry.setAttribute('aBase', new BufferAttribute(head.base, 3));
    skinGeometry.setAttribute('uv', new BufferAttribute(head.scan.uv, 2));
    skinGeometry.setAttribute('aAO', new BufferAttribute(head.scan.ao, 1));
    skinGeometry.setAttribute('aScalp', new BufferAttribute(head.scalp, 1));
    skinGeometry.setAttribute('aBeard', beardAttribute);
    skinGeometry.setIndex(new BufferAttribute(head.scan.index, 1));
    const skin = new Mesh(skinGeometry, skinMaterial);
    skin.frustumCulled = false;
    content.add(skin);

    // Shells that follow the morphed head.
    type Shell = ReturnType<typeof head.hairShell>;
    type Part = { mesh: Mesh<BufferGeometry, ShaderMaterial>; shell: Shell };
    const parts = new Map<string, Part>();
    function setShell(
      slot: string,
      shell: Shell | undefined,
      material: () => ShaderMaterial
    ) {
      const old = parts.get(slot);
      if (old) {
        content.remove(old.mesh);
        old.mesh.geometry.dispose();
        old.mesh.material.dispose();
        dynamic.delete(old.mesh.geometry);
        dynamic.delete(old.mesh.material);
        parts.delete(slot);
      }
      if (!shell || !shell.index.length) return;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(shell.position, 3));
      geometry.setAttribute('normal', new BufferAttribute(shell.normal, 3));
      geometry.setAttribute('aBase', new BufferAttribute(shell.base, 3));
      geometry.setAttribute('aDepth', new BufferAttribute(shell.depth, 1));
      geometry.setIndex(new BufferAttribute(shell.index, 1));
      const mesh = new Mesh(geometry, material());
      mesh.frustumCulled = false;
      dynamic.add(geometry);
      dynamic.add(mesh.material);
      content.add(mesh);
      parts.set(slot, { mesh, shell });
    }

    // Eyewear and earpieces: small parametric meshes, built per choice.
    const gear = new Group();
    gear.position.set(CX, 0, 0);
    content.add(gear);
    const gearItems = new Set<{ dispose(): void }>();
    function gearMesh(
      geometry: BufferGeometry,
      material: ShaderMaterial,
      position: V3,
      setup?: (mesh: Mesh) => void
    ) {
      // Props have no scan coordinates; give the shader its attributes anyway.
      const count = geometry.attributes.position.count;
      geometry.setAttribute(
        'aBase',
        new BufferAttribute(new Float32Array(count * 3), 3)
      );
      geometry.setAttribute(
        'aDepth',
        new BufferAttribute(new Float32Array(count), 1)
      );
      const mesh = new Mesh(geometry, material);
      mesh.position.set(...position);
      setup?.(mesh);
      gearItems.add(geometry);
      gearItems.add(material);
      gear.add(mesh);
    }
    function bar(
      material: ShaderMaterial,
      from: V3,
      to: V3,
      thickness: number
    ) {
      const a = new Vector3(...from),
        b = new Vector3(...to);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      gearMesh(
        new BoxGeometry(thickness, thickness, a.distanceTo(b)),
        material,
        [mid.x, mid.y, mid.z],
        (mesh) => mesh.lookAt(gear.localToWorld(b.clone()))
      );
    }
    function buildGear(
      eyewear: RenderState['eyewear'],
      earpiece: RenderState['earpiece']
    ) {
      for (const item of gearItems) item.dispose();
      gearItems.clear();
      gear.clear();
      const eyeY = 1.66,
        lensZ = 2.3,
        eyeX = 0.645;
      if (eyewear !== 'none') {
        const frame =
          eyewear === 'rimless' || eyewear === 'wire'
            ? propMaterial([0.45, 0.4, 0.3], 0, {
                gloss: 40,
                spec: 0.9,
                weight: 0.1,
              })
            : propMaterial([0.012, 0.012, 0.016], 0, {
                gloss: 30,
                spec: 0.5,
                weight: 0.1,
              });
        const thin = eyewear === 'rimless' || eyewear === 'wire' ? 0.03 : 0.06;
        for (const side of [-1, 1]) {
          const x = side * eyeX;
          if (eyewear === 'wire')
            gearMesh(
              new TorusGeometry(0.36, 0.022, 6, 24),
              frame,
              [x, eyeY, lensZ],
              (mesh) => mesh.scale.set(1, 0.86, 1)
            );
          if (eyewear === 'rect' || eyewear === 'shades') {
            const w = 0.8,
              h = 0.5,
              t = eyewear === 'shades' ? 0.05 : 0.065;
            gearMesh(new BoxGeometry(w, t, t), frame, [x, eyeY + h / 2, lensZ]);
            gearMesh(new BoxGeometry(w, t, t), frame, [x, eyeY - h / 2, lensZ]);
            gearMesh(new BoxGeometry(t, h + t, t), frame, [
              x - w / 2,
              eyeY,
              lensZ,
            ]);
            gearMesh(new BoxGeometry(t, h + t, t), frame, [
              x + w / 2,
              eyeY,
              lensZ,
            ]);
          }
          const lens =
            eyewear === 'shades'
              ? propMaterial([0.01, 0.011, 0.014], 0, {
                  gloss: 60,
                  spec: 1.6,
                  weight: 0.05,
                  double: true,
                })
              : propMaterial([0.5, 0.6, 0.68], 0, {
                  gloss: 60,
                  spec: 1.2,
                  weight: 0.05,
                  screen: eyewear === 'rimless' ? 0.3 : 0.2,
                  double: true,
                });
          gearMesh(
            eyewear === 'rect' || eyewear === 'shades'
              ? new PlaneGeometry(0.78, 0.48)
              : new CircleGeometry(0.35, 20),
            lens,
            [x, eyeY, lensZ - 0.01],
            (mesh) => {
              if (eyewear === 'wire' || eyewear === 'rimless')
                mesh.scale.set(1, 0.86, 1);
            }
          );
          bar(
            frame,
            [side * (eyeX + 0.4), eyeY + 0.08, lensZ],
            [side * 1.8, eyeY + 0.12, 0.15],
            thin
          );
        }
        gearMesh(new BoxGeometry(0.5, thin, thin), frame, [
          0,
          eyeY + 0.1,
          lensZ,
        ]);
      }
      if (earpiece === 'stud' || earpiece === 'ring') {
        const gold = propMaterial([0.75, 0.5, 0.16], 0, {
          gloss: 30,
          spec: 1.4,
          weight: 0.05,
          glow: 0.4,
        });
        for (const side of [-1, 1]) {
          if (earpiece === 'stud')
            gearMesh(new SphereGeometry(0.085, 10, 8), gold, [
              side * 1.73,
              0.74,
              0.88,
            ]);
          else
            gearMesh(
              new TorusGeometry(0.15, 0.03, 6, 16),
              gold,
              [side * 1.75, 0.56, 0.88],
              (mesh) => {
                mesh.rotation.y = side * 0.9;
              }
            );
        }
      }
      if (earpiece === 'comms') {
        const shell = propMaterial([0.03, 0.033, 0.04], 0, {
          gloss: 24,
          spec: 0.6,
          weight: 0.1,
        });
        const lamp = propMaterial([0.89, 0.65, 0.23], 0, {
          glow: 1.4,
          weight: 0,
        });
        gearMesh(new BoxGeometry(0.16, 0.62, 0.36), shell, [-1.9, 1.35, 0.05]);
        bar(shell, [-1.9, 1.1, 0.2], [-0.95, 0.42, 1.95], 0.05);
        gearMesh(new SphereGeometry(0.075, 10, 8), lamp, [-0.9, 0.42, 1.98]);
      }
    }

    // Pixel pass.
    const sceneTarget = track(
      new WebGLRenderTarget(4, 4, {
        magFilter: NearestFilter,
        minFilter: NearestFilter,
        depthBuffer: true,
      })
    );
    const captureScene = track(
      new WebGLRenderTarget(CANON.grid[0], CANON.grid[1], {
        magFilter: NearestFilter,
        minFilter: NearestFilter,
        depthBuffer: true,
      })
    );
    const captureOut = track(
      new WebGLRenderTarget(
        CANON.grid[0] * CANON.cell,
        CANON.grid[1] * CANON.cell,
        { depthBuffer: false }
      )
    );
    const postMaterial = track(
      new ShaderMaterial({
        vertexShader: postVertex,
        fragmentShader: postFragment,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tScene: { value: sceneTarget.texture },
          uGrid: { value: new Vector2(4, 4) },
          uCell: { value: 1 },
          uCoarse: { value: 1 },
          uGlowCol: { value: glow },
          uOrigin: { value: new Vector2() },
        },
      })
    );
    const postGeometry = track(new BufferGeometry());
    postGeometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
    );
    const postScene = new Scene();
    const postMesh = new Mesh(postGeometry, postMaterial);
    postMesh.frustumCulled = false;
    postScene.add(postMesh);
    const postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const camera = new PerspectiveCamera(22, 0.8, 1, 100);

    // Live values (what is on screen now) and where they are heading.
    const live = {
      yaw: 0,
      distance: 18,
      height: 1.4,
      coarse: 1,
      open: 1,
      light: { ...LIGHTS.studio },
    };
    const weights = Object.fromEntries(
      MORPH_KEYS.map((key) => [key, 0])
    ) as Record<MorphKey, number>;
    let target: RenderState | undefined;
    let currentPreset: PresetId | undefined;
    let targetYaw = 0;
    let size = {
      width: 0,
      height: 0,
      cell: 1,
      grid: [4, 4] as [number, number],
    };
    let dirtyShape = true;

    const reduced = () =>
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    function tween(
      channel: AnimationChannel,
      from: number,
      to: number,
      duration: number,
      onUpdate: (value: number) => void,
      steps?: number
    ) {
      running.get(channel)?.stop();
      running.delete(channel);
      if (from === to) return;
      if (reduced() || duration === 0) {
        onUpdate(to);
        requestRender();
        return;
      }
      const control = animate(from, to, {
        duration,
        ease: steps
          ? (t: number) =>
              Math.min(1, Math.floor(t * steps + 1e-6) / (steps - 1 || 1))
          : MOTION.out,
        onUpdate: (value) => {
          onUpdate(value);
          requestRender();
        },
        onComplete: () => {
          if (running.get(channel) === control) running.delete(channel);
        },
      });
      running.set(channel, control);
    }

    function applyLights(light: typeof live.light) {
      lights.uKeyDir.value.set(...light.key).normalize();
      lights.uKeyCol.value.set(...light.keyCol);
      lights.uFillDir.value.set(...light.fill).normalize();
      lights.uFillCol.value.set(...light.fillCol);
      lights.uRimDir.value.set(...light.rim).normalize();
      lights.uRimCol.value.set(...light.rimCol);
      lights.uSky.value.set(...light.sky);
      lights.uGround.value.set(...light.ground);
      glow.set(...light.glow);
    }
    function applyShape() {
      head.deform(weights);
      positionAttribute.needsUpdate = true;
      normalAttribute.needsUpdate = true;
      for (const { mesh, shell } of parts.values()) {
        shell.update();
        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.attributes.normal.needsUpdate = true;
      }
      gear.scale.x = 1 + 0.05 * weights.faceWidth;
      dirtyShape = false;
    }
    function applyMaterials(state: RenderState) {
      const u = skinMaterial.uniforms;
      u.uTone.value.set(...state.skin.tone);
      u.uHair.value.set(...state.hair.color);
      u.uIris.value.set(...state.eyes.iris);
      u.uFlush.value = state.skin.flush;
      u.uFreckles.value = state.skin.freckles;
      u.uAge.value = state.skin.age;
      u.uStubble.value = state.skin.stubble;
      u.uClean.value = state.skin.clean;
      u.uScalp.value = state.skin.scalp;
      u.uBrow.value = state.skin.brow;
      u.uBrowCut.value = state.skin.browCut;
      u.uMark.value = state.skin.mark;
      u.uEyeBright.value = state.eyes.bright;
      u.uSlope.value = state.eyes.slope;
      parts
        .get('hair')
        ?.mesh.material.uniforms.uColor.value.set(...state.hair.color);
      parts
        .get('beard')
        ?.mesh.material.uniforms.uColor.value.set(...state.hair.color)
        .multiplyScalar(0.8);
      const cloth = new Vector3(...state.outfit.color);
      const luminance = cloth.x * 0.3 + cloth.y * 0.6 + cloth.z * 0.1;
      const layered = parts.has('coat');
      parts.get('coat')?.mesh.material.uniforms.uColor.value.copy(cloth);
      parts
        .get('outfit')
        ?.mesh.material.uniforms.uColor.value.copy(
          layered
            ? luminance < 0.2
              ? cloth.clone().multiplyScalar(2.4).addScalar(0.07)
              : cloth.clone().multiplyScalar(0.3)
            : cloth
        );
    }

    function draw(
      scene_: WebGLRenderTarget,
      out: WebGLRenderTarget | null,
      grid: readonly [number, number],
      cell: number,
      coarse: number,
      yaw: number,
      open: number,
      aspect: number,
      origin: [number, number]
    ) {
      pivot.rotation.y = yaw;
      flip.scale.x = target?.mirror ? -1 : 1;
      skinMaterial.uniforms.uOpen.value = open * (target?.eyes.open ?? 1);
      camera.aspect = aspect;
      camera.position.set(CX, live.height + 0.25, 0.4 + live.distance);
      camera.lookAt(CX, live.height, 0.4);
      camera.updateProjectionMatrix();
      renderer.setRenderTarget(scene_);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      postMaterial.uniforms.tScene.value = scene_.texture;
      postMaterial.uniforms.uGrid.value.set(grid[0], grid[1]);
      postMaterial.uniforms.uCell.value = cell;
      postMaterial.uniforms.uCoarse.value = coarse;
      postMaterial.uniforms.uOrigin.value.set(origin[0], origin[1]);
      renderer.setRenderTarget(out);
      renderer.render(postScene, postCamera);
      renderer.setRenderTarget(null);
    }
    function render() {
      if (
        disposed ||
        !target ||
        !size.width ||
        renderer.getContext().isContextLost()
      )
        return;
      if (dirtyShape) applyShape();
      applyLights(live.light);
      // Centre the grid so partial cells split evenly between the two edges.
      const buffer = renderer.getDrawingBufferSize(new Vector2());
      const origin: [number, number] = [
        Math.floor((buffer.x - size.grid[0] * size.cell) / 2),
        Math.floor((buffer.y - size.grid[1] * size.cell) / 2),
      ];
      draw(
        sceneTarget,
        null,
        size.grid,
        size.cell,
        live.coarse,
        live.yaw,
        live.open,
        size.grid[0] / size.grid[1],
        origin
      );
    }
    function requestRender() {
      if (frame || disposed) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try {
          render();
        } catch {
          dispose();
          onRenderError?.();
        }
      });
    }

    function update(preset: PresetId, look: Look, pose: number) {
      if (disposed) return;
      const next = resolve(preset, look);
      const previous = target;
      const first = !previous;
      const swapped = currentPreset !== undefined && currentPreset !== preset;
      currentPreset = preset;
      target = next;

      if (first || previous.hair.style !== next.hair.style)
        setShell('hair', head.hairShell(next.hair.style), () =>
          propMaterial(next.hair.color, 1, {
            gloss: 14,
            spec: 0.22,
            weight: 0.8,
            depth: 5,
            double: true,
          })
        );
      if (first || previous.beard !== next.beard) {
        const beard = head.beardShell(next.beard);
        beardAttribute.set(beard.region);
        beardAttribute.needsUpdate = true;
        setShell('beard', beard.shell, () =>
          propMaterial(next.hair.color, 1, {
            gloss: 8,
            spec: 0.08,
            weight: 0.7,
            depth: 12,
            double: true,
          })
        );
      }
      if (first || previous.outfit.style !== next.outfit.style) {
        const layered =
          next.outfit.style === 'jacket' || next.outfit.style === 'trench';
        setShell('outfit', head.outfitShell(next.outfit.style, 0), () =>
          propMaterial(next.outfit.color, 2, {
            gloss: 6,
            spec: 0.04,
            weight: 0.85,
            depth: 8,
            double: true,
          })
        );
        setShell(
          'coat',
          layered ? head.outfitShell(next.outfit.style, 1) : undefined,
          () =>
            propMaterial(next.outfit.color, 2, {
              gloss: 8,
              spec: 0.06,
              weight: 0.85,
              depth: 4,
              double: true,
            })
        );
      }
      if (
        first ||
        previous.eyewear !== next.eyewear ||
        previous.earpiece !== next.earpiece
      )
        buildGear(next.eyewear, next.earpiece);
      applyMaterials(next);
      dirtyShape = true;

      const yaw = Math.max(-2, Math.min(2, pose)) * YAW_PER_STEP;
      if (first) {
        targetYaw = yaw;
        Object.assign(weights, next.morph);
        Object.assign(live, {
          yaw,
          distance: next.camera.distance,
          height: next.camera.height,
          light: { ...LIGHTS[next.light] },
        });
        // The first frame resolves in four coarse steps, like the 2D portrait reveal.
        live.coarse = 1;
        tween(
          'detail',
          4,
          1,
          MOTION.reveal,
          (value) => {
            live.coarse = Math.round(value);
          },
          4
        );
        requestRender();
        return;
      }
      // Shape: ease every channel together.
      if (MORPH_KEYS.some((key) => previous.morph[key] !== next.morph[key])) {
        const from = { ...weights };
        tween('shape', 0, 1, MOTION.base, (t) => {
          for (const key of MORPH_KEYS)
            weights[key] = from[key] + (next.morph[key] - from[key]) * t;
          dirtyShape = true;
        });
      }
      if (yaw !== targetYaw) {
        targetYaw = yaw;
        tween('yaw', live.yaw, yaw, MOTION.base, (value) => {
          live.yaw = value;
        });
      }
      if (previous.camera.distance !== next.camera.distance) {
        tween(
          'distance',
          live.distance,
          next.camera.distance,
          MOTION.reveal,
          (value) => {
            live.distance = value;
          }
        );
      }
      if (previous.camera.height !== next.camera.height) {
        tween(
          'height',
          live.height,
          next.camera.height,
          MOTION.reveal,
          (value) => {
            live.height = value;
          }
        );
      }
      if (previous.light !== next.light) {
        const a = live.light,
          b = LIGHTS[next.light];
        const mix = (x: V3, y: V3, t: number): V3 => [
          x[0] + (y[0] - x[0]) * t,
          x[1] + (y[1] - x[1]) * t,
          x[2] + (y[2] - x[2]) * t,
        ];
        const start = { ...a };
        tween('light', 0, 1, MOTION.reveal, (t) => {
          live.light = {
            key: mix(start.key, b.key, t),
            keyCol: mix(start.keyCol, b.keyCol, t),
            fill: mix(start.fill, b.fill, t),
            fillCol: mix(start.fillCol, b.fillCol, t),
            rim: mix(start.rim, b.rim, t),
            rimCol: mix(start.rimCol, b.rimCol, t),
            sky: mix(start.sky, b.sky, t),
            ground: mix(start.ground, b.ground, t),
            glow: mix(start.glow, b.glow, t),
          };
        });
      }
      if (swapped)
        tween(
          'detail',
          3,
          1,
          MOTION.base,
          (value) => {
            live.coarse = Math.round(value);
          },
          3
        );
      requestRender();
    }

    function resize(width: number, height: number) {
      if (disposed || width <= 0 || height <= 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      // One portrait pixel is 3 CSS px in a wide stage and 2 in a narrow one, always a whole number of device pixels.
      const cell = Math.max(1, Math.round((width >= 400 ? 3 : 2) * ratio));
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      const buffer = renderer.getDrawingBufferSize(new Vector2());
      const grid: [number, number] = [
        Math.ceil(buffer.x / cell),
        Math.ceil(buffer.y / cell),
      ];
      sceneTarget.setSize(grid[0], grid[1]);
      size = { width, height, cell, grid };
      // Draw now: setSize clears the canvas, and waiting a frame would flash black.
      if (target) render();
    }

    function captureCanonical() {
      if (disposed || !target || renderer.getContext().isContextLost())
        return undefined;
      // Capture the settled draft, not a transition frame: final shape, light and framing, front angle, eyes open.
      const saved = { weights: { ...weights }, live: { ...live } };
      const [w, h] = CANON.grid;
      const W = w * CANON.cell;
      const H = h * CANON.cell;
      const meshPixels = new Uint8Array(w * h * 4);
      const pixels = new Uint8Array(W * H * 4);
      try {
        Object.assign(weights, target.morph);
        Object.assign(live, {
          distance: target.camera.distance,
          height: target.camera.height,
          light: LIGHTS[target.light],
        });
        applyShape();
        applyLights(live.light);
        draw(
          captureScene,
          captureOut,
          CANON.grid,
          CANON.cell,
          1,
          0,
          1,
          w / h,
          [0, 0]
        );
        renderer.readRenderTargetPixels(captureScene, 0, 0, w, h, meshPixels);
        if (!meshPixels.some((value, index) => index % 4 === 3 && value > 0))
          return undefined;
        renderer.readRenderTargetPixels(captureOut, 0, 0, W, H, pixels);
      } finally {
        Object.assign(weights, saved.weights);
        Object.assign(live, saved.live);
        renderer.setRenderTarget(null);
        dirtyShape = true;
        requestRender();
      }

      if (
        renderer.getContext().isContextLost() ||
        !pixels.some((value, index) => index % 4 !== 3 && value !== 0)
      ) {
        return undefined;
      }

      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const context = out.getContext('2d');
      if (!context) return undefined;
      const image = context.createImageData(W, H);
      for (let y = 0; y < H; y++)
        image.data.set(
          pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4),
          y * W * 4
        );
      context.putImageData(image, 0, 0);
      return out.toDataURL('image/png');
    }

    disposables.push({
      dispose() {
        for (const item of gearItems) item.dispose();
      },
    });

    return { update, resize, captureCanonical, dispose };
  }
}
