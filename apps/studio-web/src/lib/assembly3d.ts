import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AssemblyPart } from '@ikguide/schema';

/**
 * Imperative three.js engine behind <Assembly3DViewer />.
 *
 * Kept out of React on purpose: the renderer owns a requestAnimationFrame loop, WebGL resources and
 * pointer handlers, none of which map well onto a declarative component. The React wrapper only
 * creates one engine per model and forwards state changes.
 *
 * Visual language (matches the IKEA sheet):
 *  • installed parts — matte white plastic with a thin dark edge overlay;
 *  • active part     — flat Apple-blue highlight that flies in along its assembly vector;
 *  • future parts    — hidden by default, or a ghost outline that shows where they will land.
 */

export type ViewerTheme = 'light' | 'dark';

export interface AssemblyViewModel {
  glbDataUrl: string;
  parts: readonly AssemblyPart[];
  theme: ViewerTheme;
}

export interface AssemblyViewApi {
  setHighlight(activeIds: readonly string[], installedIds: readonly string[]): void;
  setExplode(value: number): void;
  getExplode(): number;
  playInstall(): void;
  setGhostVisible(visible: boolean): void;
  setTheme(theme: ViewerTheme): void;
  resetCamera(): void;
  /** Number of triangles actually rendered — the same metric the cad-api reports. */
  triangleCount(): number;
  dispose(): void;
}

export class AssemblyViewError extends Error {}

const EXPLODE_SHARE = 0.42;
const INSTALL_DURATION_MS = 900;

interface PartVisual {
  id: string;
  meshes: THREE.Mesh[];
  edges: THREE.LineSegments[];
  origin: THREE.Vector3[];
  direction: THREE.Vector3;
  role: AssemblyPart['role'];
  state: 'installed' | 'active' | 'ghost' | 'hidden';
}

function dataUrlToBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    throw new AssemblyViewError('Файл модели повреждён: нет данных.');
  }
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (meta.includes(';base64')) {
    const binary = globalThis.atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  }
  return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function paletteFor(theme: ViewerTheme) {
  if (theme === 'dark') {
    return {
      installed: 0xdfe4ec,
      installedEdge: 0x11141a,
      active: 0x0a84ff,
      activeEdge: 0x6fb6ff,
      ghost: 0x8a92a3,
      ghostEdge: 0x8a92a3,
      background: 0x111318,
      grid: 0x232730,
    };
  }
  return {
    installed: 0xffffff,
    installedEdge: 0x1d1d1f,
    active: 0x007aff,
    activeEdge: 0x003f80,
    ghost: 0xc8ccd4,
    ghostEdge: 0x8a8f9e,
    background: 0xf9f9fb,
    grid: 0xe4e6ec,
  };
}

