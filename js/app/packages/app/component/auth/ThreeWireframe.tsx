import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import isWebGL2Available from 'three/addons/capabilities/WebGL.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import modelM from './model-m.glb?inline';
import {
  colorAccent,
  colorBase,
  colorContrast,
  pixelation,
  rafSpeed,
  setColor,
  speed,
} from './store.js';

const models: Record<string, string> = {
  m: modelM,
};

interface ThreeWireframeProps {
  clockwise: boolean;
  scale: number;
  src: string;
}

export default function ThreeWireframe(props: ThreeWireframeProps) {
  const clockwise = props.clockwise ?? false;
  let renderer!: THREE.WebGLRenderer;
  let containerRef!: HTMLDivElement;
  const scale = props.scale ?? 1;
  let canvas!: HTMLCanvasElement;
  let controls!: OrbitControls;
  let scene!: THREE.Scene;
  const height = 350;
  const width = 350;

  const [grab, setGrab] = createSignal('grab');
  const [wireframe, setWireframe] = createSignal<THREE.LineSegments | null>(
    null
  ); // Make wireframe reactive
  let onPointerMove: (event: PointerEvent) => void;
  let pointerRelease: () => void;

  onMount(async () => {
    if (!isWebGL2Available) {
      return;
    }
    setColor();
    renderer = new THREE.WebGLRenderer();
    renderer.setClearColor(0x000000, 0);
    canvas = renderer.domElement;
    canvas.style.imageRendering = 'pixelated';
    canvas.style.width = 'min(350px, 100%)';
    canvas.style.aspectRatio = '1 / 1';

    let pointer = new THREE.Vector2();
    pointer.y = 2;
    pointer.x = 2;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    const loader = new GLTFLoader();
    scene = new THREE.Scene();

    const maxDistance = 8;

    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.autoRotate = true;
    camera.position.z = 10;

    let material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
    });

    loader.load(
      models[props.src],
      (glb) => {
        const mesh = glb.scene.children[0] as THREE.Mesh;
        const wireframeGeometry = new THREE.WireframeGeometry(mesh.geometry);

        const colors = [];
        const positions = wireframeGeometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          colors.push(1, 1, 1);
        }
        wireframeGeometry.setAttribute(
          'color',
          new THREE.Float32BufferAttribute(colors, 3)
        );

        const wireframeObject = new THREE.LineSegments(
          wireframeGeometry,
          material
        );
        wireframeObject.scale.setScalar(scale);
        scene.add(wireframeObject);
        setWireframe(wireframeObject); // Set the wireframe signal
      },
      undefined,
      (error) => {
        console.error('Error loading model:', error);
      }
    );

    createEffect(() => {
      const currentWireframe = wireframe();
      if (!currentWireframe) {
        return;
      }
      colorContrast();
      colorAccent();
      updateWireframeColors(currentWireframe);
    });

    onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    pointerRelease = () => {
      setGrab('grab');
    };

    function updateWireframeColors(currentWireframe: THREE.LineSegments) {
      const geometry = currentWireframe.geometry;
      const positions = geometry.attributes.position;
      const colors = geometry.attributes.color;
      const raycaster = new THREE.Raycaster();

      raycaster.setFromCamera(pointer, camera);
      const distance = camera.position.distanceTo(currentWireframe.position);
      const pointerWorldPosition = raycaster.ray.at(
        distance,
        new THREE.Vector3()
      );

      for (let i = 0; i < positions.count; i++) {
        const vertex = new THREE.Vector3(
          positions.getX(i),
          positions.getY(i),
          positions.getZ(i)
        );

        vertex.applyMatrix4(currentWireframe.matrixWorld);
        const distanceToPointer = pointerWorldPosition.distanceTo(vertex);
        const normalizedDistance = Math.min(distanceToPointer / maxDistance, 1);

        const mixedColor = new THREE.Color().lerpColors(
          colorAccent()!,
          colorContrast()!,
          normalizedDistance
        );
        colors.setXYZ(i, mixedColor.r, mixedColor.g, mixedColor.b);
      }
      colors.needsUpdate = true;
    }

    function config() {
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }
    config();

    function animate() {
      controls.update();
      const currentWireframe = wireframe();
      if (currentWireframe) {
        updateWireframeColors(currentWireframe);
      }
      renderer.render(scene, camera);
    }

    window.addEventListener('pointerup', pointerRelease, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    containerRef.appendChild(canvas);
    renderer.setAnimationLoop(animate);

    createEffect(() => {
      controls.autoRotateSpeed = clockwise
        ? Math.exp(speed() * rafSpeed * 0.5) * -1
        : Math.exp(speed() * rafSpeed * 0.5);
    });
    createEffect(() => {
      scene.fog = new THREE.Fog(colorBase()!, 8, 13);
    });
    createEffect(() => {
      renderer.setPixelRatio(Math.pow(pixelation(), 6));
    });
    createEffect(() => {
      canvas.style.cursor = grab();
    });
  });

  onCleanup(() => {
    if (!isWebGL2Available || typeof window === 'undefined') {
      return;
    }
    window.removeEventListener('pointerup', pointerRelease);
    window.removeEventListener('pointermove', onPointerMove);
    renderer.setAnimationLoop(null);
    controls.dispose();
    renderer.dispose();
  });

  return (
    <div
      style={{
        width: 'min(350px, 100%)',
        'aspect-ratio': '1 / 1',
        'touch-action': 'none',
        'user-select': 'none',
      }}
      onPointerDown={() => setGrab('grabbing')}
      ref={containerRef}
    />
  );
}
