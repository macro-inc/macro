import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  type ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { CX, type Head } from './head';
import type { RenderState } from './resolve';
import type { V3 } from './scene-settings';

export type PropOptions = {
  gloss?: number;
  spec?: number;
  weight?: number;
  screen?: number;
  glow?: number;
  depth?: number;
  double?: boolean;
};

export function createPortraitGear(
  content: Group,
  head: Head,
  propMaterial: (
    color: V3,
    kind: number,
    options?: PropOptions
  ) => ShaderMaterial
) {
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
    return mesh;
  }
  function bar(material: ShaderMaterial, from: V3, to: V3, thickness: number) {
    const a = new Vector3(...from),
      b = new Vector3(...to);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    gearMesh(
      new BoxGeometry(thickness, thickness, a.distanceTo(b)),
      material,
      [mid.x, mid.y, mid.z],
      (mesh) =>
        mesh.quaternion.setFromUnitVectors(
          new Vector3(0, 0, 1),
          b.clone().sub(a).normalize()
        )
    );
  }
  const pins: { mesh: Mesh; vertex: number; offset: V3 }[] = [];
  function pinned(
    geometry: BufferGeometry,
    material: ShaderMaterial,
    vertex: number,
    offset: V3,
    setup?: (mesh: Mesh) => void
  ) {
    const mesh = gearMesh(geometry, material, [0, 0, 0], setup);
    content.add(mesh);
    pins.push({ mesh, vertex, offset });
  }
  function placePinned() {
    for (const { mesh, vertex, offset } of pins)
      mesh.position.set(
        head.position[vertex * 3] + offset[0],
        head.position[vertex * 3 + 1] + offset[1],
        head.position[vertex * 3 + 2] + offset[2]
      );
  }
  function buildGear(
    eyewear: RenderState['eyewear'],
    earpiece: RenderState['earpiece']
  ) {
    clearGear();
    const eyeY = 1.66,
      lensZ = 2.3,
      eyeX = 0.645;
    // Sizes are chosen to survive the pixel grid: nothing thinner than about one portrait pixel at standard framing.
    if (eyewear !== 'none') {
      const metal = eyewear === 'rimless' || eyewear === 'wire';
      const frame = metal
        ? propMaterial([0.5, 0.42, 0.28], 0, {
            gloss: 40,
            spec: 0.5,
            weight: 0.05,
            glow: 0.35,
          })
        : propMaterial([0.012, 0.012, 0.016], 0, {
            gloss: 30,
            spec: 0.25,
            weight: 0.05,
          });
      const thin = metal ? 0.05 : 0.07;
      for (const side of [-1, 1]) {
        const x = side * eyeX;
        if (metal)
          gearMesh(
            new TorusGeometry(0.37, eyewear === 'wire' ? 0.04 : 0.026, 6, 24),
            frame,
            [x, eyeY, lensZ],
            (mesh) => mesh.scale.set(1, 0.84, 1)
          );
        else {
          const w = 0.82,
            h = 0.5,
            t = 0.08;
          gearMesh(new BoxGeometry(w + t, t, t), frame, [
            x,
            eyeY + h / 2,
            lensZ,
          ]);
          gearMesh(new BoxGeometry(w + t, t, t), frame, [
            x,
            eyeY - h / 2,
            lensZ,
          ]);
          gearMesh(new BoxGeometry(t, h, t), frame, [x - w / 2, eyeY, lensZ]);
          gearMesh(new BoxGeometry(t, h, t), frame, [x + w / 2, eyeY, lensZ]);
        }
        // Clear lenses are left open so the eyes stay crisp; rimless ones get a glint, shades are solid.
        if (eyewear === 'shades')
          gearMesh(
            new PlaneGeometry(0.8, 0.48),
            propMaterial([0.008, 0.009, 0.012], 0, {
              gloss: 50,
              spec: 0.5,
              weight: 0.05,
              double: true,
            }),
            [x, eyeY, lensZ - 0.01]
          );
        if (eyewear === 'rimless')
          gearMesh(
            new BoxGeometry(0.3, 0.03, 0.01),
            propMaterial([0.6, 0.7, 0.8], 0, { glow: 0.5, weight: 0.02 }),
            [x - 0.08, eyeY + 0.14, lensZ],
            (mesh) => {
              mesh.rotation.z = 0.5;
            }
          );
        bar(
          frame,
          [side * (eyeX + 0.38), eyeY + 0.08, lensZ],
          [side * 1.6, eyeY + 0.1, 0.4],
          thin
        );
      }
      gearMesh(new BoxGeometry(0.52, thin, thin), frame, [
        0,
        eyeY + 0.1,
        lensZ,
      ]);
    }
    // Earpieces ride the morphed ear: each is pinned to a scan vertex and re-placed whenever the shape changes.
    if (earpiece === 'stud' || earpiece === 'ring') {
      const gold = propMaterial([0.75, 0.5, 0.16], 0, {
        gloss: 30,
        spec: 0.8,
        weight: 0.05,
        glow: 0.55,
      });
      for (const side of [-1, 1] as const) {
        const vertex = head.earVertex(side, 0.6, 0.85);
        if (earpiece === 'stud')
          pinned(new SphereGeometry(0.13, 10, 8), gold, vertex, [
            side * 0.12,
            -0.02,
            0.36,
          ]);
        else
          pinned(
            new TorusGeometry(0.19, 0.045, 6, 16),
            gold,
            vertex,
            [side * 0.09, -0.22, 0.2],
            (mesh) => {
              mesh.rotation.y = side * 0.5;
            }
          );
      }
    }
    if (earpiece === 'comms') {
      const shell = propMaterial([0.035, 0.04, 0.05], 0, {
        gloss: 24,
        spec: 0.3,
        weight: 0.05,
        glow: 0.3,
      });
      const lamp = propMaterial([0.89, 0.65, 0.23], 0, {
        glow: 1.6,
        weight: 0.02,
      });
      const vertex = head.earVertex(-1, 1.2, 1.5);
      pinned(new BoxGeometry(0.2, 0.7, 0.42), shell, vertex, [-0.1, 0, 0.35]);
      const boom = new BoxGeometry(0.08, 0.08, 2.0);
      pinned(boom, shell, vertex, [0.42, -0.6, 1.25], (mesh) => {
        mesh.rotation.set(0.37, 0.52, 0);
      });
      pinned(
        new SphereGeometry(0.11, 10, 8),
        lamp,
        vertex,
        [0.93, -0.95, 2.12]
      );
    }
    placePinned();
  }

  function clearGear() {
    for (const item of gearItems) item.dispose();
    gearItems.clear();
    gear.clear();
    for (const pin of pins) content.remove(pin.mesh);
    pins.length = 0;
  }

  return {
    update: buildGear,
    deform(faceWidth: number) {
      gear.scale.x = 1 + 0.05 * faceWidth;
      placePinned();
    },
    dispose: clearGear,
  };
}
