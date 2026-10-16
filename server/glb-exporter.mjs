import * as THREE from 'three';

/**
 * Exports a THREE.Object3D hierarchy containing THREE.Mesh nodes into a valid
 * binary glTF 2.0 (.glb) Buffer in Node.js without requiring browser FileReader APIs.
 */
export function exportObject3DToGLB(root) {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const meshes = [];
  const materials = [];
  const nodes = [];
  const accessors = [];
  const bufferViews = [];
  const binaryChunks = [];
  let byteOffset = 0;

  function appendAligned(typedArray) {
    const buf = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    const aligned = pad > 0 ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf;
    const viewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: buf.length,
    });
    binaryChunks.push(aligned);
    byteOffset += aligned.length;
    return viewIndex;
  }

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const geom = child.geometry.clone();
    const relMatrix = new THREE.Matrix4().multiplyMatrices(rootInverse, child.matrixWorld);
    geom.applyMatrix4(relMatrix);
    if (!geom.attributes.normal) {
      geom.computeVertexNormals();
    }

    const posAttr = geom.attributes.position;
    if (!posAttr || posAttr.count === 0) return;

    const posArray = new Float32Array(posAttr.count * 3);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      posArray[i * 3] = x;
      posArray[i * 3 + 1] = y;
      posArray[i * 3 + 2] = z;
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }

    const posView = appendAligned(posArray);
    const posAccessor = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: 5126, // FLOAT
      count: posAttr.count,
      type: 'VEC3',
      min,
      max,
    });

    const normAttr = geom.attributes.normal;
    let normAccessor;
    if (normAttr && normAttr.count === posAttr.count) {
      const normArray = new Float32Array(normAttr.count * 3);
      for (let i = 0; i < normAttr.count; i++) {
        normArray[i * 3] = normAttr.getX(i);
        normArray[i * 3 + 1] = normAttr.getY(i);
        normArray[i * 3 + 2] = normAttr.getZ(i);
      }
      const normView = appendAligned(normArray);
      normAccessor = accessors.length;
      accessors.push({
        bufferView: normView,
        componentType: 5126,
        count: normAttr.count,
        type: 'VEC3',
      });
    }

    let indicesAccessor;
    if (geom.index && geom.index.count > 0) {
      const idxArray = new Uint32Array(geom.index.count);
      for (let i = 0; i < geom.index.count; i++) {
        idxArray[i] = geom.index.getX(i);
      }
      const idxView = appendAligned(idxArray);
      indicesAccessor = accessors.length;
      accessors.push({
        bufferView: idxView,
        componentType: 5125, // UNSIGNED_INT
        count: geom.index.count,
        type: 'SCALAR',
      });
    }

    const mat = Array.isArray(child.material) ? child.material[0] : child.material;
    const color = mat?.color ? [mat.color.r, mat.color.g, mat.color.b, 1.0] : [0.85, 0.72, 0.25, 1.0];
    const metallicFactor = typeof mat?.metalness === 'number' ? mat.metalness : 0.8;
    const roughnessFactor = typeof mat?.roughness === 'number' ? mat.roughness : 0.25;
    const emissiveFactor = mat?.emissive ? [mat.emissive.r, mat.emissive.g, mat.emissive.b] : [0, 0, 0];

    const matIndex = materials.length;
    materials.push({
      name: child.name ? `${child.name}_mat` : `mat_${matIndex}`,
      pbrMetallicRoughness: {
        baseColorFactor: color,
        metallicFactor,
        roughnessFactor,
      },
      emissiveFactor,
      doubleSided: true,
    });

    const primitive = {
      attributes: {
        POSITION: posAccessor,
        ...(normAccessor !== undefined ? { NORMAL: normAccessor } : {}),
      },
      ...(indicesAccessor !== undefined ? { indices: indicesAccessor } : {}),
      material: matIndex,
    };

    const meshIndex = meshes.length;
    meshes.push({
      name: child.name || `part_${meshIndex}`,
      primitives: [primitive],
    });

    nodes.push({
      name: child.name || `node_${meshIndex}`,
      mesh: meshIndex,
    });
  });

  const rootNodeIndex = nodes.length;
  nodes.push({
    name: root.name || 'GeneratedReflector3D',
    children: nodes.map((_, idx) => idx),
  });

  const binBuffer = Buffer.concat(binaryChunks);
  const gltfJson = {
    asset: {
      version: '2.0',
      generator: 'Argon-Suncatcher-3D-Generator',
    },
    scene: 0,
    scenes: [
      {
        name: 'ReflectorScene',
        nodes: [rootNodeIndex],
      },
    ],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [
      {
        byteLength: binBuffer.length,
      },
    ],
  };

  const jsonBufferRaw = Buffer.from(JSON.stringify(gltfJson), 'utf8');
  const jsonPad = (4 - (jsonBufferRaw.length % 4)) % 4;
  const jsonBuffer =
    jsonPad > 0
      ? Buffer.concat([jsonBufferRaw, Buffer.alloc(jsonPad, 0x20)]) // pad with spaces per glTF spec
      : jsonBufferRaw;

  const totalLength = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4); // version 2
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuffer.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonChunkHeader, jsonBuffer, binChunkHeader, binBuffer]);
}
