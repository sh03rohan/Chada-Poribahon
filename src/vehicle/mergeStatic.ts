import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Draw-call reducer for hand-built models: merges the plain static meshes under `group` into a
 * few vertex-coloured meshes (one per roughness/metalness/side bucket) and merges meshes that
 * share the same material object (glass panes, lamp clusters, interior lining) into one mesh each.
 * Anything under a node in `skip` (animated parts, people) is left alone, as are instanced /
 * skinned meshes and textured or emissive materials that code changes later.
 */
export function mergeStaticMeshes(group: THREE.Object3D, skip: Set<THREE.Object3D>, shadows: boolean) {
  group.updateWorldMatrix(true, true);
  const inv = group.matrixWorld.clone().invert();
  type Bucket = { geos: THREE.BufferGeometry[]; roughness: number; metalness: number; side: THREE.Side; cast: boolean; receive: boolean };
  const buckets = new Map<string, Bucket>();
  const shared = new Map<THREE.Material, { meshes: THREE.Mesh[] }>();
  const remove: THREE.Mesh[] = [];
  const rel = new THREE.Matrix4();

  const bakeable = (m: THREE.Material): m is THREE.MeshStandardMaterial =>
    m.type === 'MeshStandardMaterial' && !(m as THREE.MeshStandardMaterial).map && !(m as THREE.MeshStandardMaterial).emissiveMap && !m.transparent && m.opacity === 1 &&
    (m as THREE.MeshStandardMaterial).emissive.getHex() === 0 && !(m as THREE.MeshStandardMaterial).alphaMap && !(m as THREE.MeshStandardMaterial).normalMap && !m.vertexColors;

  const walk = (o: THREE.Object3D) => {
    if (skip.has(o)) return;
    if (o.type === 'Mesh') {
      const m = o as THREE.Mesh;
      if (!Array.isArray(m.material) && !m.morphTargetInfluences) {
        if (bakeable(m.material)) {
          const mat = m.material;
          const key = `${mat.roughness.toFixed(2)}|${mat.metalness.toFixed(2)}|${mat.side}`;
          let b = buckets.get(key);
          if (!b) { b = { geos: [], roughness: mat.roughness, metalness: mat.metalness, side: mat.side, cast: false, receive: false }; buckets.set(key, b); }
          rel.multiplyMatrices(inv, m.matrixWorld);
          b.geos.push(bakeGeometry(m.geometry, rel, mat.color));
          b.cast ||= m.castShadow; b.receive ||= m.receiveShadow;
          remove.push(m);
          return;
        }
        let s = shared.get(m.material); if (!s) { s = { meshes: [] }; shared.set(m.material, s); } s.meshes.push(m);
        return;
      }
    }
    for (const c of o.children) walk(c);
  };
  for (const c of [...group.children]) walk(c);

  for (const b of buckets.values()) {
    const g = mergeGeometries(b.geos, false)!;
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: b.roughness, metalness: b.metalness, side: b.side }));
    mesh.castShadow = b.cast && shadows; mesh.receiveShadow = b.receive && shadows; mesh.name = 'merged';
    group.add(mesh);
  }
  for (const [mat, s] of shared) {
    if (s.meshes.length < 2) continue;
    const geos = s.meshes.map((m) => { rel.multiplyMatrices(inv, m.matrixWorld); const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()); return stripTo(g, ['position', 'normal', 'uv']).applyMatrix4(rel); });
    const g = mergeGeometries(geos, false); if (!g) continue;
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = Math.max(...s.meshes.map((m) => m.renderOrder)); mesh.castShadow = s.meshes.some((m) => m.castShadow) && shadows; mesh.receiveShadow = s.meshes.some((m) => m.receiveShadow) && shadows;
    mesh.name = 'merged-' + (s.meshes[0].name || mat.type);
    group.add(mesh); remove.push(...s.meshes);
  }
  for (const m of remove) m.removeFromParent();
}

function stripTo(g: THREE.BufferGeometry, keep: string[]): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.morphAttributes = {};
  return g;
}

function bakeGeometry(src: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  stripTo(g, ['position', 'normal']);
  g.deleteAttribute('uv');
  g.applyMatrix4(m);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