export async function createAssemblyView(
  container: HTMLElement,
  model: AssemblyViewModel,
): Promise<AssemblyViewApi> {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    throw new AssemblyViewError('Браузер не поддерживает WebGL: 3D-модель показать нельзя.');
  }
  if (!renderer.getContext()) {
    throw new AssemblyViewError('Браузер не поддерживает WebGL: 3D-модель показать нельзя.');
  }

  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.5, 20_000);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 0.9;
  controls.enablePan = true;
  controls.screenSpacePanning = true;

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x9aa2b1, 2.1);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(0.7, 1.4, 0.9);
  const fill = new THREE.DirectionalLight(0xffffff, 1.1);
  fill.position.set(-1.1, 0.5, -0.8);
  scene.add(hemisphere, key, fill);

  let theme: ViewerTheme = model.theme;
  let palette = paletteFor(theme);

  const materialFor = (state: PartVisual['state']) => {
    switch (state) {
      case 'active':
        return new THREE.MeshStandardMaterial({
          color: palette.active,
          roughness: 0.42,
          metalness: 0.05,
          emissive: new THREE.Color(palette.active).multiplyScalar(0.18),
          transparent: true,
          opacity: 0.98,
        });
      case 'ghost':
        return new THREE.MeshStandardMaterial({
          color: palette.ghost,
          roughness: 0.9,
          metalness: 0,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
        });
      case 'hidden':
        return new THREE.MeshStandardMaterial({ color: palette.installed, transparent: true, opacity: 0 });
      default:
        return new THREE.MeshStandardMaterial({ color: palette.installed, roughness: 0.72, metalness: 0.02 });
    }
  };

  const edgeMaterialFor = (state: PartVisual['state']) => {
    const color = state === 'active' ? palette.activeEdge : state === 'ghost' ? palette.ghostEdge : palette.installedEdge;
    const opacity = statusOpacity(state);
    return new THREE.LineBasicMaterial({ color, linewidth: 1, transparent: opacity < 1, opacity });
  };

  function statusOpacity(state: PartVisual['state']): number {
    if (state === 'ghost') {
      return 0.55;
    }
    if (state === 'hidden') {
      return 0;
    }
    return 1;
  }

  // ---- load the GLB -------------------------------------------------------
  const loader = new GLTFLoader();
  const buffer = dataUrlToBuffer(model.glbDataUrl);
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    loader.parse(
      buffer,
      '',
      (result) => resolve(result as unknown as { scene: THREE.Group }),
      (error) => reject(new AssemblyViewError(`Не удалось прочитать GLB: ${String((error as unknown as Error)?.message ?? error)}`)),
    );
  });

  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const partByNode = new Map<string, AssemblyPart>();
  for (const part of model.parts) {
    partByNode.set(part.nodeName, part);
    partByNode.set(part.id, part);
  }

  const visuals = new Map<string, PartVisual>();
  const unmatched: THREE.Mesh[] = [];
  let triangles = 0;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }
    triangles += Math.floor((mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0) / 3);
    const nodeName = mesh.parent && mesh.parent !== root ? mesh.parent.name : mesh.name;
    const part = partByNode.get(nodeName) ?? partByNode.get(mesh.name);
    if (!part) {
      unmatched.push(mesh);
      return;
    }
    let visual = visuals.get(part.id);
    if (!visual) {
      const vector = new THREE.Vector3(...part.explosionVector);
      if (vector.lengthSq() < 1e-6) {
        vector.set(0, 1, 0);
      }
      visual = {
        id: part.id,
        meshes: [],
        edges: [],
        origin: [],
        direction: vector.normalize(),
        role: part.role,
        state: 'installed',
      };
      visuals.set(part.id, visual);
    }
    visual.meshes.push(mesh);
    visual.origin.push(mesh.position.clone());
  });

  // Parts with no matching node in the GLB still get a visual, so the highlight logic never throws.
  for (const part of model.parts) {
    if (!visuals.has(part.id)) {
      const vector = new THREE.Vector3(...part.explosionVector);
      visuals.set(part.id, {
        id: part.id,
        meshes: [],
        edges: [],
        origin: [],
        direction: vector.lengthSq() > 1e-6 ? vector.normalize() : new THREE.Vector3(0, 1, 0),
        role: part.role,
        state: 'installed',
      });
    }
  }

  // Edges of every part: the "technical drawing" accent of the IKEA look.
  for (const visual of visuals.values()) {
    for (const mesh of visual.meshes) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 28), edgeMaterialFor(visual.state));
      edges.name = `edges:${visual.id}`;
      mesh.add(edges);
      visual.edges.push(edges);
    }
  }

  // Unmatched meshes stay visible as neutral geometry (e.g. a GLB whose node names were lost).
  for (const mesh of unmatched) {
    mesh.material = new THREE.MeshStandardMaterial({ color: palette.installed, roughness: 0.8, metalness: 0.02 });
  }

  scene.add(root);

  // ---- camera framing -----------------------------------------------------
  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const diagonal = Math.max(1, box.getSize(new THREE.Vector3()).length());
  const center = sphere.center.clone();
  const radius = Math.max(1, sphere.radius);

  function frameCamera(azimuth = 38, elevation = 26): void {
    const az = (azimuth * Math.PI) / 180;
    const el = (elevation * Math.PI) / 180;
    const distance = radius * 3.1;
    camera.position.set(
      center.x + Math.sin(az) * Math.cos(el) * distance,
      center.y + Math.sin(el) * distance,
      center.z + Math.cos(az) * Math.cos(el) * distance,
    );
    camera.near = Math.max(0.5, radius / 60);
    camera.far = radius * 40;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.minDistance = radius * 1.1;
    controls.maxDistance = radius * 9;
    controls.update();
  }

  frameCamera();

  const groundY = box.min.y - diagonal * 0.02;
  const grid = new THREE.GridHelper(diagonal * 2.4, 12, palette.grid, palette.grid);
  grid.position.set(center.x, groundY, center.z);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  scene.add(grid);

  // ---- state --------------------------------------------------------------
  let explode = 0.55;
  let ghostVisible = true;
  let activeIds: string[] = [];
  let installedIds: string[] = [];
  let animation: { start: number; from: number; to: number } | null = null;
  let activeFactor = explode;
  let disposed = false;

  function applyMaterials(visual: PartVisual): void {
    for (const mesh of visual.meshes) {
      const previous = mesh.material;
      mesh.material = materialFor(visual.state);
      if (Array.isArray(previous)) {
        previous.forEach((item) => item.dispose());
      } else {
        previous.dispose();
      }
      mesh.visible = visual.state !== 'hidden';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
    for (const edges of visual.edges) {
      const previous = edges.material;
      edges.material = edgeMaterialFor(visual.state);
      (previous as THREE.Material).dispose();
      edges.visible = visual.state !== 'hidden' && !(visual.state === 'ghost' && !ghostVisible);
    }
  }

  function resolveStates(): void {
    const active = new Set(activeIds);
    const installed = new Set(installedIds);
    for (const visual of visuals.values()) {
      const next: PartVisual['state'] = active.has(visual.id)
        ? 'active'
        : installed.has(visual.id)
          ? 'installed'
          : ghostVisible
            ? 'ghost'
            : 'hidden';
      if (next !== visual.state) {
        visual.state = next;
        applyMaterials(visual);
      }
    }
  }

  function applyOffsets(): void {
    for (const visual of visuals.values()) {
      const share = visual.state === 'active' ? activeFactor : visual.state === 'ghost' ? explode * 0.7 : 0;
      const offset = visual.direction.clone().multiplyScalar(diagonal * EXPLODE_SHARE * share);
      visual.meshes.forEach((mesh, index) => {
        const origin = visual.origin[index] ?? new THREE.Vector3();
        mesh.position.copy(origin).add(offset);
      });
    }
  }

  resolveStates();
  applyOffsets();

  renderer.setAnimationLoop((time) => {
    if (disposed) {
      return;
    }
    if (animation) {
      const progress = Math.min(1, (time - animation.start) / INSTALL_DURATION_MS);
      activeFactor = animation.from + (animation.to - animation.from) * ease(progress);
      if (progress >= 1) {
        activeFactor = animation.to;
        animation = null;
      }
      applyOffsets();
    }
    controls.update();
    renderer.render(scene, camera);
  });

  const resizeObserver = new ResizeObserver(() => {
    if (disposed) {
      return;
    }
    const nextWidth = Math.max(1, container.clientWidth);
    const nextHeight = Math.max(1, container.clientHeight);
    renderer.setSize(nextWidth, nextHeight, false);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(container);

  return {
    setHighlight(nextActive, nextInstalled) {
      activeIds = [...nextActive];
      installedIds = [...nextInstalled];
      resolveStates();
      applyOffsets();
    },
    setExplode(value) {
      explode = Math.max(0, Math.min(1, value));
      activeFactor = explode;
      applyOffsets();
    },
    getExplode() {
      return explode;
    },
    playInstall() {
      animation = { start: performance.now(), from: 1, to: explode };
      activeFactor = 1;
      applyOffsets();
    },
    setGhostVisible(visible) {
      ghostVisible = visible;
      resolveStates();
      applyOffsets();
    },
    setTheme(next) {
      if (next === theme) {
        return;
      }
      theme = next;
      palette = paletteFor(next);
      for (const visual of visuals.values()) {
        applyMaterials(visual);
      }
      for (const material of [grid.material]) {
        const items = Array.isArray(material) ? material : [material];
        items.forEach((item) => item.dispose());
      }
      const nextGrid = new THREE.GridHelper(diagonal * 2.4, 12, palette.grid, palette.grid);
      nextGrid.position.copy(grid.position);
      (nextGrid.material as THREE.Material).transparent = true;
      (nextGrid.material as THREE.Material).opacity = 0.55;
      scene.remove(grid);
      scene.add(nextGrid);
    },
    resetCamera() {
      frameCamera();
    },
    triangleCount() {
      return triangles;
    },
    dispose() {
      disposed = true;
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh || (object as THREE.LineSegments).isLineSegments) {
          mesh.geometry?.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) {
            material.forEach((item) => item.dispose());
          } else {
            material?.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
