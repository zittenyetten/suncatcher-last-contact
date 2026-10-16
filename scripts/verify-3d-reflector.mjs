import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { generateReflector3DFromApprovedDesign } from '../server/reflector-3d-generator.mjs';

const projectRoot = process.cwd();

console.log('=== Step 1 Verification: Actual 3D Reflector Generation & Browser Load/Rotate/Place ===');

const meta = await generateReflector3DFromApprovedDesign({
  requestId: 'req-step1-verify',
  approvedDesignVersion: 1,
  activeDesignVersion: 1,
  designConfirmed: true,
  description:
    '19-segment hexagonal gold honeycomb optical mirror array with chamfered dark titanium bezel, 4 glowing blue corner alignment fiducials, and rear carbon-composite truss dual-axis gimbal mount.',
  imagePath: 'artifacts/designs/design-hex-v1.png',
  projectRoot,
  timeoutMs: 90000,
});

console.log('Generated 3D Reflector Metadata:', JSON.stringify(meta, null, 2));

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Step 1 3D Reflector Verification</title>
  <style>body { margin: 0; background: #050a14; color: #e2f1ff; font-family: monospace; }</style>
  <script type="importmap">
  {
    "imports": {
      "three": "/node_modules/three/build/three.module.js",
      "three/addons/": "/node_modules/three/examples/jsm/"
    }
  }
  </script>
</head>
<body>
  <canvas id="c" width="1280" height="720"></canvas>
  <script type="module">
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 720);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060d1a);

    const camera = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 200);
    camera.position.set(1.8, 1.9, 0.2);
    camera.lookAt(0, 1.4, -3.5);

    scene.add(new THREE.AmbientLight(0x88aaff, 1.2));
    const dir = new THREE.DirectionalLight(0xfff4d8, 2.8);
    dir.position.set(5, 8, 6);
    scene.add(dir);

    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('${meta.files.glbUrl}');
    const reflector = gltf.scene;

    // Place on orbital mount
    reflector.position.set(0, 1.4, -3.5);
    scene.add(reflector);
    renderer.render(scene, camera);

    const initialRotation = { x: reflector.rotation.x, y: reflector.rotation.y, z: reflector.rotation.z };

    // Rotate reflector in 3D space (yaw & pitch alignment test)
    reflector.rotation.set(-0.22, 0.42, 0);
    reflector.updateMatrixWorld(true);
    renderer.render(scene, camera);

    let loadedMeshes = 0;
    let loadedVertices = 0;
    reflector.traverse((o) => {
      if (o.isMesh && o.geometry?.attributes?.position) {
        loadedMeshes++;
        loadedVertices += o.geometry.attributes.position.count;
      }
    });

    const box = new THREE.Box3().setFromObject(reflector);
    const size = new THREE.Vector3();
    box.getSize(size);

    window.__step1Result = {
      loadedFromGlb: '${meta.files.glbUrl}',
      loadedMeshes,
      loadedVertices,
      placedPosition: reflector.position.toArray(),
      initialRotation,
      rotatedEuler: [reflector.rotation.x, reflector.rotation.y, reflector.rotation.z],
      worldBounds: { width: size.x, height: size.y, depth: size.z }
    };
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = req.url.split('?')[0];
    if (urlPath === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    const filePath = path.join(projectRoot, urlPath.replace(/^\/+/, ''));
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === '.js' || ext === '.mjs'
        ? 'application/javascript'
        : ext === '.glb'
          ? 'model/gltf-binary'
          : ext === '.json'
            ? 'application/json'
            : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end(String(err));
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => Boolean(window.__step1Result), { timeout: 15000 });
  const browserResult = await page.evaluate(() => window.__step1Result);

  await mkdir(path.join(projectRoot, 'artifacts', 'verification'), { recursive: true });
  await page.screenshot({
    path: path.join(projectRoot, 'artifacts', 'verification', 'step1-3d-reflector-browser.png'),
  });

  assert.ok(browserResult.loadedMeshes >= 5, 'Browser GLTFLoader loaded >= 5 3D meshes');
  assert.ok(browserResult.loadedVertices >= 120, 'Browser GLTFLoader loaded >= 120 3D vertices');
  assert.deepEqual(browserResult.placedPosition, [0, 1.4, -3.5], 'Reflector placed at target orbital coordinates');
  assert.ok(Math.abs(browserResult.rotatedEuler[1] - 0.42) < 1e-4, 'Reflector rotated in yaw');
  assert.ok(Math.abs(browserResult.rotatedEuler[0] + 0.22) < 1e-4, 'Reflector rotated in pitch');

  const report = {
    verifiedAt: new Date().toISOString(),
    generationMetadata: meta,
    browserLoadAndTransform: browserResult,
    screenshot: 'artifacts/verification/step1-3d-reflector-browser.png',
    status: 'PASS',
  };
  await writeFile(
    path.join(projectRoot, 'artifacts', 'verification', 'step1-3d-verification.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
  console.log('PASS Step 1 Browser GLB Load, Placement & Rotation:', JSON.stringify(browserResult, null, 2));
} finally {
  await browser.close();
  server.close();
}
