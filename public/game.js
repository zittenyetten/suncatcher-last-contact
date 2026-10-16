import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { I18N } from './i18n.js';

const canvas = document.getElementById('orbital-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02050b);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);

// EVA Player State (First-Person + Smooth Focus Camera Transitions)
const WORK_ZONE = {
  minX: -9.2,
  maxX: 9.2,
  minZ: -10.2,
  maxZ: 8.2,
  eyeHeight: 1.75,
};

// Camera Presets so the relationship between Emitter -> Reflector -> Receiver is always clear
const CAM_PRESETS = {
  overview: { pos: new THREE.Vector3(0.1, WORK_ZONE.eyeHeight, 2.35), yaw: 0.01, pitch: -0.04 },
  alignFocus: { pos: new THREE.Vector3(0.35, WORK_ZONE.eyeHeight, 1.15), yaw: -0.06, pitch: -0.03 },
  completeView: { pos: new THREE.Vector3(0.25, WORK_ZONE.eyeHeight, 2.15), yaw: -0.04, pitch: -0.02 },
};

const player = {
  position: CAM_PRESETS.overview.pos.clone(),
  velocityY: 0,
  yaw: CAM_PRESETS.overview.yaw,
  pitch: CAM_PRESETS.overview.pitch,
  isGrounded: true,
  clampedByBoundary: false,
  keys: { w: false, a: false, s: false, d: false },
  alignKeys: { yawLeft: false, yawRight: false, pitchDown: false, pitchUp: false },
  hoverTarget: null,
  camTween: null,
};

camera.position.copy(player.position);

function animateCameraToPreset(presetName, durationSec = 0.65) {
  const target = CAM_PRESETS[presetName] || CAM_PRESETS.overview;
  player.camTween = {
    startPos: player.position.clone(),
    endPos: target.pos.clone(),
    startYaw: player.yaw,
    endYaw: target.yaw,
    startPitch: player.pitch,
    endPitch: target.pitch,
    elapsed: 0,
    duration: durationSec,
  };
}

// Orbital Lighting (650 km Dawn-Dusk Sun-Synchronous Orbit, 06:12 UTC)
const ambientLight = new THREE.AmbientLight(0x4a6fa5, 0.72);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff1d6, 3.4);
sunLight.position.set(110, 48, -55);
scene.add(sunLight);

const deckRimLight = new THREE.DirectionalLight(0x38bdf8, 1.35);
deckRimLight.position.set(-40, 22, 35);
scene.add(deckRimLight);

// Dedicated Hero Spotlight on the Central 3D Reflector Mount
const reflectorKeyLight = new THREE.SpotLight(0xfffbeb, 6.5, 16, Math.PI / 4, 0.45, 1.2);
reflectorKeyLight.position.set(0.2, 4.6, -1.2);
scene.add(reflectorKeyLight);

const reflectorRimLight = new THREE.PointLight(0x38bdf8, 3.2, 8);
reflectorRimLight.position.set(-0.2, 2.3, -5.4);
scene.add(reflectorRimLight);

// Deep Space Starfield
function createStarfield() {
  const count = 2600;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 520 + Math.random() * 420;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xe2f1ff, size: 1.15 });
  const stars = new THREE.Points(geom, mat);
  stars.name = 'OrbitalStarfield';
  scene.add(stars);
}
createStarfield();

// Unified Orbital & Solar System Simulation State (Shared by Out-the-Window 3D Sky, In-Scene Monitor & 3D Orbit Modal)
// 650 km Virtual Sun-Synchronous Orbit Simulation with 120x Demo Time Warp (noticeable motion in 5-10s)
const orbitSim = {
  altitudeKm: 650,
  inclinationDeg: 98.0,
  timeScale: 120,
  simTimeSec: 0,
  orbitAngleRad: 0.72, // Initial station orbital anomaly (radians)
  earthSpinRad: 0.45, // Initial Earth axial rotation (radians)
  moonOrbitAngleRad: 0.58, // Initial Lunar orbital anomaly (radians)
  moonSpinRad: 0.3, // Lunar axial rotation (tidally locked / slow spin)
  sunSpinRad: 0.15, // Solar photosphere rotation
  orbitRateRadPerRealSec: 0.095, // ~5.44 deg/sec at 120x warp (~27 deg in 5s)
  earthSpinRateRadPerRealSec: 0.024, // ~1.38 deg/sec distinct Earth axial rotation
  moonOrbitRateRadPerRealSec: 0.042, // Visible lunar revolution in sky & monitor
  cloudDriftRad: 0,
  orbitViewMode: 'earth', // 'earth' (Earth+Moon+Sun+PiP) | 'solar' (Full 3D Solar System Orrery)
  planets: [
    { key: 'mercury', orbitRadius: 1.05, size: 0.095, speed: 0.19, angle: 0.4, color: 0xcbd5e1, tilt: 0.03 },
    { key: 'venus', orbitRadius: 1.48, size: 0.135, speed: 0.135, angle: 1.65, color: 0xfde68a, tilt: 0.05 },
    { key: 'earth', orbitRadius: 2.02, size: 0.165, speed: 0.095, angle: 2.75, color: 0x38bdf8, tilt: 0.41, hasMoon: true },
    { key: 'mars', orbitRadius: 2.56, size: 0.125, speed: 0.068, angle: 4.05, color: 0xf97316, tilt: 0.44 },
    { key: 'jupiter', orbitRadius: 3.42, size: 0.34, speed: 0.038, angle: 0.88, color: 0xf59e0b, tilt: 0.06, hasMoons: true },
    { key: 'saturn', orbitRadius: 4.38, size: 0.285, speed: 0.026, angle: 5.35, color: 0xfcd34d, tilt: 0.47, hasRings: true },
    { key: 'uranus', orbitRadius: 5.22, size: 0.195, speed: 0.017, angle: 2.15, color: 0x67e8f9, tilt: 1.45, hasThinRing: true },
    { key: 'neptune', orbitRadius: 5.95, size: 0.185, speed: 0.012, angle: 4.65, color: 0x3b82f6, tilt: 0.49 },
  ],
  openCount: 0,
  monitorRenderFrames: 0,
  mainLoopStarted: false,
  renderLoopCount: 0,
};

// Detailed 650 km Earth View (Surface + Night City Lights + Clouds + Atmosphere Rim)
// Driven by orbitSim so the out-the-window Earth visibly revolves and rotates in sync with the Orbit Monitor
function createDetailedEarth() {
  const earthGroup = new THREE.Group();
  earthGroup.name = 'Earth650kmOrbitGroup';
  earthGroup.position.set(0, -156, -142);
  earthGroup.rotation.z = 0.24;

  // Group 1: Station Orbital Revolution relative to Earth (Pitches as Suncatcher travels along its orbit)
  const orbitalTrackPitchGroup = new THREE.Group();
  orbitalTrackPitchGroup.name = 'EarthOrbitalRevolutionGroup';
  earthGroup.add(orbitalTrackPitchGroup);

  // Group 2: Earth's Own Axial Spin around its Polar Axis (Tilted slightly to distinguish from orbital path)
  const earthAxialSpinGroup = new THREE.Group();
  earthAxialSpinGroup.name = 'EarthAxialSpinGroup';
  earthAxialSpinGroup.rotation.z = 0.38;
  orbitalTrackPitchGroup.add(earthAxialSpinGroup);

  // 1. Surface Texture (Full 360° coverage so continents continuously pass below the station)
  const surfCanvas = document.createElement('canvas');
  surfCanvas.width = 1024;
  surfCanvas.height = 512;
  const sctx = surfCanvas.getContext('2d');

  const oceanGrad = sctx.createLinearGradient(0, 0, 1024, 512);
  oceanGrad.addColorStop(0, '#04152d');
  oceanGrad.addColorStop(0.5, '#0a3366');
  oceanGrad.addColorStop(1, '#0e4c8a');
  sctx.fillStyle = oceanGrad;
  sctx.fillRect(0, 0, 1024, 512);

  // Draw distinct landmasses & archipelagos across all longitudes (0..1024) and latitudes (0..512)
  const continents = [
    [95, 135, 130, 88, 0.2],
    [175, 255, 110, 140, -0.15],
    [290, 165, 145, 95, 0.12],
    [355, 345, 95, 82, 0.3],
    [485, 125, 135, 105, -0.1],
    [530, 260, 115, 135, 0.18],
    [685, 145, 185, 125, 0.22],
    [775, 320, 110, 78, -0.2],
    [910, 195, 130, 110, 0.15],
    [965, 355, 85, 70, -0.12],
  ];
  for (const [x, y, w, h, rot] of continents) {
    sctx.fillStyle = '#1b543e';
    sctx.beginPath();
    sctx.ellipse(x, y, w * 0.62, h * 0.52, rot, 0, Math.PI * 2);
    sctx.fill();
    sctx.fillStyle = '#387550';
    sctx.beginPath();
    sctx.ellipse(x + 12, y - 8, w * 0.36, h * 0.32, -rot * 0.7, 0, Math.PI * 2);
    sctx.fill();
    sctx.fillStyle = '#659b6e';
    sctx.beginPath();
    sctx.ellipse(x - 8, y + 6, w * 0.18, h * 0.16, rot, 0, Math.PI * 2);
    sctx.fill();
  }

  // Subtle lat/lon reference grid lines on globe texture so orbital progression is crisp and readable
  sctx.strokeStyle = 'rgba(125, 211, 252, 0.11)';
  sctx.lineWidth = 1.5;
  for (let gx = 64; gx < 1024; gx += 64) {
    sctx.beginPath();
    sctx.moveTo(gx, 0);
    sctx.lineTo(gx, 512);
    sctx.stroke();
  }
  for (let gy = 64; gy < 512; gy += 64) {
    sctx.beginPath();
    sctx.moveTo(0, gy);
    sctx.lineTo(1024, gy);
    sctx.stroke();
  }

  // Dawn-dusk terminator shading
  const termGrad = sctx.createLinearGradient(0, 0, 620, 0);
  termGrad.addColorStop(0, 'rgba(1, 4, 12, 0.86)');
  termGrad.addColorStop(0.62, 'rgba(2, 8, 20, 0.52)');
  termGrad.addColorStop(0.78, 'rgba(255, 150, 55, 0.18)');
  termGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sctx.fillStyle = termGrad;
  sctx.fillRect(0, 0, 620, 512);

  const surfTex = new THREE.CanvasTexture(surfCanvas);
  const surfaceMesh = new THREE.Mesh(
    new THREE.SphereGeometry(180, 72, 72),
    new THREE.MeshStandardMaterial({
      map: surfTex,
      roughness: 0.62,
      metalness: 0.15,
    })
  );
  surfaceMesh.name = 'EarthSurfaceLayer';
  earthAxialSpinGroup.add(surfaceMesh);

  // 2. Night City Lights Layer (Distributed across longitudes so clusters rotate into view)
  const cityCanvas = document.createElement('canvas');
  cityCanvas.width = 1024;
  cityCanvas.height = 512;
  const cctx = cityCanvas.getContext('2d');
  for (let i = 0; i < 520; i++) {
    const cx = (i * 73.1 + (i % 7) * 29) % 1000 + 12;
    const cy = ((i * 41.7 + (i % 5) * 37) % 380) + 65;
    const radius = (i % 3) * 0.75 + 0.9;
    cctx.fillStyle = i % 4 === 0 ? 'rgba(255, 224, 138, 0.95)' : 'rgba(255, 178, 78, 0.78)';
    cctx.beginPath();
    cctx.arc(cx, cy, radius, 0, Math.PI * 2);
    cctx.fill();
  }
  const cityTex = new THREE.CanvasTexture(cityCanvas);
  const cityLightsMesh = new THREE.Mesh(
    new THREE.SphereGeometry(180.35, 64, 64),
    new THREE.MeshBasicMaterial({
      map: cityTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  cityLightsMesh.name = 'EarthNightCityLightsLayer';
  earthAxialSpinGroup.add(cityLightsMesh);

  // 3. Cloud Layer
  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = 1024;
  cloudCanvas.height = 512;
  const clctx = cloudCanvas.getContext('2d');
  for (let i = 0; i < 210; i++) {
    const x = (i * 89.3) % 1024;
    const y = (i * 53.7) % 512;
    const w = 28 + (i % 6) * 14;
    const h = 8 + (i % 4) * 6;
    clctx.fillStyle = 'rgba(235, 246, 255, 0.25)';
    clctx.beginPath();
    clctx.ellipse(x, y, w, h, (i % 5) * 0.1, 0, Math.PI * 2);
    clctx.fill();
  }
  const cloudTex = new THREE.CanvasTexture(cloudCanvas);
  const cloudMesh = new THREE.Mesh(
    new THREE.SphereGeometry(181.6, 64, 64),
    new THREE.MeshStandardMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
    })
  );
  cloudMesh.name = 'EarthCloudLayer';
  earthAxialSpinGroup.add(cloudMesh);

  // 4. Atmospheric Rim Layer
  const atmosphereMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float intensity = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.5);
        vec3 col = mix(vec3(0.22, 0.68, 1.0), vec3(1.0, 0.72, 0.32), 0.22);
        gl_FragColor = vec4(col, clamp(intensity, 0.0, 0.88));
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  const atmosphereMesh = new THREE.Mesh(
    new THREE.SphereGeometry(185.4, 64, 64),
    atmosphereMat
  );
  atmosphereMesh.name = 'EarthAtmosphereLayer';
  earthGroup.add(atmosphereMesh);

  scene.add(earthGroup);
  return {
    earthGroup,
    orbitalTrackPitchGroup,
    earthAxialSpinGroup,
    surfaceMesh,
    cityLightsMesh,
    cloudMesh,
    atmosphereMesh,
    surfTex,
    cityTex,
    cloudTex,
  };
}
const earthLayers = createDetailedEarth();

// ============================================================================
// Out-the-Window 3D Sun, 3D Moon (with Lunar Orbit Ring) & Ecliptic Solar System Vista
// Framed directly above Earth's horizon in the default camera frustum so they are immediately visible!
// ============================================================================
function createCelestialSky() {
  const skyRoot = new THREE.Group();
  skyRoot.name = 'CelestialSolarSystemSkyGroup';
  scene.add(skyRoot);

  // 1. Procedural Solar Photosphere & Corona Textures
  const sunSurfCanvas = document.createElement('canvas');
  sunSurfCanvas.width = 512;
  sunSurfCanvas.height = 256;
  const suCtx = sunSurfCanvas.getContext('2d');
  const sunBaseGrad = suCtx.createLinearGradient(0, 0, 0, 256);
  sunBaseGrad.addColorStop(0, '#fff7ed');
  sunBaseGrad.addColorStop(0.25, '#fef08a');
  sunBaseGrad.addColorStop(0.5, '#fbbf24');
  sunBaseGrad.addColorStop(0.75, '#f59e0b');
  sunBaseGrad.addColorStop(1, '#ea580c');
  suCtx.fillStyle = sunBaseGrad;
  suCtx.fillRect(0, 0, 512, 256);

  // Solar granulation & active flare regions
  for (let i = 0; i < 260; i++) {
    const gx = (i * 67.3) % 512;
    const gy = (i * 43.1) % 256;
    const r = 3 + (i % 5) * 3.5;
    suCtx.fillStyle = i % 3 === 0 ? 'rgba(255, 255, 240, 0.55)' : 'rgba(234, 88, 12, 0.42)';
    suCtx.beginPath();
    suCtx.arc(gx, gy, r, 0, Math.PI * 2);
    suCtx.fill();
  }
  const sunSurfTex = new THREE.CanvasTexture(sunSurfCanvas);

  // Radial Solar Corona / Ray Glow Sprite Texture
  const coronaCanvas = document.createElement('canvas');
  coronaCanvas.width = 512;
  coronaCanvas.height = 512;
  const coCtx = coronaCanvas.getContext('2d');
  const radGrad = coCtx.createRadialGradient(256, 256, 24, 256, 256, 250);
  radGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  radGrad.addColorStop(0.18, 'rgba(254, 240, 138, 0.92)');
  radGrad.addColorStop(0.42, 'rgba(251, 191, 36, 0.48)');
  radGrad.addColorStop(0.72, 'rgba(245, 158, 11, 0.14)');
  radGrad.addColorStop(1, 'rgba(234, 88, 12, 0.0)');
  coCtx.fillStyle = radGrad;
  coCtx.fillRect(0, 0, 512, 512);

  // Subtle solar diffraction rays
  coCtx.save();
  coCtx.translate(256, 256);
  for (let r = 0; r < 12; r++) {
    coCtx.rotate(Math.PI / 6);
    const rayGrad = coCtx.createLinearGradient(0, -6, 240, 6);
    rayGrad.addColorStop(0, 'rgba(255, 251, 235, 0.5)');
    rayGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
    coCtx.fillStyle = rayGrad;
    coCtx.beginPath();
    coCtx.moveTo(0, -5);
    coCtx.lineTo(245, 0);
    coCtx.lineTo(0, 5);
    coCtx.closePath();
    coCtx.fill();
  }
  coCtx.restore();
  const sunCoronaTex = new THREE.CanvasTexture(coronaCanvas);

  // 3D Sun Group in Upper-Left Sky above Earth's horizon: (-56, 36, -146)
  const sunSkyGroup = new THREE.Group();
  sunSkyGroup.name = 'SkySun3DGroup';
  sunSkyGroup.position.set(-56, 36, -146);
  skyRoot.add(sunSkyGroup);

  const sunCoreMesh = new THREE.Mesh(
    new THREE.SphereGeometry(9.6, 48, 48),
    new THREE.MeshBasicMaterial({ map: sunSurfTex })
  );
  sunCoreMesh.name = 'SkySunPhotosphereMesh';
  sunSkyGroup.add(sunCoreMesh);

  const sunChromosphereMesh = new THREE.Mesh(
    new THREE.SphereGeometry(11.4, 40, 40),
    new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.46,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  sunSkyGroup.add(sunChromosphereMesh);

  const sunCoronaSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sunCoronaTex,
      color: 0xfef08a,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  sunCoronaSprite.scale.set(52, 52, 1);
  sunSkyGroup.add(sunCoronaSprite);

  // Align directional sunLight with our visible 3D Sun in the sky!
  sunLight.position.copy(sunSkyGroup.position);

  // 2. Procedural 3D Moon Texture (Lunar Maria + Impact Craters + Regolith Highlights)
  const moonCanvas = document.createElement('canvas');
  moonCanvas.width = 512;
  moonCanvas.height = 256;
  const moCtx = moonCanvas.getContext('2d');
  const moonGrad = moCtx.createLinearGradient(0, 0, 512, 256);
  moonGrad.addColorStop(0, '#cbd5e1');
  moonGrad.addColorStop(0.5, '#e2e8f0');
  moonGrad.addColorStop(1, '#94a3b8');
  moCtx.fillStyle = moonGrad;
  moCtx.fillRect(0, 0, 512, 256);

  // Dark basaltic Lunar Maria (Seas of Tranquility, Imbrium, Serenity, Procellarum)
  const maria = [
    [140, 95, 62, 46, 0.2],
    [225, 115, 54, 42, -0.15],
    [310, 130, 48, 38, 0.1],
    [185, 158, 70, 40, 0.25],
    [390, 105, 45, 34, -0.2],
  ];
  for (const [mx, my, mw, mh, mrot] of maria) {
    moCtx.fillStyle = 'rgba(71, 85, 105, 0.58)';
    moCtx.beginPath();
    moCtx.ellipse(mx, my, mw, mh, mrot, 0, Math.PI * 2);
    moCtx.fill();
  }

  // Distinct Lunar Craters with dark floor & bright ejecta rim
  for (let i = 0; i < 95; i++) {
    const cx = (i * 59.7 + 23) % 490 + 11;
    const cy = (i * 37.3 + 17) % 220 + 18;
    const cr = 2.5 + (i % 6) * 2.4;
    moCtx.fillStyle = 'rgba(51, 65, 85, 0.55)';
    moCtx.beginPath();
    moCtx.arc(cx, cy, cr, 0, Math.PI * 2);
    moCtx.fill();
    moCtx.strokeStyle = 'rgba(248, 250, 252, 0.65)';
    moCtx.lineWidth = 1.2;
    moCtx.beginPath();
    moCtx.arc(cx - 0.6, cy - 0.6, cr, 0, Math.PI * 2);
    moCtx.stroke();
  }
  const moonTex = new THREE.CanvasTexture(moonCanvas);

  // 3D Moon System in Upper-Right Sky above Earth's horizon: (48, 33, -142)
  // Includes an inclined 3D Lunar Orbital Track ring around which the Moon visibly orbits!
  const moonSkyCenterGroup = new THREE.Group();
  moonSkyCenterGroup.name = 'SkyMoonSystemGroup';
  moonSkyCenterGroup.position.set(48, 33, -142);
  moonSkyCenterGroup.rotation.x = 0.42;
  moonSkyCenterGroup.rotation.z = -0.24;
  skyRoot.add(moonSkyCenterGroup);

  const moonSkyOrbitRadius = 11.5;
  const moonOrbitRing = new THREE.Mesh(
    new THREE.TorusGeometry(moonSkyOrbitRadius, 0.14, 12, 96),
    new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.42,
    })
  );
  moonOrbitRing.rotation.x = Math.PI / 2;
  moonSkyCenterGroup.add(moonOrbitRing);

  const moonBodyGroup = new THREE.Group();
  moonBodyGroup.name = 'SkyMoonBodyGroup';
  moonSkyCenterGroup.add(moonBodyGroup);

  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(5.6, 48, 48),
    new THREE.MeshStandardMaterial({
      map: moonTex,
      roughness: 0.72,
      metalness: 0.08,
      emissive: 0x334155,
      emissiveIntensity: 0.38,
    })
  );
  moonMesh.name = 'SkyMoonMesh';
  moonBodyGroup.add(moonMesh);

  const moonGlowHalo = new THREE.Mesh(
    new THREE.SphereGeometry(6.5, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  moonBodyGroup.add(moonGlowHalo);

  // 3. Ecliptic Solar System Sky Arc & Visible 3D Planets (Mercury, Venus, Mars, Jupiter, Saturn+Rings, Uranus, Neptune)
  // Spanning across the sky from the Sun (-56, 36, -146) toward the right horizon so the player sees the Solar System out the window!
  const eclipticGroup = new THREE.Group();
  eclipticGroup.name = 'SkyEclipticSolarSystemGroup';
  skyRoot.add(eclipticGroup);

  // Subtle Ecliptic Plane Guide Curve connecting Sun -> Inner Planets -> Outer Gas Giants
  const eclipticPts = [
    new THREE.Vector3(-56, 36, -146),
    new THREE.Vector3(-34, 38.5, -148),
    new THREE.Vector3(-12, 39.5, -149),
    new THREE.Vector3(14, 38.5, -148),
    new THREE.Vector3(42, 35.5, -146),
    new THREE.Vector3(68, 30.5, -144),
  ];
  const eclipticCurve = new THREE.CatmullRomCurve3(eclipticPts);
  const eclipticTube = new THREE.Mesh(
    new THREE.TubeGeometry(eclipticCurve, 72, 0.09, 8, false),
    new THREE.MeshBasicMaterial({
      color: 0xa78bfa,
      transparent: true,
      opacity: 0.28,
    })
  );
  eclipticGroup.add(eclipticTube);

  // Saturn Ring Texture (shared between sky Saturn & Orbit Monitor Saturn)
  const saturnRingCanvas = document.createElement('canvas');
  saturnRingCanvas.width = 256;
  saturnRingCanvas.height = 64;
  const srCtx = saturnRingCanvas.getContext('2d');
  const ringGrad = srCtx.createLinearGradient(0, 0, 256, 0);
  ringGrad.addColorStop(0.0, 'rgba(254, 240, 138, 0.0)');
  ringGrad.addColorStop(0.15, 'rgba(253, 224, 71, 0.55)');
  ringGrad.addColorStop(0.45, 'rgba(251, 191, 36, 0.92)');
  ringGrad.addColorStop(0.58, 'rgba(15, 23, 42, 0.15)'); // Cassini Division
  ringGrad.addColorStop(0.66, 'rgba(253, 230, 138, 0.85)');
  ringGrad.addColorStop(0.9, 'rgba(217, 119, 6, 0.45)');
  ringGrad.addColorStop(1.0, 'rgba(217, 119, 6, 0.0)');
  srCtx.fillStyle = ringGrad;
  srCtx.fillRect(0, 0, 256, 64);
  const saturnRingTex = new THREE.CanvasTexture(saturnRingCanvas);

  // Jupiter Banded Cloud Texture (shared)
  const jupCanvas = document.createElement('canvas');
  jupCanvas.width = 256;
  jupCanvas.height = 128;
  const jCtx = jupCanvas.getContext('2d');
  const bands = ['#d97706', '#fef3c7', '#b45309', '#fde68a', '#92400e', '#fcd34d', '#78350f'];
  bands.forEach((col, idx) => {
    jCtx.fillStyle = col;
    jCtx.fillRect(0, idx * (128 / bands.length), 256, 128 / bands.length + 2);
  });
  // Great Red Spot
  jCtx.fillStyle = '#dc2626';
  jCtx.beginPath();
  jCtx.ellipse(150, 82, 22, 12, 0.1, 0, Math.PI * 2);
  jCtx.fill();
  const jupTex = new THREE.CanvasTexture(jupCanvas);

  // Sky Planets arrayed along the Ecliptic Arc above the horizon
  const skyPlanetDefs = [
    { key: 'mercury', baseT: 0.16, radius: 1.25, color: 0xcbd5e1, emissive: 0x64748b },
    { key: 'venus', baseT: 0.27, radius: 1.75, color: 0xfef08a, emissive: 0xd97706 },
    { key: 'mars', baseT: 0.41, radius: 1.55, color: 0xf97316, emissive: 0xc2410c },
    { key: 'jupiter', baseT: 0.56, radius: 3.35, color: 0xfbbf24, emissive: 0x92400e, map: jupTex },
    { key: 'saturn', baseT: 0.72, radius: 2.85, color: 0xfde68a, emissive: 0xb45309, hasRings: true },
    { key: 'uranus', baseT: 0.85, radius: 1.85, color: 0x67e8f9, emissive: 0x0891b2, hasThinRing: true },
    { key: 'neptune', baseT: 0.95, radius: 1.75, color: 0x60a5fa, emissive: 0x1d4ed8 },
  ];

  const skyPlanets = [];
  let saturnSkyGroup = null;

  for (const def of skyPlanetDefs) {
    const pGroup = new THREE.Group();
    pGroup.name = `SkyPlanet_${def.key}`;
    const pMesh = new THREE.Mesh(
      new THREE.SphereGeometry(def.radius, 32, 32),
      new THREE.MeshStandardMaterial({
        color: def.color,
        map: def.map || null,
        emissive: def.emissive,
        emissiveIntensity: 0.55,
        roughness: 0.5,
      })
    );
    pGroup.add(pMesh);

    if (def.hasRings) {
      const ringGeom = new THREE.RingGeometry(def.radius * 1.38, def.radius * 2.55, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        map: saturnRingTex,
        color: 0xfef08a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
      });
      const ringMesh = new THREE.Mesh(ringGeom, ringMat);
      ringMesh.rotation.x = Math.PI / 2.6;
      ringMesh.rotation.y = 0.35;
      pGroup.add(ringMesh);
      saturnSkyGroup = pGroup;
    } else if (def.hasThinRing) {
      const uRing = new THREE.Mesh(
        new THREE.RingGeometry(def.radius * 1.35, def.radius * 1.7, 48),
        new THREE.MeshBasicMaterial({
          color: 0xa5f3fc,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.55,
        })
      );
      uRing.rotation.y = 0.4;
      pGroup.add(uRing);
    }

    const pt = eclipticCurve.getPoint(def.baseT);
    pGroup.position.copy(pt);
    eclipticGroup.add(pGroup);
    skyPlanets.push({ ...def, group: pGroup, mesh: pMesh });
  }

  return {
    skyRoot,
    sunSkyGroup,
    sunCoreMesh,
    sunCoronaSprite,
    sunSurfTex,
    sunCoronaTex,
    sunTex: sunSurfTex,
    coronaTex: sunCoronaTex,
    moonSkyCenterGroup,
    moonSkyOrbitRadius,
    moonBodyGroup,
    moonMesh,
    moonTex,
    eclipticGroup,
    eclipticCurve,
    skyPlanets,
    saturnSkyGroup,
    saturnRingTex,
    saturnTex: saturnRingTex,
    jupTex,
    jupiterTex: jupTex,
  };
}
const celestialSky = createCelestialSky();

// ============================================================================
// Cohesive Orbital Optical Relay Deck (Replacing Gray Grid & Test Primitives)
// ============================================================================
const stationGroup = new THREE.Group();
stationGroup.name = 'SuncatcherFacility';
scene.add(stationGroup);

// Key Optical Node Coordinates (Framed so Emitter -> Reflector -> Receiver & Gate read at a glance)
const EMITTER_POS = new THREE.Vector3(-4.1, 1.75, -2.5);
const MOUNT_POS = new THREE.Vector3(-0.25, 1.78, -4.35);
const RECEIVER_POS = new THREE.Vector3(3.75, 1.85, -2.65);
const GATE_POS = new THREE.Vector3(2.15, 0, -6.5);

reflectorKeyLight.target.position.copy(MOUNT_POS);
scene.add(reflectorKeyLight.target);

// Aerospace Anodized Deck Materials
const deckDarkMat = new THREE.MeshStandardMaterial({
  color: 0x0f1726,
  metalness: 0.78,
  roughness: 0.34,
});
const deckPlateMat = new THREE.MeshStandardMaterial({
  color: 0x192538,
  metalness: 0.82,
  roughness: 0.28,
});
const trimMetalMat = new THREE.MeshStandardMaterial({
  color: 0x334863,
  metalness: 0.88,
  roughness: 0.22,
});
const goldAccentMat = new THREE.MeshStandardMaterial({
  color: 0xd99b26,
  metalness: 0.92,
  roughness: 0.18,
});

// Main Octagonal/Segmented Orbital Relay Platform (No GridHelper!)
const mainDeck = new THREE.Mesh(new THREE.CylinderGeometry(10.8, 11.4, 0.45, 8), deckDarkMat);
mainDeck.rotation.y = Math.PI / 8;
mainDeck.position.set(0, -0.23, -2.5);
mainDeck.name = 'EVADeckFloor';
stationGroup.add(mainDeck);

// Raised Precision Optical Work Ring under the Gimbal Mount
const mountDeckRing = new THREE.Mesh(
  new THREE.CylinderGeometry(2.3, 2.55, 0.12, 32),
  deckPlateMat
);
mountDeckRing.position.set(MOUNT_POS.x, 0.05, MOUNT_POS.z);
stationGroup.add(mountDeckRing);

const mountTrimTorus = new THREE.Mesh(
  new THREE.TorusGeometry(2.32, 0.04, 12, 48),
  new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.7,
    metalness: 0.6,
    roughness: 0.2,
  })
);
mountTrimTorus.rotation.x = Math.PI / 2;
mountTrimTorus.position.set(MOUNT_POS.x, 0.11, MOUNT_POS.z);
stationGroup.add(mountTrimTorus);

// Recessed Deck Optical Conduit Strips (Visualizing the V-shaped relay path on the deck floor)
function createDeckConduit(p1, p2, colorHex) {
  const start = new THREE.Vector3(p1.x, 0.03, p1.z);
  const end = new THREE.Vector3(p2.x, 0.03, p2.z);
  const dist = start.distanceTo(end);
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.02, dist),
    new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.55,
      metalness: 0.5,
      roughness: 0.3,
    })
  );
  strip.position.copy(mid);
  strip.lookAt(end);
  stationGroup.add(strip);
  return strip;
}
createDeckConduit(EMITTER_POS, MOUNT_POS, 0xf59e0b);
const receiverDeckConduit = createDeckConduit(MOUNT_POS, RECEIVER_POS, 0x334155);

// Low-Profile Aerospace Safety Curbs & Outboard Solar Array Wings
for (const side of [-1, 1]) {
  const curb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.32, 14), trimMetalMat);
  curb.position.set(side * 9.5, 0.16, -2.5);
  stationGroup.add(curb);

  // Outboard Solar Wing Truss + Photovoltaic Panels
  const solarGroup = new THREE.Group();
  solarGroup.position.set(side * 12.6, 0.6, -4.8);
  solarGroup.rotation.z = side * 0.12;
  solarGroup.rotation.x = 0.22;

  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6.5, 12), trimMetalMat);
  boom.rotation.z = Math.PI / 2;
  boom.position.x = -side * 1.8;
  solarGroup.add(boom);

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.06, 9.2),
    new THREE.MeshStandardMaterial({
      color: 0x0b2545,
      emissive: 0x06162e,
      emissiveIntensity: 0.4,
      metalness: 0.88,
      roughness: 0.18,
    })
  );
  const frame = new THREE.Mesh(new THREE.BoxGeometry(4.75, 0.08, 9.35), goldAccentMat);
  frame.position.y = -0.02;
  solarGroup.add(panel, frame);
  stationGroup.add(solarGroup);
}

// 1. Optical Laser Emitter Assembly (Left: [-4.1, 1.75, -2.5])
const emitterGroup = new THREE.Group();
emitterGroup.name = 'OpticalLaserEmitter';
stationGroup.add(emitterGroup);

const emitterBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.55, 0.72, 0.45, 24),
  deckPlateMat
);
emitterBase.position.set(EMITTER_POS.x, 0.225, EMITTER_POS.z);
const emitterPylon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.26, 0.34, 1.35, 24),
  trimMetalMat
);
emitterPylon.position.set(EMITTER_POS.x, 1.05, EMITTER_POS.z);

// Collimator Barrel aimed directly at MOUNT_POS
const emitterHead = new THREE.Group();
emitterHead.position.copy(EMITTER_POS);
emitterHead.lookAt(MOUNT_POS);

const emitterBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.28, 0.34, 0.95, 24),
  trimMetalMat
);
emitterBarrel.rotation.x = Math.PI / 2;
const emitterGoldRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.29, 0.035, 12, 32),
  goldAccentMat
);
emitterGoldRing.position.z = 0.42;
const emitterLens = new THREE.Mesh(
  new THREE.CircleGeometry(0.24, 32),
  new THREE.MeshBasicMaterial({ color: 0xfef08a })
);
emitterLens.position.z = 0.48;
emitterHead.add(emitterBarrel, emitterGoldRing, emitterLens);

const emitterLight = new THREE.PointLight(0xfbbf24, 2.8, 7);
emitterLight.position.copy(EMITTER_POS);
emitterGroup.add(emitterBase, emitterPylon, emitterHead, emitterLight);

// Low-Profile Optical Conduit Divider (Sits flush with deck between Emitter and Receiver without obscuring the Reflector Pedestal)
const centralBaffle = new THREE.Group();
centralBaffle.name = 'CentralRadiationShieldObstacle';
centralBaffle.position.set(-0.2, 0, -2.55);
const bafflePedestal = new THREE.Mesh(
  new THREE.BoxGeometry(1.1, 0.24, 0.32),
  deckPlateMat
);
bafflePedestal.position.y = 0.12;
const baffleStripe = new THREE.Mesh(
  new THREE.BoxGeometry(1.14, 0.05, 0.34),
  goldAccentMat
);
baffleStripe.position.y = 0.25;
centralBaffle.add(bafflePedestal, baffleStripe);
stationGroup.add(centralBaffle);

// 2. Central Reflector Gimbal Pedestal & Hero Mount ([-0.25, 1.78, -4.35])
const mountPedestalGroup = new THREE.Group();
mountPedestalGroup.position.set(MOUNT_POS.x, 0, MOUNT_POS.z);
stationGroup.add(mountPedestalGroup);

const mountBaseFlange = new THREE.Mesh(
  new THREE.CylinderGeometry(0.68, 0.85, 0.36, 32),
  deckPlateMat
);
mountBaseFlange.position.y = 0.18;
const mountColumn = new THREE.Mesh(
  new THREE.CylinderGeometry(0.28, 0.38, 1.15, 24),
  trimMetalMat
);
mountColumn.position.y = 0.92;
const mountYoke = new THREE.Mesh(
  new THREE.TorusGeometry(0.42, 0.06, 16, 32, Math.PI),
  goldAccentMat
);
mountYoke.rotation.z = Math.PI;
mountYoke.position.y = 1.65;
mountPedestalGroup.add(mountBaseFlange, mountColumn, mountYoke);

// Pivot group where the 3D reflector is mounted and rotated
const reflectorMountPivot = new THREE.Group();
reflectorMountPivot.name = 'ReflectorMountPivot';
reflectorMountPivot.position.copy(MOUNT_POS);
stationGroup.add(reflectorMountPivot);

// Initial Damaged Reflector Assembly (Visibly cracked/tilted unit that scatters the beam off-target until replaced)
function createDamagedInitialReflector() {
  const dmgGroup = new THREE.Group();
  dmgGroup.name = 'DamagedBracketPlaceholder';

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.08, 10, 6),
    new THREE.MeshStandardMaterial({ color: 0x3b2f2f, metalness: 0.7, roughness: 0.65 })
  );
  const crackedPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.82, 0.82, 0.08, 6),
    new THREE.MeshStandardMaterial({
      color: 0x5c4033,
      metalness: 0.65,
      roughness: 0.55,
    })
  );
  crackedPlate.rotation.x = Math.PI / 2;
  crackedPlate.rotation.z = 0.25;

  // Missing/scorched shard gap visual
  const scorchBar = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.14, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x1a1110, roughness: 0.9 })
  );
  scorchBar.rotation.z = -0.45;
  dmgGroup.add(outerRing, crackedPlate, scorchBar);
  return dmgGroup;
}
const damagedPlaceholder = createDamagedInitialReflector();
reflectorMountPivot.add(damagedPlaceholder);

// 3. Target Optical Receiver Aperture Dish (Right: [3.75, 1.85, -2.65])
const receiverGroup = new THREE.Group();
receiverGroup.name = 'TargetOpticalReceiverGroup';
stationGroup.add(receiverGroup);

const receiverBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.58, 0.76, 0.45, 24),
  deckPlateMat
);
receiverBase.position.set(RECEIVER_POS.x, 0.225, RECEIVER_POS.z);
const receiverPylon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.28, 0.36, 1.45, 24),
  trimMetalMat
);
receiverPylon.position.set(RECEIVER_POS.x, 1.1, RECEIVER_POS.z);

const receiverHead = new THREE.Group();
receiverHead.position.copy(RECEIVER_POS);
receiverHead.lookAt(MOUNT_POS);

const receiverDishHousing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.68, 0.42, 0.48, 32),
  deckPlateMat
);
receiverDishHousing.rotation.x = Math.PI / 2;

const receiverRingMat = new THREE.MeshStandardMaterial({
  color: 0xf43f5e,
  emissive: 0xe11d48,
  emissiveIntensity: 2.2,
  metalness: 0.3,
  roughness: 0.2,
});
const receiverOuterRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.66, 0.055, 16, 48),
  receiverRingMat
);
receiverOuterRing.position.z = 0.22;

const receiverSensorMat = new THREE.MeshStandardMaterial({
  color: 0xff2a55,
  emissive: 0xff1e42,
  emissiveIntensity: 2.0,
  metalness: 0.2,
  roughness: 0.15,
});
const receiverSensor = new THREE.Mesh(
  new THREE.CircleGeometry(0.42, 32),
  receiverSensorMat
);
receiverSensor.position.z = 0.25;
receiverSensor.name = 'TargetOpticalReceiverSensor';

receiverHead.add(receiverDishHousing, receiverOuterRing, receiverSensor);

const receiverGlowLight = new THREE.PointLight(0xf43f5e, 2.6, 8);
receiverGlowLight.position.copy(RECEIVER_POS);
receiverGroup.add(receiverBase, receiverPylon, receiverHead, receiverGlowLight);

// 4. Station Airlock Gate Bulkhead ([2.15, 0, -6.5]) — Hollow Archway that Reveals Glowing Interior Bay when Opened!
const gateGroup = new THREE.Group();
gateGroup.position.copy(GATE_POS);
gateGroup.rotation.y = -0.18;
stationGroup.add(gateGroup);

const doorFrame = new THREE.Group();
const frameLeftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.5, 0.68), deckDarkMat);
frameLeftPillar.position.set(-1.95, 1.75, 0);
const frameRightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.5, 0.68), deckDarkMat);
frameRightPillar.position.set(1.95, 1.75, 0);
const frameTopLintel = new THREE.Mesh(new THREE.BoxGeometry(4.35, 0.48, 0.72), deckDarkMat);
frameTopLintel.position.set(0, 3.26, 0);
const frameThreshold = new THREE.Mesh(new THREE.BoxGeometry(4.35, 0.16, 0.76), goldAccentMat);
frameThreshold.position.set(0, 0.08, 0);
doorFrame.add(frameLeftPillar, frameRightPillar, frameTopLintel, frameThreshold);

// Illuminated Interior Bay behind the Gate (Clearly revealed when the doors slide open!)
const interiorBayBox = new THREE.Mesh(
  new THREE.BoxGeometry(3.5, 3.0, 2.2),
  new THREE.MeshStandardMaterial({
    color: 0x052e24,
    emissive: 0x059669,
    emissiveIntensity: 0.65,
    roughness: 0.35,
    side: THREE.BackSide,
  })
);
interiorBayBox.position.set(0, 1.6, -1.05);

const interiorBayCore = new THREE.Mesh(
  new THREE.PlaneGeometry(3.35, 2.85),
  new THREE.MeshBasicMaterial({
    color: 0x34d399,
    transparent: true,
    opacity: 0.22,
  })
);
interiorBayCore.position.set(0, 1.6, -0.35);

const interiorBayLight = new THREE.PointLight(0x10b981, 0.0, 14);
interiorBayLight.position.set(0, 1.85, 0.4);

const doorSeamMat = new THREE.MeshStandardMaterial({
  color: 0xf59e0b,
  emissive: 0xd97706,
  emissiveIntensity: 0.9,
});

const leftDoorPanel = new THREE.Group();
leftDoorPanel.position.set(-0.96, 1.55, 0.05);
const leftDoorBody = new THREE.Mesh(new THREE.BoxGeometry(1.72, 2.92, 0.24), trimMetalMat);
const leftDoorSeam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.8, 0.28), doorSeamMat);
leftDoorSeam.position.x = 0.82;
leftDoorPanel.add(leftDoorBody, leftDoorSeam);

const rightDoorPanel = new THREE.Group();
rightDoorPanel.position.set(0.96, 1.55, 0.05);
const rightDoorBody = new THREE.Mesh(new THREE.BoxGeometry(1.72, 2.92, 0.24), trimMetalMat);
const rightDoorSeam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.8, 0.28), doorSeamMat);
rightDoorSeam.position.x = -0.82;
rightDoorPanel.add(rightDoorBody, rightDoorSeam);

const doorBeaconMat = new THREE.MeshStandardMaterial({
  color: 0xf43f5e,
  emissive: 0xe11d48,
  emissiveIntensity: 2.2,
});
const doorBeacon = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.22, 0.78), doorBeaconMat);
doorBeacon.position.set(0, 3.42, 0.05);

gateGroup.add(
  interiorBayBox,
  interiorBayCore,
  interiorBayLight,
  doorFrame,
  leftDoorPanel,
  rightDoorPanel,
  doorBeacon
);

// Companion AI Argon Holographic Drone (Hovering cleanly above the left optical path)
const argonDrone = new THREE.Group();
argonDrone.name = 'ArgonCompanionDrone';
argonDrone.position.set(-2.95, 2.45, -2.15);
const argonCore = new THREE.Mesh(
  new THREE.OctahedronGeometry(0.24, 1),
  new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 1.6,
    metalness: 0.3,
    roughness: 0.1,
  })
);
const argonRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.36, 0.025, 16, 48),
  new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xd97706,
    emissiveIntensity: 1.0,
  })
);
argonDrone.add(argonCore, argonRing);
stationGroup.add(argonDrone);

// 5. Interactive In-Scene Station Orbit Monitor ([-2.18, 1.12, -3.55])
// Placed in clear view from default camera without blocking the Emitter -> Reflector -> Receiver beam triangle
const ORBIT_MONITOR_POS = new THREE.Vector3(-2.18, 1.12, -3.55);
const orbitMonitorGroup = new THREE.Group();
orbitMonitorGroup.name = 'StationOrbitMonitorConsole';
stationGroup.add(orbitMonitorGroup);

const monitorStandBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.32, 0.42, 0.14, 24),
  deckPlateMat
);
monitorStandBase.position.set(ORBIT_MONITOR_POS.x, 0.07, ORBIT_MONITOR_POS.z);

const monitorStandPost = new THREE.Mesh(
  new THREE.CylinderGeometry(0.08, 0.11, 0.92, 16),
  trimMetalMat
);
monitorStandPost.position.set(ORBIT_MONITOR_POS.x, 0.54, ORBIT_MONITOR_POS.z);

const monitorHeadGroup = new THREE.Group();
monitorHeadGroup.position.copy(ORBIT_MONITOR_POS);
monitorHeadGroup.lookAt(new THREE.Vector3(0.1, 1.58, 2.35));

const monitorHousing = new THREE.Mesh(
  new THREE.BoxGeometry(1.18, 0.76, 0.1),
  deckDarkMat
);

const monitorBezelMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 1.1,
  metalness: 0.65,
  roughness: 0.2,
});
const monitorBezelFrame = new THREE.Mesh(
  new THREE.BoxGeometry(1.24, 0.82, 0.06),
  monitorBezelMat
);
monitorBezelFrame.position.z = -0.01;

// Dynamic 2D Canvas Screen on the 3D Station Monitor ("🌍 궤도 보기" + Earth + Live Orbit Dot)
const monitorScreenCanvas = document.createElement('canvas');
monitorScreenCanvas.width = 512;
monitorScreenCanvas.height = 320;
const mctx = monitorScreenCanvas.getContext('2d');
const monitorScreenTex = new THREE.CanvasTexture(monitorScreenCanvas);

const monitorScreenMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(1.08, 0.66),
  new THREE.MeshBasicMaterial({ map: monitorScreenTex })
);
monitorScreenMesh.position.z = 0.056;
monitorScreenMesh.name = 'StationOrbitMonitorScreen';

const monitorGlowLight = new THREE.PointLight(0x38bdf8, 1.35, 3.8);
monitorGlowLight.position.set(0, 0.05, 0.35);

monitorHeadGroup.add(monitorBezelFrame, monitorHousing, monitorScreenMesh, monitorGlowLight);
orbitMonitorGroup.add(monitorStandBase, monitorStandPost, monitorHeadGroup);

function updateInSceneMonitorScreen(hovered = false) {
  const isEn = typeof gameState !== 'undefined' && gameState.lang === 'en';
  mctx.fillStyle = hovered ? '#071b34' : '#041022';
  mctx.fillRect(0, 0, 512, 320);

  // Border glow inside screen
  mctx.strokeStyle = hovered ? '#7dd3fc' : 'rgba(56, 189, 248, 0.55)';
  mctx.lineWidth = hovered ? 6 : 3;
  mctx.strokeRect(8, 8, 496, 304);

  // 1. Glowing Sun icon in top-left corner of the monitor screen
  const sunX = 48;
  const sunY = 52;
  const sunGlow = mctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 34);
  sunGlow.addColorStop(0, '#ffffff');
  sunGlow.addColorStop(0.3, '#fef08a');
  sunGlow.addColorStop(0.65, 'rgba(251, 191, 36, 0.45)');
  sunGlow.addColorStop(1, 'rgba(245, 158, 11, 0)');
  mctx.fillStyle = sunGlow;
  mctx.beginPath();
  mctx.arc(sunX, sunY, 34, 0, Math.PI * 2);
  mctx.fill();

  // Stylized Earth Icon & Orbit Ring on the left side of the monitor screen
  const cx = 148;
  const cy = 166;
  const earthR = 56;

  // Outer Lunar Orbit Ellipse & Moving Moon Dot
  mctx.save();
  mctx.translate(cx, cy);
  mctx.rotate(0.18);
  mctx.strokeStyle = 'rgba(203, 213, 225, 0.42)';
  mctx.setLineDash([4, 4]);
  mctx.lineWidth = 1.8;
  mctx.beginPath();
  mctx.ellipse(0, 0, 116, 68, 0, 0, Math.PI * 2);
  mctx.stroke();
  mctx.setLineDash([]);

  const moonX = Math.cos(orbitSim.moonOrbitAngleRad) * 116;
  const moonY = Math.sin(orbitSim.moonOrbitAngleRad) * 68;
  mctx.fillStyle = '#e2e8f0';
  mctx.beginPath();
  mctx.arc(moonX, moonY, 9.5, 0, Math.PI * 2);
  mctx.fill();
  mctx.fillStyle = '#64748b';
  mctx.beginPath();
  mctx.arc(moonX - 2, moonY - 1, 2.5, 0, Math.PI * 2);
  mctx.fill();
  mctx.restore();

  const grad = mctx.createRadialGradient(cx - 16, cy - 16, 8, cx, cy, earthR);
  grad.addColorStop(0, '#38bdf8');
  grad.addColorStop(0.55, '#0284c7');
  grad.addColorStop(1, '#082f49');
  mctx.fillStyle = grad;
  mctx.beginPath();
  mctx.arc(cx, cy, earthR, 0, Math.PI * 2);
  mctx.fill();

  // Simplified green continents on monitor icon
  mctx.fillStyle = 'rgba(52, 211, 153, 0.55)';
  mctx.beginPath();
  mctx.ellipse(
    cx - 12 + Math.sin(orbitSim.earthSpinRad) * 14,
    cy - 10,
    20,
    12,
    0.3,
    0,
    Math.PI * 2
  );
  mctx.fill();
  mctx.beginPath();
  mctx.ellipse(
    cx + 16 - Math.cos(orbitSim.earthSpinRad) * 12,
    cy + 14,
    16,
    10,
    -0.25,
    0,
    Math.PI * 2
  );
  mctx.fill();

  // Inclined Orbit Ellipse around Earth icon + Green Ground-Station Pass Window Arc
  mctx.save();
  mctx.translate(cx, cy);
  mctx.rotate(-0.38);
  mctx.strokeStyle = '#38bdf8';
  mctx.lineWidth = 3.5;
  mctx.beginPath();
  mctx.ellipse(0, 0, 86, 38, 0, 0, Math.PI * 2);
  mctx.stroke();

  // Green Ground Station Pass Window Arc (1.05 rad -> 1.95 rad)
  mctx.strokeStyle = gameState?.inPassWindow ? '#34d399' : '#10b981';
  mctx.lineWidth = 7.0;
  mctx.beginPath();
  mctx.ellipse(0, 0, 86, 38, 0, 1.05, 1.95);
  mctx.stroke();

  // Ground Station Marker on Pass Window Midpoint
  const gsx = Math.cos(1.50) * 62;
  const gsy = Math.sin(1.50) * 28;
  mctx.fillStyle = '#10b981';
  mctx.beginPath();
  mctx.arc(gsx, gsy, 5.5, 0, Math.PI * 2);
  mctx.fill();

  // Moving Suncatcher Marker Dot on the monitor's mini orbit
  const mx = Math.cos(orbitSim.orbitAngleRad) * 86;
  const my = Math.sin(orbitSim.orbitAngleRad) * 38;
  mctx.fillStyle = '#fbbf24';
  mctx.beginPath();
  mctx.arc(mx, my, 8, 0, Math.PI * 2);
  mctx.fill();
  mctx.strokeStyle = '#ffffff';
  mctx.lineWidth = 2.5;
  mctx.stroke();
  mctx.restore();

  // Right-side Call-to-Action Text ("궤도 보기" / "Orbit View" + Pass Window indicator)
  mctx.fillStyle = '#7dd3fc';
  mctx.font = 'bold 19px "Segoe UI", sans-serif';
  mctx.fillText('SUNCATCHER · 650 KM', 260, 96);

  mctx.fillStyle = '#ffffff';
  mctx.font = 'bold 40px "Segoe UI", "Malgun Gothic", sans-serif';
  mctx.fillText(isEn ? '🌍 Orbit View' : '🌍 궤도 보기', 256, 150);

  mctx.fillStyle = gameState?.inPassWindow ? '#6ee7b7' : '#fde68a';
  mctx.font = 'bold 19px "Segoe UI", "Malgun Gothic", sans-serif';
  mctx.fillText(
    gameState?.inPassWindow
      ? isEn
        ? '📡 IN PASS WINDOW (TX READY)'
        : '📡 지상국 교신 구간 진입!'
      : isEn
        ? '📡 Ground Station Pass Track'
        : '📡 지상국 교신 궤도 구간 표시',
    258,
    192
  );

  mctx.fillStyle = hovered ? '#fde047' : '#bae6fd';
  mctx.font = 'bold 21px "Segoe UI", "Malgun Gothic", sans-serif';
  mctx.fillText(
    isEn ? '▶ Click to Open (120×)' : '▶ 클릭하여 열기 (120×)',
    260,
    236
  );

  monitorScreenTex.needsUpdate = true;
}

// ============================================================================
// Volumetric-Style 3D Laser Beams + Animated Photon Pulses + Target Guide Path
// ============================================================================
function createVolumetricBeam(coreColorHex, haloColorHex, coreRadius = 0.042, haloRadius = 0.13) {
  const group = new THREE.Group();
  const coreGeom = new THREE.CylinderGeometry(coreRadius, coreRadius, 1, 16, 1, false);
  coreGeom.translate(0, 0.5, 0);
  coreGeom.rotateX(Math.PI / 2);
  const coreMat = new THREE.MeshBasicMaterial({ color: coreColorHex });
  const coreMesh = new THREE.Mesh(coreGeom, coreMat);

  const haloGeom = new THREE.CylinderGeometry(haloRadius, haloRadius, 1, 16, 1, false);
  haloGeom.translate(0, 0.5, 0);
  haloGeom.rotateX(Math.PI / 2);
  const haloMat = new THREE.MeshBasicMaterial({
    color: haloColorHex,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const haloMesh = new THREE.Mesh(haloGeom, haloMat);

  const pulses = [];
  for (let i = 0; i < 4; i++) {
    const pMesh = new THREE.Mesh(
      new THREE.SphereGeometry(coreRadius * 2.1, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    pulses.push(pMesh);
    group.add(pMesh);
  }

  group.add(coreMesh, haloMesh);
  return { group, coreMesh, haloMesh, coreMat, haloMat, pulses, start: new THREE.Vector3(), end: new THREE.Vector3() };
}

function setVolumetricBeamSegment(beamObj, p1, p2) {
  beamObj.start.copy(p1);
  beamObj.end.copy(p2);
  const dist = Math.max(0.01, p1.distanceTo(p2));
  beamObj.coreMesh.position.copy(p1);
  beamObj.coreMesh.lookAt(p2);
  beamObj.coreMesh.scale.set(1, 1, dist);

  beamObj.haloMesh.position.copy(p1);
  beamObj.haloMesh.lookAt(p2);
  beamObj.haloMesh.scale.set(1, 1, dist);
}

// 1. Incoming Beam: Emitter -> Central Reflector Mount
const incidentBeam = createVolumetricBeam(0xfef08a, 0xf59e0b, 0.045, 0.14);
scene.add(incidentBeam.group);
setVolumetricBeamSegment(incidentBeam, EMITTER_POS, MOUNT_POS);

// 2. Reflected Beam: Central Reflector Mount -> Reflected Direction (or Locked Receiver)
const reflectedBeam = createVolumetricBeam(0xfde047, 0xf59e0b, 0.045, 0.15);
scene.add(reflectedBeam.group);

// 3. Subtle Target Guide Path (Mount -> Receiver) so the player always sees the ideal beam path
const guidePoints = [];
for (let i = 0; i <= 16; i++) {
  guidePoints.push(new THREE.Vector3().lerpVectors(MOUNT_POS, RECEIVER_POS, i / 16));
}
const guideGeom = new THREE.BufferGeometry().setFromPoints(guidePoints);
const guideMat = new THREE.PointsMaterial({
  color: 0xf43f5e,
  size: 0.085,
  transparent: true,
  opacity: 0.55,
});
const targetGuideDots = new THREE.Points(guideGeom, guideMat);
scene.add(targetGuideDots);

// Exact Optical Reflection Target Angle Calculation
const incidentDir = new THREE.Vector3().subVectors(MOUNT_POS, EMITTER_POS).normalize();
const targetOutDir = new THREE.Vector3().subVectors(RECEIVER_POS, MOUNT_POS).normalize();
const idealNormal = new THREE.Vector3()
  .addVectors(targetOutDir, incidentDir.clone().negate())
  .normalize();
const TARGET_YAW_RAD = Math.atan2(idealNormal.x, idealNormal.z);
const TARGET_PITCH_RAD = -Math.asin(idealNormal.y);

// Game & Puzzle State
const gameState = {
  sessionId: null,
  lang: 'en',
  activeDesignVersion: 1,
  designConfirmed: false,
  approvedDesignVersion: null,
  designPreview: null,
  designDrawerOpen: false,
  orbitMonitorOpen: false,
  activeReflectorMeta: null,
  loadedReflectorObject: null,
  reflectorMounted: false,
  mountedYawRad: -0.35, // Starts deliberately unaligned
  mountedPitchRad: -0.2,
  beamAngleErrorDeg: null,
  receiverAligned: false,
  receiverColorHex: '#ff2a55',
  commsRestored: false,
  doorOpened: false,
  doorOpenProgress: 0,
  bgmPlaying: false,
  bgmVolume: 0.42,
  bgmDucked: false,
  bgmPlaylistMode: true,
  bgmAutoPrefetch: true,
  argonSpeaking: false,
  lyriaModalOpen: false,
  lyriaGenerating: false,
  lyriaPrefetching: false,
  lyriaModel: 'lyria-3-clip-preview',
  lyriaAudioDataUrl: null,
  lyriaAudioUrl: '/audio/lyria-bgm-latest.mp3',
  lyriaLyricsText: '<instrumental>',
  lyriaPlaylist: [],
  lyriaCurrentTrackIndex: 0,
  lyriaPromptPool: [],
  autoPlayActive: false,
  reviewingAlignAfterComplete: false,
  lastRetryAction: null,
};

// Seamless Session Identification
const rawFetch = window.fetch;
window.fetch = function (url, options = {}) {
  const opts = { ...options };
  opts.headers = { ...(opts.headers || {}) };
  if (gameState.sessionId && !opts.headers['x-session-id'] && !opts.headers['X-Session-Id']) {
    opts.headers['X-Session-Id'] = gameState.sessionId;
  }
  return rawFetch.call(this, url, opts);
};

// Audio / BGM (Gemini Lyria Multi-Track Playlist with Auto-Advance, Background Random Gen & Speech Ducking)
const bgmAudio = new Audio('/audio/lyria-bgm-latest.mp3');
bgmAudio.loop = !gameState.bgmPlaylistMode;
bgmAudio.volume = 0.42;
bgmAudio.addEventListener(
  'error',
  () => {
    if (!bgmAudio.src.endsWith('/audio/orbital-dawn-bgm.wav')) {
      bgmAudio.src = '/audio/orbital-dawn-bgm.wav';
    }
  },
  { once: true }
);

bgmAudio.addEventListener('ended', () => {
  if (gameState.bgmPlaylistMode) {
    void advanceToNextPlaylistTrack(true);
  } else {
    bgmAudio.currentTime = 0;
    void bgmAudio.play().catch(() => {});
  }
});

function setBgmDucked(ducked) {
  gameState.bgmDucked = Boolean(ducked);
  gameState.argonSpeaking = Boolean(ducked);
  bgmAudio.volume = ducked ? 0.08 : 0.42;
  gameState.bgmVolume = bgmAudio.volume;
  updateHudTranslations();
}

async function ensureBgmPlaying() {
  bgmAudio.loop = !gameState.bgmPlaylistMode;
  if (!gameState.bgmPlaying) {
    try {
      await bgmAudio.play();
      gameState.bgmPlaying = true;
    } catch {
      gameState.bgmPlaying = true;
    }
    updateHudTranslations();
  }
}

// Compute 3D Optical Reflection & Synchronize Beam + Receiver + Gate State
function updateOpticalPuzzle() {
  // Even before the new 3D reflector is mounted, show the damaged bracket's scattered off-target beam!
  if (!gameState.reflectorMounted || !gameState.loadedReflectorObject) {
    reflectorMountPivot.rotation.set(-0.22, -0.42, 0.15, 'YXZ');
    const scatteredEnd = MOUNT_POS.clone().add(new THREE.Vector3(1.6, 2.2, -2.5));
    reflectedBeam.group.visible = true;
    reflectedBeam.coreMat.color.setHex(0xf97316);
    reflectedBeam.haloMat.color.setHex(0xea580c);
    reflectedBeam.haloMat.opacity = 0.18;
    setVolumetricBeamSegment(reflectedBeam, MOUNT_POS, scatteredEnd);
    targetGuideDots.visible = true;
    guideMat.color.setHex(0xf43f5e);
    gameState.beamAngleErrorDeg = null;
    gameState.receiverAligned = false;
    return;
  }

  reflectorMountPivot.rotation.order = 'YXZ';
  reflectorMountPivot.rotation.y = gameState.mountedYawRad;
  reflectorMountPivot.rotation.x = gameState.mountedPitchRad;
  reflectorMountPivot.rotation.z = 0;
  reflectorMountPivot.updateMatrixWorld(true);

  const euler = new THREE.Euler(
    gameState.mountedPitchRad,
    gameState.mountedYawRad,
    0,
    'YXZ'
  );
  const worldNormal = new THREE.Vector3(0, 0, 1).applyEuler(euler).normalize();

  const dotIN = incidentDir.dot(worldNormal);
  const reflectedDir = incidentDir
    .clone()
    .sub(worldNormal.clone().multiplyScalar(2 * dotIN))
    .normalize();

  const cosAngle = Math.max(-1, Math.min(1, reflectedDir.dot(targetOutDir)));
  const angleErrorDeg = (Math.acos(cosAngle) * 180) / Math.PI;
  gameState.beamAngleErrorDeg = Number(angleErrorDeg.toFixed(2));

  const aligned = angleErrorDeg <= 2.8;
  const distToReceiver = MOUNT_POS.distanceTo(RECEIVER_POS);
  const beamEnd = aligned
    ? RECEIVER_POS.clone()
    : MOUNT_POS.clone().add(reflectedDir.clone().multiplyScalar(distToReceiver + 1.2));

  reflectedBeam.group.visible = true;
  reflectedBeam.haloMat.opacity = aligned ? 0.52 : 0.34;

  // Smooth proximity feedback as the player gets closer to the receiver
  if (aligned) {
    reflectedBeam.coreMat.color.setHex(0xa7f3d0);
    reflectedBeam.haloMat.color.setHex(0x10b981);
    incidentBeam.coreMat.color.setHex(0xd1fae5);
    incidentBeam.haloMat.color.setHex(0x10b981);
    targetGuideDots.visible = false;
    receiverDeckConduit.material.color.setHex(0x10b981);
    receiverDeckConduit.material.emissive.setHex(0x10b981);
  } else if (angleErrorDeg < 10) {
    reflectedBeam.coreMat.color.setHex(0xfef08a);
    reflectedBeam.haloMat.color.setHex(0x38bdf8);
    incidentBeam.coreMat.color.setHex(0xfef08a);
    incidentBeam.haloMat.color.setHex(0xf59e0b);
    targetGuideDots.visible = true;
    guideMat.color.setHex(0xfbbf24);
    receiverDeckConduit.material.color.setHex(0xf59e0b);
    receiverDeckConduit.material.emissive.setHex(0xd97706);
  } else {
    reflectedBeam.coreMat.color.setHex(0xfde047);
    reflectedBeam.haloMat.color.setHex(0xf59e0b);
    incidentBeam.coreMat.color.setHex(0xfef08a);
    incidentBeam.haloMat.color.setHex(0xf59e0b);
    targetGuideDots.visible = true;
    guideMat.color.setHex(0xf43f5e);
    receiverDeckConduit.material.color.setHex(0x334155);
    receiverDeckConduit.material.emissive.setHex(0x1e293b);
  }

  setVolumetricBeamSegment(reflectedBeam, MOUNT_POS, beamEnd);

  if (aligned) {
    const wasAligned = gameState.receiverAligned;
    gameState.receiverAligned = true;
    gameState.commsRestored = true;
    gameState.doorOpened = true;
    gameState.receiverColorHex = '#06d6a0';
    receiverSensorMat.color.setHex(0x06d6a0);
    receiverSensorMat.emissive.setHex(0x10b981);
    receiverRingMat.color.setHex(0x10b981);
    receiverRingMat.emissive.setHex(0x059669);
    receiverGlowLight.color.setHex(0x10b981);
    receiverGlowLight.intensity = 4.5;
    doorBeaconMat.color.setHex(0x10b981);
    doorBeaconMat.emissive.setHex(0x059669);
    interiorBayCore.material.opacity = 0.72;
    interiorBayLight.intensity = 4.2;

    if (!wasAligned) {
      gameState.reviewingAlignAfterComplete = false;
      animateCameraToPreset('completeView', 0.8);
      void fetch('/api/mission/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reflectorMounted: true,
          receiverAligned: true,
          commsRestored: true,
          doorOpened: true,
          beamErrorDeg: gameState.beamAngleErrorDeg,
          mountedPitchRad: gameState.mountedPitchRad,
          mountedYawRad: gameState.mountedYawRad,
        }),
      });
    }
  } else {
    gameState.receiverAligned = false;
    gameState.commsRestored = false;
    gameState.doorOpened = false;
    gameState.doorOpenProgress = 0;
    leftDoorPanel.position.x = -0.96;
    rightDoorPanel.position.x = 0.96;
    gameState.receiverColorHex = '#ff2a55';
    receiverSensorMat.color.setHex(0xff2a55);
    receiverSensorMat.emissive.setHex(0xff1e42);
    receiverRingMat.color.setHex(0xf43f5e);
    receiverRingMat.emissive.setHex(0xe11d48);
    receiverGlowLight.color.setHex(0xf43f5e);
    receiverGlowLight.intensity = 2.4;
    doorBeaconMat.color.setHex(0xf43f5e);
    doorBeaconMat.emissive.setHex(0xe11d48);
    interiorBayCore.material.opacity = 0.15;
    interiorBayLight.intensity = 0.0;
  }

  updateAngleReadout();
  updateHudTranslations();
}

function updateAngleReadout() {
  const yawDeg = ((gameState.mountedYawRad * 180) / Math.PI).toFixed(1);
  const pitchDeg = ((gameState.mountedPitchRad * 180) / Math.PI).toFixed(1);
  const errEl = document.getElementById('ui-beam-error');
  const fillEl = document.getElementById('beam-progress-fill');
  const pillEl = document.getElementById('align-status-pill');
  const t = I18N[gameState.lang];

  if (errEl) {
    errEl.textContent =
      gameState.beamAngleErrorDeg !== null ? `${gameState.beamAngleErrorDeg.toFixed(1)}°` : '--°';
    errEl.style.color = gameState.receiverAligned ? '#6ee7b7' : '#fde68a';
  }

  if (fillEl) {
    const err = gameState.beamAngleErrorDeg ?? 30;
    const pct = gameState.receiverAligned
      ? 100
      : Math.max(8, Math.min(96, 100 - (err / 32) * 100));
    fillEl.style.width = `${pct}%`;
  }

  if (pillEl) {
    pillEl.textContent = gameState.receiverAligned
      ? t.stageCards.beamLockedBadge
      : t.stageCards.beamSearchingBadge;
    pillEl.className = `badge ${gameState.receiverAligned ? 'badge-ok' : 'badge-warn'}`;
  }

  const yawValEl = document.getElementById('yaw-val-text');
  const pitchValEl = document.getElementById('pitch-val-text');
  if (yawValEl) yawValEl.textContent = `${yawDeg}°`;
  if (pitchValEl) pitchValEl.textContent = `${pitchDeg}°`;

  const yawSlider = document.getElementById('yaw-slider');
  const pitchSlider = document.getElementById('pitch-slider');
  if (yawSlider) yawSlider.value = String(gameState.mountedYawRad);
  if (pitchSlider) pitchSlider.value = String(gameState.mountedPitchRad);
}

// Load Generated 3D Reflector (.glb) into Browser via GLTFLoader
const gltfLoader = new GLTFLoader();

async function loadGeneratedReflectorGLB(reflectorMeta) {
  const gltf = await gltfLoader.loadAsync(reflectorMeta.files.glbUrl);
  const model = gltf.scene;
  model.name = `Reflector3D_${reflectorMeta.requestId}`;

  // Scale up to 1.45x so the generated 3D reflector is prominent and heroic in the scene
  model.scale.setScalar(1.45);

  model.traverse((child) => {
    if (child.isMesh && child.material) {
      child.material.envMapIntensity = 2.6;
      child.material.needsUpdate = true;
    }
  });

  gameState.activeReflectorMeta = reflectorMeta;
  gameState.loadedReflectorObject = model;

  const m = reflectorMeta.metrics;
  const metricsEl = document.getElementById('reflector-3d-metrics');
  if (metricsEl) {
    metricsEl.innerHTML =
      `<strong>3D GLB:</strong> ${reflectorMeta.requestId} (v${reflectorMeta.approvedDesignVersion})<br/>` +
      `Meshes: ${m.meshCount} · Vertices: ${m.vertexCount} · Triangles: ${m.triangleCount}<br/>` +
      `Size: ${m.boundingBox.width}×${m.boundingBox.height}×${m.boundingBox.depth}m · Hash: ${m.geometryHash}`;
  }

  updateHudTranslations();
  return model;
}

function mountActiveReflectorOnPedestal() {
  if (!gameState.loadedReflectorObject) return false;
  while (reflectorMountPivot.children.length > 0) {
    reflectorMountPivot.remove(reflectorMountPivot.children[0]);
  }
  reflectorMountPivot.add(gameState.loadedReflectorObject);
  gameState.reflectorMounted = true;
  gameState.designDrawerOpen = false;
  animateCameraToPreset('alignFocus', 0.7);
  updateOpticalPuzzle();
  return true;
}

// UI Error Alert Helper
function showAlert(message, retryFn = null) {
  const banner = document.getElementById('error-banner');
  const txt = document.getElementById('error-message-text');
  const retryBtn = document.getElementById('error-retry-btn');
  if (!banner || !txt) return;
  txt.textContent = message;
  gameState.lastRetryAction = retryFn;
  if (retryBtn) retryBtn.style.display = retryFn ? 'inline-flex' : 'none';
  banner.style.display = 'block';
}

function hideAlert() {
  const banner = document.getElementById('error-banner');
  if (banner) banner.style.display = 'none';
  gameState.lastRetryAction = null;
}

// Argon Subtitle & Chat Log
function appendDialogueMessage(sender, text) {
  const log = document.getElementById('dialogue-log');
  if (log) {
    const div = document.createElement('div');
    div.className = sender === 'argon' ? 'msg-argon' : 'msg-user';
    div.textContent = `${sender === 'argon' ? '🤖 ARGON' : '🧑‍🚀 EVA'}: ${text}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
  if (sender === 'argon') {
    const sub = document.getElementById('argon-subtitle-text');
    if (sub) sub.textContent = text;
  }
}

function speakArgonText(text, lang = gameState.lang) {
  setBgmDucked(true);
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang === 'en' ? 'en-US' : 'ko-KR';
      utter.rate = 1.05;
      utter.onend = () => setBgmDucked(false);
      utter.onerror = () => setBgmDucked(false);
      window.speechSynthesis.speak(utter);
      setTimeout(() => setBgmDucked(false), 3200);
      return;
    } catch {
      // Fallback below
    }
  }
  setTimeout(() => setBgmDucked(false), 2500);
}

// Determine Active UI Stage ('design' | 'generate' | 'mount' | 'align' | 'completed')
function getCurrentUiStage() {
  if (
    gameState.receiverAligned &&
    gameState.commsRestored &&
    gameState.doorOpened &&
    !gameState.reviewingAlignAfterComplete
  ) {
    return 'completed';
  }
  if (gameState.reflectorMounted && gameState.loadedReflectorObject) {
    return 'align';
  }
  if (
    gameState.loadedReflectorObject &&
    gameState.activeReflectorMeta?.approvedDesignVersion === gameState.approvedDesignVersion &&
    gameState.designConfirmed
  ) {
    return 'mount';
  }
  if (gameState.designConfirmed) {
    return 'generate';
  }
  return 'design';
}

function updateSceneHintText() {
  const t = I18N[gameState.lang];
  const hintEl = document.getElementById('mouse-hint-pill');
  const lblMonitor = document.getElementById('label-orbit-monitor');
  const isMonitorHovered = player.hoverTarget === 'monitor';

  if (lblMonitor) {
    lblMonitor.classList.toggle('hovered', isMonitorHovered);
  }
  monitorBezelMat.emissiveIntensity = isMonitorHovered ? 2.4 : 1.1;
  monitorGlowLight.intensity = isMonitorHovered ? 2.4 : 1.35;

  if (!hintEl) return;
  if (isMonitorHovered) {
    hintEl.textContent = t.mouseHints.hoverMonitor;
  } else if (player.hoverTarget === 'mount') {
    hintEl.textContent = gameState.reflectorMounted
      ? t.mouseHints.hoverMountAlign
      : t.mouseHints.hoverMountReady;
  } else if (player.hoverTarget === 'argon') {
    hintEl.textContent = t.mouseHints.hoverArgon;
  } else {
    hintEl.textContent = t.mouseHints.default;
  }
}

function updateHudTranslations() {
  const t = I18N[gameState.lang];
  document.documentElement.lang = gameState.lang;

  // Top Bar
  document.getElementById('lang-toggle-btn').textContent = t.switchLangBtn;
  const trackCount = gameState.lyriaPlaylist.length;
  const trackIdxBadge =
    trackCount > 0 ? ` (${(gameState.lyriaCurrentTrackIndex % trackCount) + 1}/${trackCount})` : '';
  document.getElementById('bgm-toggle-btn').textContent = gameState.bgmPlaying
    ? `${t.menu.bgmOn}${trackIdxBadge}`
    : `${t.menu.bgmBtn}${trackIdxBadge}`;
  const bgmNextBtn = document.getElementById('bgm-next-btn');
  if (bgmNextBtn && t.menu.bgmNextBtn) {
    bgmNextBtn.textContent = t.menu.bgmNextBtn;
  }
  document.getElementById('guide-btn').textContent = t.menu.guideBtn;
  document.getElementById('autoplay-btn').textContent = gameState.autoPlayActive
    ? t.menu.autoPlayRunning
    : t.menu.autoPlayBtn;
  document.getElementById('details-toggle-btn').textContent = t.menu.detailsBtn;
  document.getElementById('reset-cam-btn').textContent = t.menu.centerCamBtn;

  // Step Pills
  const stage = getCurrentUiStage();
  const stepDesign = document.getElementById('step-pill-design');
  const stepConfirm = document.getElementById('step-pill-confirm');
  const stepGen = document.getElementById('step-pill-generate');
  const stepMount = document.getElementById('step-pill-mount');
  const stepAlign = document.getElementById('step-pill-align');

  stepDesign.textContent = t.steps.design;
  stepConfirm.textContent = t.steps.confirm;
  stepGen.textContent = t.steps.generate;
  stepMount.textContent = t.steps.mount;
  stepAlign.textContent = t.steps.align;

  const setPillState = (el, isDone, isActive) => {
    el.className = `step-pill${isActive ? ' active' : isDone ? ' done' : ''}`;
  };

  setPillState(stepDesign, stage !== 'design' || gameState.designDrawerOpen === false, stage === 'design' && gameState.designDrawerOpen);
  setPillState(stepConfirm, gameState.designConfirmed, stage === 'design' && !gameState.designDrawerOpen);
  setPillState(stepGen, Boolean(gameState.loadedReflectorObject), stage === 'generate');
  setPillState(stepMount, gameState.reflectorMounted, stage === 'mount');
  setPillState(stepAlign, gameState.receiverAligned, stage === 'align');

  // Objective Single Sentence
  const objText = document.getElementById('mission-phase-text');
  if (stage === 'completed') {
    objText.textContent = t.objectives.completed;
  } else if (stage === 'align') {
    objText.textContent = t.objectives.align;
  } else if (stage === 'mount') {
    objText.textContent = t.objectives.mount;
  } else if (stage === 'generate') {
    objText.textContent = t.objectives.generate;
  } else if (gameState.designDrawerOpen) {
    objText.textContent = t.objectives.design;
  } else {
    objText.textContent = t.objectives.confirm;
  }

  // Show ONLY the active stage section & hide stage card on mission completion
  const stageCard = document.getElementById('stage-card');
  const compBanner = document.getElementById('completion-banner');

  if (stage === 'completed') {
    stageCard.style.display = 'none';
    compBanner.classList.add('visible');
  } else {
    stageCard.style.display = 'flex';
    compBanner.classList.remove('visible');
  }

  document.getElementById('stage-section-design').classList.toggle('active', stage === 'design');
  document.getElementById('stage-section-generate').classList.toggle('active', stage === 'generate');
  document.getElementById('stage-section-mount').classList.toggle('active', stage === 'mount');
  document.getElementById('stage-section-align').classList.toggle('active', stage === 'align');

  // Ensure Design Editor Drawer is closed outside Design stage
  const designDrawer = document.getElementById('design-editor-drawer');
  if (stage !== 'design') {
    designDrawer.classList.remove('open');
  } else {
    designDrawer.classList.toggle('open', gameState.designDrawerOpen);
  }

  // Stage Card Texts
  document.getElementById('ui-design-title').textContent = t.stageCards.designTitle;
  document.getElementById('design-version-num').textContent = String(gameState.activeDesignVersion);
  document.getElementById('gen-version-num').textContent = String(
    gameState.approvedDesignVersion || gameState.activeDesignVersion
  );
  document.getElementById('confirm-design-btn').textContent = t.stageCards.confirmDesignBtn;
  document.getElementById('toggle-design-drawer-btn').textContent = gameState.designDrawerOpen
    ? t.stageCards.closeDesignBtn
    : t.stageCards.openDesignBtn;
  document.getElementById('ui-design-desc-label').textContent = t.stageCards.designDescLabel;
  document.getElementById('design-mod-input').placeholder = t.stageCards.designModPlaceholder;
  document.getElementById('preview-gen-btn').textContent = t.stageCards.previewGenBtn;

  document.getElementById('ui-generate-title').textContent = t.stageCards.generateTitle;
  document.getElementById('ui-generate-sub').textContent = t.stageCards.generateSub;
  document.getElementById('generate-3d-btn').textContent = t.stageCards.gen3dBtn;
  document.getElementById('generate-3d-btn').disabled = !gameState.designConfirmed;
  document.getElementById('cancel-design-btn').textContent = t.stageCards.editDesignAgainBtn;

  document.getElementById('ui-mount-title').textContent = t.stageCards.mountTitle;
  document.getElementById('ui-mount-sub').textContent = t.stageCards.mountSub;
  document.getElementById('equip-mount-btn').textContent = t.stageCards.equipMountBtn;

  document.getElementById('ui-align-title').textContent = t.stageCards.alignTitle;
  document.getElementById('ui-align-sub').textContent = t.stageCards.alignSub;
  document.getElementById('ui-error-deg-label').textContent = t.stageCards.errorDegLabel;
  document.getElementById('ui-yaw-label').textContent = t.stageCards.yawSliderLabel;
  document.getElementById('ui-pitch-label').textContent = t.stageCards.pitchSliderLabel;
  document.getElementById('align-assist-btn').textContent = t.stageCards.snapOptimalBtn;
  document.getElementById('redesign-from-align-btn').textContent = t.stageCards.remountOrRedesignBtn;

  // Completion Banner
  document.getElementById('ui-complete-badge').textContent = t.completeBanner.badge;
  document.getElementById('ui-complete-title').textContent = t.completeBanner.title;
  document.getElementById('ui-complete-sub').textContent = t.completeBanner.subtitle;
  document.getElementById('complete-adjust-btn').textContent = t.completeBanner.adjustAgainBtn;
  document.getElementById('complete-new-design-btn').textContent = t.completeBanner.newDesignBtn;

  // Bottom Argon Bar
  document.getElementById('argon-name-label').textContent = t.argon.name;
  document.getElementById('voice-btn').textContent = t.argon.voiceBtn;
  document.getElementById('toggle-chat-btn').textContent = t.argon.chatToggleBtn;
  document.getElementById('dialogue-send-btn').textContent = t.argon.sendBtn;
  document.getElementById('dialogue-input').placeholder = t.argon.placeholder;

  // 3D World Floating Callout Labels
  const lblEmitter = document.getElementById('label-emitter');
  const lblReflector = document.getElementById('label-reflector');
  const lblReceiver = document.getElementById('label-receiver');
  const lblMonitor = document.getElementById('label-orbit-monitor');
  const lblSun = document.getElementById('label-sun');
  const lblMoon = document.getElementById('label-moon');
  const lblSolar = document.getElementById('label-solar-system');
  if (lblEmitter) {
    lblEmitter.textContent = gameState.lang === 'en' ? '☀️ Laser Emitter' : '☀️ 입사광 발신기';
  }
  if (lblReflector) {
    lblReflector.textContent = gameState.reflectorMounted
      ? gameState.lang === 'en'
        ? '🪞 3D Reflector (Mounted)'
        : '🪞 3D 반사판 (장착됨)'
      : gameState.lang === 'en'
        ? '🪞 Reflector Mount (Damaged)'
        : '🪞 반사판 마운트 (교체 필요)';
  }
  if (lblReceiver) {
    lblReceiver.textContent = gameState.receiverAligned
      ? gameState.lang === 'en'
        ? '🟢 Optical Receiver (LOCKED)'
        : '🟢 광수신기 (연결 완료)'
      : gameState.lang === 'en'
        ? '🎯 Optical Receiver (Target)'
        : '🎯 광수신기 (목표)';
    lblReceiver.classList.toggle('locked', gameState.receiverAligned);
  }
  if (lblMonitor && t.orbitMonitor) {
    lblMonitor.textContent = t.orbitMonitor.worldTag;
  }
  if (lblSun && t.orbitMonitor?.sunTag) {
    lblSun.textContent = t.orbitMonitor.sunTag;
  }
  if (lblMoon && t.orbitMonitor?.moonTag) {
    lblMoon.textContent = t.orbitMonitor.moonTag;
  }
  if (lblSolar && t.orbitMonitor?.solarTag) {
    lblSolar.textContent = t.orbitMonitor.solarTag;
  }

  // Orbit Monitor Modal Texts
  if (t.orbitMonitor) {
    const omTitle = document.getElementById('ui-orbit-modal-title');
    const omMeta = document.getElementById('ui-orbit-modal-meta');
    const omClose = document.getElementById('close-orbit-modal-btn');
    const omMarkerTitle = document.getElementById('ui-orbit-marker-title');
    const omMarkerDir = document.getElementById('ui-orbit-marker-dir');
    const omLegRev = document.getElementById('ui-orbit-legend-rev');
    const omLegSpin = document.getElementById('ui-orbit-legend-spin');
    const omLegSync = document.getElementById('ui-orbit-legend-sync');
    const omModeEarthBtn = document.getElementById('orbit-mode-earth-btn');
    const omModeSolarBtn = document.getElementById('orbit-mode-solar-btn');
    const omPipBadge = document.getElementById('orbit-solar-pip-badge');
    if (omTitle) omTitle.textContent = t.orbitMonitor.modalTitle;
    if (omMeta) omMeta.textContent = t.orbitMonitor.metaBadge;
    if (omClose) omClose.textContent = t.orbitMonitor.closeBtn;
    if (omMarkerTitle) omMarkerTitle.textContent = `🛰️ ${t.orbitMonitor.markerLabel}`;
    if (omMarkerDir) omMarkerDir.textContent = t.orbitMonitor.directionLabel;
    if (omLegRev) omLegRev.textContent = t.orbitMonitor.legendOrbit;
    if (omLegSpin) omLegSpin.textContent = t.orbitMonitor.legendEarthSpin;
    if (omLegSync) omLegSync.textContent = t.orbitMonitor.legendSync;
    if (omModeEarthBtn && t.orbitMonitor.modeEarthBtn) {
      omModeEarthBtn.textContent = t.orbitMonitor.modeEarthBtn;
      omModeEarthBtn.classList.toggle('active', orbitSim.orbitViewMode === 'earth');
    }
    if (omModeSolarBtn && t.orbitMonitor.modeSolarBtn) {
      omModeSolarBtn.textContent = t.orbitMonitor.modeSolarBtn;
      omModeSolarBtn.classList.toggle('active', orbitSim.orbitViewMode === 'solar');
    }
    if (omPipBadge && t.orbitMonitor.pipBadge) {
      omPipBadge.textContent = t.orbitMonitor.pipBadge;
      omPipBadge.style.display = orbitSim.orbitViewMode === 'earth' ? 'block' : 'none';
    }
  }

  // Details Drawer Telemetry
  document.getElementById('ui-game-title').textContent = t.gameTitle;
  document.getElementById('ui-orbit-subtitle').textContent = t.orbitSubTitle;
  document.getElementById('ui-telemetry-title').textContent = t.details.title;
  document.getElementById('ui-earth-layers').textContent = t.details.earthLayers;
  document.getElementById('lbl-workzone').textContent = t.details.workZoneLabel;
  document.getElementById('val-workzone').textContent = player.clampedByBoundary
    ? t.details.workZoneClamped
    : t.details.workZoneInside;
  document.getElementById('lbl-receiver').textContent = t.details.receiverStateLabel;
  document.getElementById('val-receiver').textContent = gameState.receiverAligned
    ? t.details.receiverGreen
    : t.details.receiverWaiting;
  document.getElementById('lbl-comms').textContent = t.details.opticalCommLabel;
  document.getElementById('val-comms').textContent = gameState.commsRestored
    ? t.details.opticalOnline
    : t.details.opticalOffline;
  document.getElementById('lbl-door').textContent = t.details.doorStateLabel;
  document.getElementById('val-door').textContent = gameState.doorOpened
    ? t.details.doorOpen
    : t.details.doorClosed;
  document.getElementById('lbl-bgm').textContent = t.details.bgmLabel;
  document.getElementById('val-bgm').textContent = gameState.bgmDucked
    ? t.details.bgmDucked
    : t.details.bgmNormal;
  document.getElementById('ui-provenance-title').textContent = t.details.provenanceTitle;

  // Guide Modal
  document.getElementById('ui-guide-title').textContent = t.guide.title;
  document.getElementById('close-guide-btn').textContent = t.guide.closeBtn;
  document.getElementById('ui-guide-goal').textContent = t.guide.goal;
  document.getElementById('ui-guide-steps').innerHTML = t.guide.steps
    .map((s) => `<li>${s}</li>`)
    .join('');
  document.getElementById('ui-guide-controls').innerHTML = t.guide.controls
    .map((c) => `<li>${c}</li>`)
    .join('');

  // Lyria Music Generation Studio & Playlist Modal & Top Button
  const lyriaBtn = document.getElementById('lyria-studio-btn');
  if (lyriaBtn && t.menu.lyriaStudioBtn) {
    lyriaBtn.textContent = t.menu.lyriaStudioBtn;
  }
  if (t.lyriaModal) {
    const lmTitle = document.getElementById('ui-lyria-modal-title');
    const lmMeta = document.getElementById('ui-lyria-modal-meta');
    const lmClose = document.getElementById('close-lyria-modal-btn');
    const lmPlaylistTitle = document.getElementById('ui-lyria-playlist-title');
    const lmModeBtn = document.getElementById('lyria-playlist-mode-btn');
    const lmSkipBtn = document.getElementById('lyria-skip-next-btn');
    const lmRandomGenBtn = document.getElementById('lyria-random-gen-btn');
    const lmModelLbl = document.getElementById('ui-lyria-model-label');
    const lmOptClip = document.getElementById('ui-lyria-opt-clip');
    const lmOptFull = document.getElementById('ui-lyria-opt-full');
    const lmPromptLbl = document.getElementById('ui-lyria-prompt-label');
    const lmPreAmb = document.getElementById('lyria-preset-ambient');
    const lmPreVoc = document.getElementById('lyria-preset-vocal');
    const lmPrePul = document.getElementById('lyria-preset-pulse');
    const lmPreRnd = document.getElementById('lyria-preset-random');
    const lmGenBtn = document.getElementById('lyria-generate-btn');
    const lmApplyBtn = document.getElementById('lyria-apply-bgm-btn');
    const lmDlBtn = document.getElementById('lyria-download-link');
    const lmLyricsLbl = document.getElementById('ui-lyria-lyrics-label');
    if (lmTitle) lmTitle.textContent = t.lyriaModal.modalTitle;
    if (lmMeta) lmMeta.textContent = t.lyriaModal.metaBadge;
    if (lmClose) lmClose.textContent = t.lyriaModal.closeBtn;
    if (lmPlaylistTitle && t.lyriaModal.playlistTitle && Array.isArray(gameState.lyriaPlaylist)) {
      lmPlaylistTitle.textContent = `${t.lyriaModal.playlistTitle} (${gameState.lyriaPlaylist.length})`;
    }
    if (lmModeBtn) {
      lmModeBtn.textContent = gameState.bgmPlaylistMode
        ? t.lyriaModal.playlistModeOn
        : t.lyriaModal.playlistModeOff;
      lmModeBtn.classList.toggle('lyria-mode-btn-active', Boolean(gameState.bgmPlaylistMode));
    }
    if (lmSkipBtn && t.lyriaModal.skipNextBtn) lmSkipBtn.textContent = t.lyriaModal.skipNextBtn;
    if (lmRandomGenBtn && t.lyriaModal.randomGenBtn) {
      lmRandomGenBtn.textContent = gameState.lyriaGenerating
        ? t.lyriaModal.generatingBtn
        : t.lyriaModal.randomGenBtn;
      lmRandomGenBtn.disabled = gameState.lyriaGenerating;
    }
    if (lmModelLbl) lmModelLbl.textContent = t.lyriaModal.modelLabel;
    if (lmOptClip) lmOptClip.textContent = t.lyriaModal.clipOption;
    if (lmOptFull) lmOptFull.textContent = t.lyriaModal.fullOption;
    if (lmPromptLbl) lmPromptLbl.textContent = t.lyriaModal.promptLabel;
    if (lmPreAmb) lmPreAmb.textContent = t.lyriaModal.presetAmbient;
    if (lmPreVoc) lmPreVoc.textContent = t.lyriaModal.presetVocal;
    if (lmPrePul) lmPrePul.textContent = t.lyriaModal.presetPulse;
    if (lmPreRnd && t.lyriaModal.presetRandom) lmPreRnd.textContent = t.lyriaModal.presetRandom;
    if (lmGenBtn) {
      lmGenBtn.textContent = gameState.lyriaGenerating
        ? t.lyriaModal.generatingBtn
        : t.lyriaModal.generateBtn;
      lmGenBtn.disabled = gameState.lyriaGenerating;
    }
    if (lmApplyBtn) lmApplyBtn.textContent = t.lyriaModal.applyBgmBtn;
    if (lmDlBtn) lmDlBtn.textContent = t.lyriaModal.downloadBtn;
    if (lmLyricsLbl) lmLyricsLbl.textContent = t.lyriaModal.lyricsLabel;
    if (typeof renderLyriaPlaylistQueue === 'function') {
      renderLyriaPlaylistQueue();
    }
  }

  updateInSceneMonitorScreen(player.hoverTarget === 'monitor');
  updateSceneHintText();
}

// Project 3D Positions to 2D Floating Labels
const tempProjVec = new THREE.Vector3();
const tempSkySunPos = new THREE.Vector3();
const tempSkyMoonPos = new THREE.Vector3();
const tempSkySolarPos = new THREE.Vector3();

function updateWorldLabels() {
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();

  celestialSky.sunSkyGroup.getWorldPosition(tempSkySunPos);
  celestialSky.moonBodyGroup.getWorldPosition(tempSkyMoonPos);
  if (celestialSky.saturnSkyGroup) {
    celestialSky.saturnSkyGroup.getWorldPosition(tempSkySolarPos);
  } else {
    tempSkySolarPos.set(16, 39, -148);
  }

  const items = [
    { el: document.getElementById('label-sun'), pos: tempSkySunPos, offsetY: 11.2 },
    { el: document.getElementById('label-moon'), pos: tempSkyMoonPos, offsetY: 6.8 },
    { el: document.getElementById('label-solar-system'), pos: tempSkySolarPos, offsetY: 5.2 },
    { el: document.getElementById('label-emitter'), pos: EMITTER_POS, offsetY: 0.65 },
    { el: document.getElementById('label-reflector'), pos: MOUNT_POS, offsetY: 1.45 },
    { el: document.getElementById('label-receiver'), pos: RECEIVER_POS, offsetY: 0.85 },
    { el: document.getElementById('label-orbit-monitor'), pos: ORBIT_MONITOR_POS, offsetY: 0.58 },
  ];
  for (const item of items) {
    if (!item.el) continue;
    tempProjVec.copy(item.pos);
    tempProjVec.y += item.offsetY;
    tempProjVec.project(camera);
    if (tempProjVec.z > 1 || tempProjVec.z < -1) {
      item.el.style.display = 'none';
      continue;
    }
    const x = (tempProjVec.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-tempProjVec.y * 0.5 + 0.5) * window.innerHeight;
    if (x < 24 || x > window.innerWidth - 24 || y < 58 || y > window.innerHeight - 40) {
      item.el.style.display = 'none';
      continue;
    }
    item.el.style.display = 'block';
    item.el.style.left = `${x}px`;
    item.el.style.top = `${y}px`;
  }
}

// ============================================================================
// UI Event Listeners
// ============================================================================
document.getElementById('lang-toggle-btn').addEventListener('click', async () => {
  gameState.lang = gameState.lang === 'ko' ? 'en' : 'ko';
  updateHudTranslations();
  await fetch('/api/lang', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: gameState.lang }),
  });
});

document.getElementById('bgm-toggle-btn').addEventListener('click', async () => {
  if (bgmAudio.paused) {
    await ensureBgmPlaying();
  } else {
    bgmAudio.pause();
    gameState.bgmPlaying = false;
  }
  updateHudTranslations();
});

// Gemini Lyria Music Generation Studio & Continuous Random Prompt Playlist Handlers
const lyriaModalEl = document.getElementById('lyria-modal');
const lyriaStudioBtn = document.getElementById('lyria-studio-btn');
const closeLyriaModalBtn = document.getElementById('close-lyria-modal-btn');

function openLyriaModal() {
  gameState.lyriaModalOpen = true;
  renderLyriaPlaylistQueue();
  lyriaModalEl?.classList.add('open');
}

function closeLyriaModal() {
  gameState.lyriaModalOpen = false;
  lyriaModalEl?.classList.remove('open');
}

lyriaStudioBtn?.addEventListener('click', () => {
  openLyriaModal();
});
closeLyriaModalBtn?.addEventListener('click', () => {
  closeLyriaModal();
});

function renderLyriaPlaylistQueue() {
  const listEl = document.getElementById('lyria-playlist-items');
  if (!listEl) return;
  const playlist = gameState.lyriaPlaylist || [];
  if (playlist.length === 0) {
    listEl.innerHTML = `<div style="font-size:11.5px;color:#94a3b8;padding:4px;">${
      gameState.lang === 'en' ? 'Loading orbital playlist...' : '우주 플레이리스트 불러오는 중...'
    }</div>`;
    return;
  }

  listEl.innerHTML = '';
  playlist.forEach((track, idx) => {
    const isActive = idx === gameState.lyriaCurrentTrackIndex;
    const itemBtn = document.createElement('button');
    itemBtn.type = 'button';
    itemBtn.className = `lyria-playlist-item${isActive ? ' active' : ''}`;

    const titleText =
      gameState.lang === 'en'
        ? track.titleEn || track.titleKo || `Orbital Track #${idx + 1}`
        : track.titleKo || track.titleEn || `우주 트랙 #${idx + 1}`;
    const subPrompt = String(track.input || '').slice(0, 72);
    const kbText = track.byteLength ? `${(track.byteLength / 1024).toFixed(0)} KB` : 'MP3';
    const stateLabel = isActive
      ? gameState.bgmPlaying
        ? gameState.lang === 'en'
          ? '🔊 Playing'
          : '🔊 재생 중'
        : gameState.lang === 'en'
          ? '⏸ Selected'
          : '⏸ 선택됨'
      : gameState.lang === 'en'
        ? '▶ Play'
        : '▶ 재생';

    itemBtn.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;">
        <div style="font-size:12px;font-weight:700;color:${isActive ? '#a7f3d0' : '#f1f5f9'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          #${idx + 1} · ${titleText}
        </div>
        <div style="font-size:10.5px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${subPrompt}...
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        <span style="font-size:10px;color:#7dd3fc;">${kbText}</span>
        <span class="badge ${isActive ? 'badge-ok' : 'badge-info'}" style="font-size:10.5px;">${stateLabel}</span>
      </div>
    `;
    itemBtn.addEventListener('click', () => {
      void playLyriaPlaylistTrack(idx, true);
    });
    listEl.appendChild(itemBtn);
  });
}

async function playLyriaPlaylistTrack(index, shouldPlay = true) {
  const playlist = gameState.lyriaPlaylist || [];
  if (playlist.length === 0) {
    if (shouldPlay) await applyLyriaTrackToBgm();
    return;
  }
  const safeIndex = ((index % playlist.length) + playlist.length) % playlist.length;
  const track = playlist[safeIndex];
  gameState.lyriaCurrentTrackIndex = safeIndex;

  const audioSrc = track.audioDataUrl || track.audioUrl || '/audio/lyria-bgm-latest.mp3';
  gameState.lyriaModel = track.model || 'lyria-3-clip-preview';
  gameState.lyriaAudioUrl = track.audioUrl || audioSrc;
  gameState.lyriaAudioDataUrl = track.audioDataUrl || null;
  gameState.lyriaLyricsText = track.text || '<instrumental>';

  const playerEl = document.getElementById('lyria-audio-player');
  const downloadEl = document.getElementById('lyria-download-link');
  const lyricsEl = document.getElementById('lyria-lyrics-output');
  const badgeEl = document.getElementById('lyria-track-badge');
  const mimeInfoEl = document.getElementById('lyria-mime-info');
  const promptInput = document.getElementById('lyria-prompt-input');

  if (playerEl) playerEl.src = audioSrc;
  if (downloadEl) {
    downloadEl.href = audioSrc;
    downloadEl.download = `suncatcher-track-${safeIndex + 1}-${gameState.lyriaModel}.mp3`;
  }
  if (lyricsEl) lyricsEl.textContent = gameState.lyriaLyricsText;
  if (badgeEl) {
    const titleLabel =
      gameState.lang === 'en'
        ? track.titleEn || track.titleKo || gameState.lyriaModel
        : track.titleKo || track.titleEn || gameState.lyriaModel;
    badgeEl.textContent = `#${safeIndex + 1} ${titleLabel} · ${track.mimeType || 'audio/mpeg'}`;
  }
  if (mimeInfoEl && track.byteLength) {
    mimeInfoEl.textContent = `${(track.byteLength / 1024).toFixed(1)} KB MP3`;
  }
  if (promptInput && track.input) {
    promptInput.value = track.input;
  }

  bgmAudio.src = audioSrc;
  bgmAudio.loop = !gameState.bgmPlaylistMode;
  bgmAudio.volume = gameState.bgmDucked ? 0.08 : 0.42;

  if (shouldPlay || gameState.bgmPlaying) {
    try {
      await bgmAudio.play();
      gameState.bgmPlaying = true;
    } catch {
      gameState.bgmPlaying = true;
    }
  }
  updateHudTranslations();
}

async function prefetchNextRandomLyriaTrack() {
  if (gameState.lyriaPrefetching || gameState.lyriaGenerating) return null;
  if ((gameState.lyriaPlaylist?.length || 0) >= 8) return null;

  gameState.lyriaPrefetching = true;
  const statusEl = document.getElementById('lyria-status-text');
  if (statusEl) {
    statusEl.style.color = '#7dd3fc';
    statusEl.textContent = I18N[gameState.lang].lyriaModal.statusAutoGenerating;
  }

  try {
    const excludePrompts = (gameState.lyriaPlaylist || [])
      .map((t) => t.promptId || t.input)
      .filter(Boolean);
    const res = await fetch('/api/lyria/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'lyria-3-clip-preview',
        randomPrompt: true,
        excludePrompts,
      }),
    });
    const data = await res.json();
    if (res.ok && !data.error) {
      if (Array.isArray(data.playlist) && data.playlist.length > 0) {
        gameState.lyriaPlaylist = data.playlist;
      } else if (data.audioUrl) {
        gameState.lyriaPlaylist.push({
          trackId: data.interactionId,
          promptId: data.promptId,
          titleKo: data.titleKo,
          titleEn: data.titleEn,
          model: data.model,
          input: data.input,
          mimeType: data.mimeType || 'audio/mpeg',
          text: data.text || '<instrumental>',
          audioUrl: data.audioUrl,
          byteLength: data.byteLength,
        });
      }
      if (statusEl) {
        statusEl.style.color = '#6ee7b7';
        statusEl.textContent = I18N[gameState.lang].lyriaModal.statusReady;
      }
      updateHudTranslations();
      return data;
    }
  } catch {
    // Silent background prefetch fallback
  } finally {
    gameState.lyriaPrefetching = false;
  }
  return null;
}

async function advanceToNextPlaylistTrack(fromEndedEvent = false) {
  const playlist = gameState.lyriaPlaylist || [];
  if (playlist.length === 0) {
    await ensureBgmPlaying();
    return;
  }
  const nextIndex = (gameState.lyriaCurrentTrackIndex + 1) % playlist.length;
  await playLyriaPlaylistTrack(nextIndex, true);

  // While playing in Continuous Playlist Mode, automatically generate a new random track in the background
  // when reaching the end of the current queue (up to 8 tracks) so the soundtrack keeps evolving!
  if (
    gameState.bgmPlaylistMode &&
    gameState.bgmAutoPrefetch &&
    (fromEndedEvent || nextIndex === 0 || playlist.length < 5) &&
    playlist.length < 8
  ) {
    void prefetchNextRandomLyriaTrack();
  }
}

document.getElementById('bgm-next-btn')?.addEventListener('click', () => {
  void advanceToNextPlaylistTrack(false);
});
document.getElementById('lyria-skip-next-btn')?.addEventListener('click', () => {
  void advanceToNextPlaylistTrack(false);
});

document.getElementById('lyria-playlist-mode-btn')?.addEventListener('click', () => {
  gameState.bgmPlaylistMode = !gameState.bgmPlaylistMode;
  bgmAudio.loop = !gameState.bgmPlaylistMode;
  updateHudTranslations();
});

function rollRandomPromptIntoTextarea() {
  const pool = gameState.lyriaPromptPool || [];
  const inputEl = document.getElementById('lyria-prompt-input');
  if (!inputEl) return null;
  if (pool.length === 0) {
    inputEl.value =
      'Ethereal spaceambient electronic music, shimmering aurora borealis and airglow seen from 650km polar orbit, crystalline synth bells, deep sub-bass drone, peaceful futuristic mood, 78 BPM, instrumental';
    return null;
  }
  const currentVal = inputEl.value.trim();
  const candidates = pool.filter((p) => p.input !== currentVal);
  const chosen = (candidates.length > 0 ? candidates : pool)[
    Math.floor(Math.random() * (candidates.length > 0 ? candidates.length : pool.length))
  ];
  inputEl.value = chosen.input;
  return chosen;
}

document.getElementById('lyria-preset-random')?.addEventListener('click', () => {
  rollRandomPromptIntoTextarea();
});

document.getElementById('lyria-random-gen-btn')?.addEventListener('click', () => {
  const chosen = rollRandomPromptIntoTextarea();
  void requestLyriaMusicGeneration({
    randomPrompt: true,
    promptId: chosen?.id,
    titleKo: chosen?.titleKo,
    titleEn: chosen?.titleEn,
    input: chosen?.input,
  });
});

document.getElementById('lyria-preset-ambient')?.addEventListener('click', () => {
  const inputEl = document.getElementById('lyria-prompt-input');
  if (inputEl) {
    inputEl.value =
      'Ambient sci-fi space station synthesizer soundtrack, 650km dawn-dusk orbit over Earth, warm analog pads, subtle crystalline arpeggios, calm zero-gravity exploration mood, 84 BPM, high fidelity stereo';
  }
});

document.getElementById('lyria-preset-vocal')?.addEventListener('click', () => {
  const inputEl = document.getElementById('lyria-prompt-input');
  if (inputEl) {
    inputEl.value =
      'Dreamy synthpop space ballad with clear ethereal vocals about reflecting sunlight across the 650km orbital relay station Suncatcher:\n[Verse]\nSix hundred fifty kilometers high\nCatching the dawn across the quiet sky\nMirrors of gold align the solar stream\nWaking the station from a silent dream';
  }
});

document.getElementById('lyria-preset-pulse')?.addEventListener('click', () => {
  const inputEl = document.getElementById('lyria-prompt-input');
  if (inputEl) {
    inputEl.value =
      'Futuristic electronic synthwave pulse soundtrack for spacewalk EVA laser alignment, crisp analog bassline, shimmering cosmic arpeggios, 102 BPM, instrumental';
  }
});

async function applyLyriaTrackToBgm(audioSourceUrl) {
  const targetSrc =
    audioSourceUrl || gameState.lyriaAudioDataUrl || gameState.lyriaAudioUrl || '/audio/lyria-bgm-latest.mp3';
  bgmAudio.src = targetSrc;
  bgmAudio.loop = !gameState.bgmPlaylistMode;
  bgmAudio.volume = gameState.bgmDucked ? 0.08 : 0.42;
  try {
    await bgmAudio.play();
    gameState.bgmPlaying = true;
  } catch {
    gameState.bgmPlaying = true;
  }
  updateHudTranslations();
}

document.getElementById('lyria-apply-bgm-btn')?.addEventListener('click', () => {
  void applyLyriaTrackToBgm();
});

async function requestLyriaMusicGeneration(customPayload = null) {
  if (gameState.lyriaGenerating) return;
  const modelSelect = document.getElementById('lyria-model-select');
  const promptInput = document.getElementById('lyria-prompt-input');
  const statusEl = document.getElementById('lyria-status-text');
  const playerEl = document.getElementById('lyria-audio-player');
  const downloadEl = document.getElementById('lyria-download-link');
  const lyricsEl = document.getElementById('lyria-lyrics-output');
  const badgeEl = document.getElementById('lyria-track-badge');
  const mimeInfoEl = document.getElementById('lyria-mime-info');

  const model = customPayload?.model || modelSelect?.value || 'lyria-3-clip-preview';
  const input = customPayload?.input || promptInput?.value || '';
  const excludePrompts = (gameState.lyriaPlaylist || [])
    .map((t) => t.promptId || t.input)
    .filter(Boolean);

  gameState.lyriaGenerating = true;
  updateHudTranslations();
  if (statusEl) {
    statusEl.style.color = '#fde68a';
    statusEl.textContent = I18N[gameState.lang].lyriaModal.statusGenerating;
  }

  try {
    const res = await fetch('/api/lyria/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input,
        randomPrompt: Boolean(customPayload?.randomPrompt),
        excludePrompts,
        promptId: customPayload?.promptId,
        titleKo: customPayload?.titleKo,
        titleEn: customPayload?.titleEn,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.message || `Lyria API error (${res.status})`);
    }

    const mimeType = data.mimeType || 'audio/mpeg';
    const audioDataUrl =
      data.audioDataUrl || (data.audioData ? `data:${mimeType};base64,${data.audioData}` : data.audioUrl);

    gameState.lyriaModel = data.model || model;
    gameState.lyriaAudioDataUrl = audioDataUrl;
    gameState.lyriaAudioUrl = data.audioUrl || '/audio/lyria-bgm-latest.mp3';
    gameState.lyriaLyricsText = data.text || '<instrumental>';

    if (Array.isArray(data.playlist) && data.playlist.length > 0) {
      gameState.lyriaPlaylist = data.playlist;
      gameState.lyriaCurrentTrackIndex = data.playlist.length - 1;
    } else {
      gameState.lyriaPlaylist.push({
        trackId: data.interactionId,
        promptId: data.promptId || 'custom',
        titleKo: data.titleKo || '사용자 생성 우주 트랙',
        titleEn: data.titleEn || 'Custom Orbital Track',
        model: gameState.lyriaModel,
        input: data.input || input,
        mimeType,
        text: gameState.lyriaLyricsText,
        audioUrl: gameState.lyriaAudioUrl,
        audioDataUrl,
        byteLength: data.byteLength,
      });
      gameState.lyriaCurrentTrackIndex = gameState.lyriaPlaylist.length - 1;
    }

    if (promptInput && data.input) {
      promptInput.value = data.input;
    }
    if (playerEl && audioDataUrl) {
      playerEl.src = audioDataUrl;
    }
    if (downloadEl && audioDataUrl) {
      downloadEl.href = audioDataUrl;
      downloadEl.download = `suncatcher-${gameState.lyriaModel}-${Date.now()}.mp3`;
    }
    if (lyricsEl) {
      lyricsEl.textContent = gameState.lyriaLyricsText;
    }
    if (badgeEl) {
      badgeEl.textContent = `#${gameState.lyriaCurrentTrackIndex + 1} ${
        gameState.lang === 'en' ? data.titleEn || gameState.lyriaModel : data.titleKo || gameState.lyriaModel
      } · ${mimeType}`;
    }
    if (mimeInfoEl && data.byteLength) {
      mimeInfoEl.textContent = `${(data.byteLength / 1024).toFixed(1)} KB MP3`;
    }
    if (statusEl) {
      statusEl.style.color = '#6ee7b7';
      statusEl.textContent = I18N[gameState.lang].lyriaModal.statusSuccess;
    }

    await applyLyriaTrackToBgm(audioDataUrl);
    return data;
  } catch (err) {
    if (statusEl) {
      statusEl.style.color = '#fca5a5';
      statusEl.textContent = err.message;
    }
    return { error: true, message: err.message };
  } finally {
    gameState.lyriaGenerating = false;
    updateHudTranslations();
  }
}

document.getElementById('lyria-generate-btn')?.addEventListener('click', () => {
  void requestLyriaMusicGeneration();
});

function resetCameraToStageFocus() {
  const stage = getCurrentUiStage();
  if (stage === 'align') {
    animateCameraToPreset('alignFocus', 0.55);
  } else if (stage === 'completed') {
    animateCameraToPreset('completeView', 0.55);
  } else {
    animateCameraToPreset('overview', 0.55);
  }
}

document.getElementById('reset-cam-btn').addEventListener('click', () => {
  resetCameraToStageFocus();
});

document.getElementById('guide-btn').addEventListener('click', () => {
  document.getElementById('guide-modal').classList.add('open');
});
document.getElementById('close-guide-btn').addEventListener('click', () => {
  document.getElementById('guide-modal').classList.remove('open');
});

document.getElementById('details-toggle-btn').addEventListener('click', () => {
  document.getElementById('details-drawer').classList.toggle('open');
});
document.getElementById('close-details-btn').addEventListener('click', () => {
  document.getElementById('details-drawer').classList.remove('open');
});

document.getElementById('toggle-chat-btn').addEventListener('click', () => {
  document.getElementById('argon-chat-drawer').classList.toggle('open');
});
document.getElementById('close-chat-btn').addEventListener('click', () => {
  document.getElementById('argon-chat-drawer').classList.remove('open');
});

document.getElementById('toggle-design-drawer-btn').addEventListener('click', () => {
  gameState.designDrawerOpen = !gameState.designDrawerOpen;
  updateHudTranslations();
});

document.getElementById('preset-hex-btn').addEventListener('click', () => {
  document.getElementById('design-desc-input').value =
    '19-segment hexagonal gold honeycomb optical mirror array with chamfered dark titanium bezel, 4 glowing blue corner alignment fiducials, and rear carbon-composite truss dual-axis gimbal mount.';
  document.getElementById('design-mod-input').value = 'Hexagonal gold honeycomb mirror array v1';
  void requestDesignPreview();
});

document.getElementById('preset-petal-btn').addEventListener('click', () => {
  document.getElementById('design-desc-input').value =
    '8-petal circular parabolic silver-platinum optical dish reflector with glowing amber-orange laser calibration ring, 3 triangular perimeter clamps, and heavy rear cylindrical actuator gimbal.';
  document.getElementById('design-mod-input').value = 'Switch to circular 8-petal parabolic silver dish';
  void requestDesignPreview();
});

document.getElementById('pointer-lock-btn').addEventListener('click', () => {
  void ensureBgmPlaying();
  if (document.pointerLockElement === canvas) {
    document.exitPointerLock?.();
  } else if (canvas.requestPointerLock) {
    canvas.requestPointerLock();
  }
});

document.getElementById('error-retry-btn').addEventListener('click', () => {
  const retry = gameState.lastRetryAction;
  hideAlert();
  if (typeof retry === 'function') retry();
});

// Dialogue & Voice Input
async function sendDialogueMessage(msgText) {
  if (!msgText || !msgText.trim()) return;
  await ensureBgmPlaying();
  hideAlert();
  appendDialogueMessage('user', msgText);
  try {
    const res = await fetch('/api/dialogue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msgText, lang: gameState.lang }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      showAlert(data.message || 'Dialogue error', () => sendDialogueMessage(msgText));
      return data;
    }
    appendDialogueMessage('argon', data.reply);
    speakArgonText(data.reply, gameState.lang);
    return data;
  } catch (err) {
    showAlert(err.message, () => sendDialogueMessage(msgText));
    return { error: true, message: err.message };
  }
}

document.getElementById('dialogue-send-btn').addEventListener('click', () => {
  const input = document.getElementById('dialogue-input');
  const text = input.value;
  input.value = '';
  void sendDialogueMessage(text);
});

document.getElementById('dialogue-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('dialogue-send-btn').click();
  }
});

function triggerVoiceInput() {
  void ensureBgmPlaying();
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    const fallbackPrompt =
      gameState.lang === 'en'
        ? 'Argon, how should we align the reflector to restore the optical link?'
        : '아르곤, 광통신 복구를 위해 반사판을 어떻게 정렬하면 될까?';
    void sendDialogueMessage(fallbackPrompt);
    return;
  }
  const rec = new SpeechRec();
  rec.lang = gameState.lang === 'en' ? 'en-US' : 'ko-KR';
  const btn = document.getElementById('voice-btn');
  btn.textContent = I18N[gameState.lang].argon.voiceListening;
  rec.onresult = (ev) => {
    const transcript = ev.results?.[0]?.[0]?.transcript || '';
    if (transcript) void sendDialogueMessage(transcript);
  };
  rec.onerror = () => updateHudTranslations();
  rec.onend = () => updateHudTranslations();
  rec.start();
}

document.getElementById('voice-btn').addEventListener('click', triggerVoiceInput);

// Design Preview Modification
async function requestDesignPreview() {
  await ensureBgmPlaying();
  hideAlert();
  const description = document.getElementById('design-desc-input').value;
  const modificationNote = document.getElementById('design-mod-input').value;

  const res = await fetch('/api/design/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, modificationNote }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    showAlert(data.message || 'Design preview failed', requestDesignPreview);
    return data;
  }

  gameState.activeDesignVersion = data.activeDesignVersion;
  gameState.designConfirmed = data.designConfirmed;
  gameState.approvedDesignVersion = null;
  gameState.designPreview = data.designPreview;

  document.getElementById('design-preview-img').src = data.designPreview.imageUrl;
  document.getElementById('design-summary-thumb').src = data.designPreview.imageUrl;
  document.getElementById('gen-summary-thumb').src = data.designPreview.imageUrl;
  document.getElementById('design-summary-desc').textContent = data.designPreview.description;
  document.getElementById('design-desc-input').value = data.designPreview.description;
  document.getElementById('design-mod-input').value = '';
  updateHudTranslations();
  return data;
}

document.getElementById('preview-gen-btn').addEventListener('click', () => {
  void requestDesignPreview();
});

// Confirm Design -> Automatically closes Design Drawer and moves to Stage 2 (Generate)
async function confirmCurrentDesign() {
  await ensureBgmPlaying();
  hideAlert();
  const res = await fetch('/api/design/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ designVersion: gameState.activeDesignVersion }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    showAlert(data.message || 'Confirm failed', confirmCurrentDesign);
    return data;
  }
  gameState.designConfirmed = data.designConfirmed;
  gameState.approvedDesignVersion = data.approvedDesignVersion;
  gameState.designDrawerOpen = false;
  appendDialogueMessage('argon', I18N[gameState.lang].argon.stageHints.generate);
  updateHudTranslations();
  void syncMissionTelemetry();
  return data;
}

document.getElementById('confirm-design-btn').addEventListener('click', () => {
  void confirmCurrentDesign();
});

// Reuse Existing 3D Reflector on Replay (Immediate mount without waiting for AI generation)
async function reuseExistingReflector() {
  if (!gameState.loadedReflectorObject) return;
  await ensureBgmPlaying();
  hideAlert();
  await fetch('/api/design/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      designVersion:
        gameState.activeReflectorMeta?.approvedDesignVersion || gameState.activeDesignVersion,
    }),
  });
  gameState.designConfirmed = true;
  gameState.approvedDesignVersion =
    gameState.activeReflectorMeta?.approvedDesignVersion || gameState.activeDesignVersion;
  gameState.designDrawerOpen = false;
  mountActiveReflectorOnPedestal();
  triggerStoryLine('mounted');
  updateHudTranslations();
  void syncMissionTelemetry();
}

const reuseReflectorBtn = document.getElementById('reuse-reflector-btn');
if (reuseReflectorBtn) {
  reuseReflectorBtn.addEventListener('click', () => {
    void reuseExistingReflector();
  });
}

// Cancel Design Confirmation / Re-open Design Stage
async function reopenDesignStage() {
  hideAlert();
  await fetch('/api/design/cancel', { method: 'POST' });
  gameState.designConfirmed = false;
  gameState.approvedDesignVersion = null;
  gameState.reflectorMounted = false;
  gameState.receiverAligned = false;
  gameState.passStarted = false;
  gameState.passActiveMode = false;
  gameState.inPassWindow = false;
  gameState.passMissed = false;
  gameState.txProgress = 0;
  gameState.txCompleted = false;
  gameState.groundAckReceived = false;
  gameState.returningInProgress = false;
  gameState.returnedToBase = false;
  gameState.commsRestored = false;
  gameState.doorOpened = false;
  gameState.doorOpenProgress = 0;
  leftDoorPanel.position.x = -0.96;
  rightDoorPanel.position.x = 0.96;
  gameState.reviewingAlignAfterComplete = false;
  gameState.designDrawerOpen = true;
  animateCameraToPreset('overview', 0.6);
  updateOpticalPuzzle();
  updateHudTranslations();
  void syncMissionTelemetry();
}

// Reset Mission for Replay ("🔁 임무 다시 시작") while optionally keeping existing 3D reflector
async function resetMissionFlow(keepReflector = true) {
  hideAlert();
  await fetch('/api/mission/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keepReflector }),
  });
  gameState.designConfirmed = false;
  gameState.approvedDesignVersion = null;
  gameState.reflectorMounted = false;
  gameState.receiverAligned = false;
  gameState.hintActive = false;
  gameState.passStarted = false;
  gameState.passActiveMode = false;
  gameState.inPassWindow = false;
  gameState.passMissed = false;
  gameState.txProgress = 0;
  gameState.txCompleted = false;
  gameState.groundAckReceived = false;
  gameState.returningInProgress = false;
  gameState.returnedToBase = false;
  gameState.commsRestored = false;
  gameState.doorOpened = false;
  gameState.doorOpenProgress = 0;
  leftDoorPanel.position.x = -0.96;
  rightDoorPanel.position.x = 0.96;
  gameState.mountedYawRad = -0.35;
  gameState.mountedPitchRad = -0.2;
  gameState.reviewingAlignAfterComplete = false;
  gameState.designDrawerOpen = false;
  gameState.triggeredStoryKeys.clear();
  if (reflectorMountPivot.children.length > 0 && gameState.loadedReflectorObject) {
    reflectorMountPivot.remove(gameState.loadedReflectorObject);
  }
  animateCameraToPreset('overview', 0.65);
  updateOpticalPuzzle();
  updateHudTranslations();
  triggerStoryLine('briefing1');
  setTimeout(() => {
    if (!gameState.reflectorMounted) triggerStoryLine('briefing2');
  }, 2400);
  void syncMissionTelemetry();
}

document.getElementById('cancel-design-btn').addEventListener('click', () => {
  void reopenDesignStage();
});
document.getElementById('redesign-from-align-btn').addEventListener('click', () => {
  void reopenDesignStage();
});
document.getElementById('complete-new-design-btn').addEventListener('click', () => {
  void reopenDesignStage();
});
const restartMissionBtn = document.getElementById('restart-mission-btn');
if (restartMissionBtn) {
  restartMissionBtn.addEventListener('click', () => {
    void resetMissionFlow(true);
  });
}
document.getElementById('complete-adjust-btn').addEventListener('click', () => {
  gameState.reviewingAlignAfterComplete = true;
  animateCameraToPreset('alignFocus', 0.55);
  updateHudTranslations();
});

// Generate Actual 3D Reflector (.glb)
async function generateActual3DReflector(customOptions = {}) {
  await ensureBgmPlaying();
  hideAlert();
  const btn = document.getElementById('generate-3d-btn');
  const noteEl = document.getElementById('gen-status-note');
  btn.disabled = true;
  if (noteEl) {
    noteEl.textContent =
      gameState.lang === 'en'
        ? 'Synthesizing 3D reflector mesh (.glb)...'
        : '승인된 디자인으로 입체 3D 반사판(.glb) 생성 중...';
  }

  try {
    const res = await fetch('/api/reflector/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approvedDesignVersion: gameState.approvedDesignVersion,
        ...customOptions,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      btn.disabled = !gameState.designConfirmed;
      showAlert(data.message || '3D generation failed', () =>
        generateActual3DReflector(customOptions)
      );
      return data;
    }
    await loadGeneratedReflectorGLB(data.activeReflector);
    btn.disabled = false;
    appendDialogueMessage('argon', I18N[gameState.lang].argon.stageHints.mount);
    updateHudTranslations();
    void syncMissionTelemetry();
    return data;
  } catch (err) {
    btn.disabled = !gameState.designConfirmed;
    showAlert(err.message, () => generateActual3DReflector(customOptions));
    return { error: true, message: err.message };
  }
}

document.getElementById('generate-3d-btn').addEventListener('click', () => {
  void generateActual3DReflector();
});

document.getElementById('equip-mount-btn').addEventListener('click', () => {
  mountActiveReflectorOnPedestal();
  triggerStoryLine('mounted');
  void syncMissionTelemetry();
});

// Reflector Angle Controls & Smooth Sliders
function clampAngle(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function adjustReflectorAngle(dYaw, dPitch) {
  gameState.mountedYawRad = Number(
    clampAngle(gameState.mountedYawRad + dYaw, -0.85, 0.85).toFixed(4)
  );
  gameState.mountedPitchRad = Number(
    clampAngle(gameState.mountedPitchRad + dPitch, -0.75, 0.75).toFixed(4)
  );
  updateOpticalPuzzle();
}

const yawSliderEl = document.getElementById('yaw-slider');
const pitchSliderEl = document.getElementById('pitch-slider');
if (yawSliderEl) {
  yawSliderEl.min = '-0.85';
  yawSliderEl.max = '0.85';
  yawSliderEl.step = '0.005';
  yawSliderEl.value = String(gameState.mountedYawRad);
  yawSliderEl.addEventListener('input', (e) => {
    gameState.mountedYawRad = Number(parseFloat(e.target.value).toFixed(4));
    updateOpticalPuzzle();
  });
}
if (pitchSliderEl) {
  pitchSliderEl.min = '-0.75';
  pitchSliderEl.max = '0.75';
  pitchSliderEl.step = '0.005';
  pitchSliderEl.value = String(gameState.mountedPitchRad);
  pitchSliderEl.addEventListener('input', (e) => {
    gameState.mountedPitchRad = Number(parseFloat(e.target.value).toFixed(4));
    updateOpticalPuzzle();
  });
}

// Directional Hint & Fine Assist (Guides direction and steps closer WITHOUT auto-completing the puzzle)
document.getElementById('align-assist-btn').addEventListener('click', () => {
  gameState.hintActive = true;
  const dYaw = TARGET_YAW_RAD - gameState.mountedYawRad;
  const dPitch = TARGET_PITCH_RAD - gameState.mountedPitchRad;
  const distRad = Math.hypot(dYaw, dPitch);
  // Minimum residual angle ~0.048 rad (~5.4 deg optical beam error, outside the 2.8 deg lock threshold)
  const minStopRad = 0.048;
  if (distRad > minStopRad) {
    const newDistRad = Math.max(minStopRad, distRad * 0.52);
    const ratio = (distRad - newDistRad) / distRad;
    gameState.mountedYawRad = Number((gameState.mountedYawRad + dYaw * ratio).toFixed(4));
    gameState.mountedPitchRad = Number((gameState.mountedPitchRad + dPitch * ratio).toFixed(4));
  }
  updateOpticalPuzzle();
  const hintMsg = getAlignmentDirectionHint();
  appendDialogueMessage('argon', hintMsg);
});

// Start or Advance to Ground Station Pass Window ("📡 교신 구간 시작" / "⏭ 다음 교신 구간으로 이동")
function startOrAdvanceToPassWindow() {
  void ensureBgmPlaying();
  gameState.passStarted = true;
  gameState.passActiveMode = true;
  gameState.passMissed = false;
  // Position Suncatcher 3.5 seconds before entering the pass window [1.05, 1.95]
  const approachSeconds = 3.5;
  orbitSim.orbitAngleRad = normalizePosAngle(
    PASS_CONFIG.passStartRad - PASS_CONFIG.passOrbitRateRadPerSec * approachSeconds
  );
  gameState.inPassWindow = false;
  gameState.passCountdownSec = approachSeconds;
  gameState.passRemainingSec =
    (PASS_CONFIG.passEndRad - PASS_CONFIG.passStartRad) / PASS_CONFIG.passOrbitRateRadPerSec;

  triggerStoryLine('passApproaching');
  updateInSceneMonitorScreen(player.hoverTarget === 'monitor');
  if (gameState.orbitMonitorOpen) {
    updateOrbitMonitorHudLabels();
    renderOrbitMonitorFrame(performance.now() * 0.001);
  }
  updateHudTranslations();
  void syncMissionTelemetry();
}

const startPassBtn = document.getElementById('start-pass-btn');
if (startPassBtn) {
  startPassBtn.addEventListener('click', () => {
    startOrAdvanceToPassWindow();
  });
}

const nextPassBtn = document.getElementById('next-pass-btn');
if (nextPassBtn) {
  nextPassBtn.addEventListener('click', () => {
    startOrAdvanceToPassWindow();
  });
}

// Return Inside Base via Open Airlock ("🚪 에어록으로 기지 귀환" or 3D Airlock interaction / walk-through)
function startReturnToBase() {
  if (!gameState.groundAckReceived || !gameState.doorOpened) {
    const lockedMsg =
      gameState.lang === 'en'
        ? 'Airlock sealed: Transmit 100% of the rescue request and await Ground Control approval.'
        : '에어록 잠김: 구조 요청을 100% 송신하고 지상 관제의 귀환 승인을 받아야 열립니다.';
    appendDialogueMessage('argon', lockedMsg);
    return false;
  }
  if (gameState.returnedToBase || gameState.returningInProgress) return true;

  gameState.returningInProgress = true;
  gameState.reviewingAlignAfterComplete = false;
  if (gameState.orbitMonitorOpen) {
    closeOrbitMonitor();
  }
  updateHudTranslations();

  // Smoothly walk player camera through the open airlock archway into the pressurized station interior
  player.camTween = {
    startPos: player.position.clone(),
    endPos: new THREE.Vector3(2.15, WORK_ZONE.eyeHeight, -6.38),
    startYaw: player.yaw,
    endYaw: 0.0,
    startPitch: player.pitch,
    endPitch: -0.03,
    elapsed: 0,
    duration: 1.0,
  };

  setTimeout(() => {
    gameState.returningInProgress = false;
    gameState.returnedToBase = true;
    triggerStoryLine('returnedComplete');
    updateHudTranslations();
    void syncMissionTelemetry();
  }, 1020);
  return true;
}

const returnBaseBtn = document.getElementById('return-base-btn');
if (returnBaseBtn) {
  returnBaseBtn.addEventListener('click', () => {
    startReturnToBase();
  });
}

const lblAirlockEl = document.getElementById('label-airlock');
if (lblAirlockEl) {
  lblAirlockEl.addEventListener('click', (e) => {
    e.stopPropagation();
    startReturnToBase();
  });
}

// Guided Demo Mode inside Help Modal (Demonstrates the full Final Transmission story flow)
async function runGuidedAutoPlay() {
  if (gameState.autoPlayActive) return;
  gameState.autoPlayActive = true;
  document.getElementById('guide-modal')?.classList.remove('open');
  updateHudTranslations();
  await ensureBgmPlaying();

  try {
    if (!gameState.designConfirmed) {
      await confirmCurrentDesign();
      await new Promise((r) => setTimeout(r, 400));
    }
    if (!gameState.loadedReflectorObject) {
      await generateActual3DReflector({ fastMode: true });
      await new Promise((r) => setTimeout(r, 400));
    }
    if (!gameState.reflectorMounted) {
      mountActiveReflectorOnPedestal();
      await new Promise((r) => setTimeout(r, 450));
    }
    const startYaw = gameState.mountedYawRad;
    const startPitch = gameState.mountedPitchRad;
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      gameState.mountedYawRad = Number(
        (startYaw + (TARGET_YAW_RAD - startYaw) * ease).toFixed(4)
      );
      gameState.mountedPitchRad = Number(
        (startPitch + (TARGET_PITCH_RAD - startPitch) * ease).toFixed(4)
      );
      updateOpticalPuzzle();
      await new Promise((r) => setTimeout(r, 35));
    }
    if (!gameState.txCompleted) {
      startOrAdvanceToPassWindow();
      orbitSim.orbitAngleRad = PASS_CONFIG.passStartRad + 0.04;
    }
  } finally {
    gameState.autoPlayActive = false;
    updateHudTranslations();
  }
}

const autoPlayBtn = document.getElementById('autoplay-btn');
if (autoPlayBtn) {
  autoPlayBtn.addEventListener('click', () => {
    void runGuidedAutoPlay();
  });
}

// ============================================================================
// Singleton 3D Orbit & Solar System Monitor Modal View
// Supports:
//  - 'earth' mode: 3D Earth + Suncatcher 650km Orbit + 3D Moon & Lunar Orbit + 3D Sun + Live Solar System PiP Mini-Map
//  - 'solar' mode: Interactive 3D Solar System Orrery (Sun + 8 Planets + Earth/Moon/Suncatcher + Saturn Rings + Asteroid Belt)
// ============================================================================
const orbitMonitorView = {
  initialized: false,
  renderer: null,
  scene: null,
  camera: null,
  pipCamera: null,
  earthSystemGroup: null,
  earthSpinGroup: null,
  cloudMesh: null,
  orbitPlaneGroup: null,
  markerGroup: null,
  markerPulseHalo: null,
  directionArrow: null,
  nadirLineGeom: null,
  moonOrbitPlaneGroup: null,
  moonGroup: null,
  moonMesh: null,
  monitorSunGroup: null,
  monitorSunMesh: null,
  monitorSunCorona: null,
  solarSystemGroup: null,
  solarSunMesh: null,
  solarSunCorona: null,
  asteroidBelt: null,
  planetEntries: [],
  solarEarthGroup: null,
  solarMoonPivot: null,
  solarSuncatcherPivot: null,
  solarSuncatcherMarker: null,
  planetLabelEls: {},
  orbitRadius: 2.16,
  moonOrbitRadius: 3.32,
  earthRadius: 1.56,
  markerWorldPos: new THREE.Vector3(),
  markerScreenPos: { x: 0, y: 0 },
  solarCam: {
    azimuth: 0.0,
    elevation: 0.56,
    distance: 9.8,
    dragging: false,
    lastX: 0,
    lastY: 0,
  },
};

function initOrbitMonitor3DView() {
  if (orbitMonitorView.initialized) return;
  const omCanvas = document.getElementById('orbit-monitor-canvas');
  if (!omCanvas) return;

  const omRenderer = new THREE.WebGLRenderer({
    canvas: omCanvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  omRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  omRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  omRenderer.toneMappingExposure = 1.22;

  const omScene = new THREE.Scene();
  omScene.background = new THREE.Color(0x020712);

  // Main Camera
  const omCamera = new THREE.PerspectiveCamera(42, 16 / 10, 0.1, 120);
  omCamera.position.set(0, 1.65, 6.25);
  omCamera.lookAt(0, 0, 0);

  // PiP Camera for live Solar System Mini-Map in 'earth' mode
  const pipCamera = new THREE.PerspectiveCamera(40, 190 / 122, 0.1, 120);
  pipCamera.position.set(0, 5.8, 8.6);
  pipCamera.lookAt(0, -0.2, 0);

  // Background stars inside the Orbit Monitor
  const starCount = 520;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 22 + (i % 19) * 1.5;
    const theta = i * 2.39996;
    const phi = Math.acos(1 - (2 * (i + 0.5)) / starCount);
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPos[i * 3 + 2] = r * Math.cos(phi);
  }
  const starGeom = new THREE.BufferGeometry();
  starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  omScene.add(
    new THREE.Points(starGeom, new THREE.PointsMaterial({ color: 0xbae6fd, size: 0.08 }))
  );

  // Shared Lighting
  omScene.add(new THREE.AmbientLight(0x6488b8, 1.2));
  const omSun = new THREE.DirectionalLight(0xfff4dc, 2.75);
  omSun.position.set(-8, 4.5, 6);
  omScene.add(omSun);
  const omRim = new THREE.DirectionalLight(0x38bdf8, 1.35);
  omRim.position.set(7, -3, -5);
  omScene.add(omRim);

  // ==========================================================================
  // GROUP A: 3D Earth 650km Orbit + 3D Moon + 3D Sun Backdrop ('earth' mode)
  // ==========================================================================
  const earthSystemGroup = new THREE.Group();
  earthSystemGroup.name = 'OrbitMonitorEarthSystemGroup';
  omScene.add(earthSystemGroup);

  // 1. 3D Earth (Spins on its polar axis via orbitSim.earthSpinRad)
  const earthSpinGroup = new THREE.Group();
  earthSpinGroup.name = 'OrbitMonitorEarthSpinGroup';
  earthSpinGroup.rotation.z = 0.22;
  earthSystemGroup.add(earthSpinGroup);

  const globeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(orbitMonitorView.earthRadius, 56, 56),
    new THREE.MeshStandardMaterial({
      map: earthLayers.surfTex,
      roughness: 0.58,
      metalness: 0.14,
    })
  );
  earthSpinGroup.add(globeMesh);

  const globeCityMesh = new THREE.Mesh(
    new THREE.SphereGeometry(orbitMonitorView.earthRadius + 0.008, 48, 48),
    new THREE.MeshBasicMaterial({
      map: earthLayers.cityTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  earthSpinGroup.add(globeCityMesh);

  const globeCloudMesh = new THREE.Mesh(
    new THREE.SphereGeometry(orbitMonitorView.earthRadius + 0.025, 48, 48),
    new THREE.MeshStandardMaterial({
      map: earthLayers.cloudTex,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    })
  );
  earthSpinGroup.add(globeCloudMesh);

  const atmoHalo = new THREE.Mesh(
    new THREE.SphereGeometry(orbitMonitorView.earthRadius + 0.09, 48, 48),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.16,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  earthSystemGroup.add(atmoHalo);

  // 2. Suncatcher 650km Inclined 3D Orbital Track Line
  const orbitPlaneGroup = new THREE.Group();
  orbitPlaneGroup.name = 'SuncatcherSingleOrbitPlane';
  orbitPlaneGroup.rotation.x = 0.54;
  orbitPlaneGroup.rotation.z = -0.34;
  earthSystemGroup.add(orbitPlaneGroup);

  const R = orbitMonitorView.orbitRadius;
  const curvePts = [];
  const segments = 128;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    curvePts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
  }
  const orbitCurve = new THREE.CatmullRomCurve3(curvePts, true);
  const orbitTrackTube = new THREE.Mesh(
    new THREE.TubeGeometry(orbitCurve, 128, 0.028, 12, true),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.92,
    })
  );
  orbitPlaneGroup.add(orbitTrackTube);

  const nadirGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(R, 0, 0),
  ]);
  const nadirLine = new THREE.Line(
    nadirGeom,
    new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.65,
    })
  );
  orbitPlaneGroup.add(nadirLine);

  // 3. Moving Suncatcher Current-Position Marker + Forward Velocity Cone
  const markerGroup = new THREE.Group();
  markerGroup.name = 'SuncatcherOrbitMarker';
  orbitPlaneGroup.add(markerGroup);

  const markerCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.095, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xfde047 })
  );
  const markerPulseHalo = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 20, 20),
    new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  markerGroup.add(markerCore, markerPulseHalo);

  const arrowGeom = new THREE.ConeGeometry(0.075, 0.24, 16);
  arrowGeom.rotateX(Math.PI / 2);
  const directionArrow = new THREE.Mesh(
    arrowGeom,
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
  );
  orbitPlaneGroup.add(directionArrow);

  // 4. 3D Moon (🌙 달) & Inclined Lunar Orbit Track around Earth
  const moonOrbitPlaneGroup = new THREE.Group();
  moonOrbitPlaneGroup.name = 'OrbitMonitorMoonPlane';
  moonOrbitPlaneGroup.rotation.x = 0.24;
  moonOrbitPlaneGroup.rotation.z = 0.15;
  earthSystemGroup.add(moonOrbitPlaneGroup);

  const moonR = orbitMonitorView.moonOrbitRadius;
  const moonCurvePts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    moonCurvePts.push(new THREE.Vector3(Math.cos(a) * moonR, 0, Math.sin(a) * moonR));
  }
  const moonOrbitCurve = new THREE.CatmullRomCurve3(moonCurvePts, true);
  const moonOrbitTube = new THREE.Mesh(
    new THREE.TubeGeometry(moonOrbitCurve, 128, 0.014, 8, true),
    new THREE.MeshBasicMaterial({
      color: 0xcbd5e1,
      transparent: true,
      opacity: 0.48,
    })
  );
  moonOrbitPlaneGroup.add(moonOrbitTube);

  const moonGroup = new THREE.Group();
  moonGroup.name = 'OrbitMonitorMoonGroup';
  moonOrbitPlaneGroup.add(moonGroup);

  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 36, 36),
    new THREE.MeshStandardMaterial({
      map: celestialSky.moonTex,
      roughness: 0.85,
      metalness: 0.05,
      emissive: new THREE.Color(0x1e293b),
      emissiveIntensity: 0.35,
    })
  );
  const moonHalo = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 24, 24),
    new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  moonGroup.add(moonMesh, moonHalo);

  // 5. 3D Sun (☀️ 태양) in the Earth Monitor Backdrop
  const monitorSunGroup = new THREE.Group();
  monitorSunGroup.name = 'OrbitMonitorSunBackdrop';
  monitorSunGroup.position.set(-4.35, 2.15, -4.2);
  earthSystemGroup.add(monitorSunGroup);

  const monitorSunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.56, 36, 36),
    new THREE.MeshBasicMaterial({ map: celestialSky.sunTex })
  );
  const monitorSunCorona = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  const monitorSunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: celestialSky.coronaTex,
      color: 0xffedd5,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  monitorSunSprite.scale.set(2.7, 2.7, 1);
  monitorSunGroup.add(monitorSunMesh, monitorSunCorona, monitorSunSprite);

  // ==========================================================================
  // GROUP B: Full 3D Solar System Orrery ('solar' mode + Live PiP Mini-Map)
  // ==========================================================================
  const solarSystemGroup = new THREE.Group();
  solarSystemGroup.name = 'OrbitMonitorSolarSystemOrrery';
  solarSystemGroup.visible = false;
  omScene.add(solarSystemGroup);

  // Central 3D Sun of the Solar System
  const solarSunGroup = new THREE.Group();
  solarSunGroup.name = 'SolarSystemCentralSun';
  solarSystemGroup.add(solarSunGroup);

  const solarSunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 44, 44),
    new THREE.MeshBasicMaterial({ map: celestialSky.sunTex })
  );
  const solarSunCorona = new THREE.Mesh(
    new THREE.SphereGeometry(0.86, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  const solarSunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: celestialSky.coronaTex,
      color: 0xfffbeb,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  solarSunSprite.scale.set(3.2, 3.2, 1);
  const solarPointLight = new THREE.PointLight(0xfff7ed, 3.2, 35, 0.5);
  solarSunGroup.add(solarSunMesh, solarSunCorona, solarSunSprite, solarPointLight);

  // Asteroid Belt between Mars (r=2.42) and Jupiter (r=3.15)
  const astCount = 260;
  const astPos = new Float32Array(astCount * 3);
  for (let i = 0; i < astCount; i++) {
    const a = (i / astCount) * Math.PI * 2 + (i % 7) * 0.13;
    const rad = 2.74 + ((i * 19) % 13) * 0.011;
    const yOff = (((i * 11) % 9) - 4) * 0.018;
    astPos[i * 3] = Math.cos(a) * rad;
    astPos[i * 3 + 1] = yOff;
    astPos[i * 3 + 2] = Math.sin(a) * rad;
  }
  const astGeom = new THREE.BufferGeometry();
  astGeom.setAttribute('position', new THREE.BufferAttribute(astPos, 3));
  const asteroidBelt = new THREE.Points(
    astGeom,
    new THREE.PointsMaterial({
      color: 0x94a3b8,
      size: 0.045,
      transparent: true,
      opacity: 0.72,
    })
  );
  solarSystemGroup.add(asteroidBelt);

  // Build All 8 Planets + Orbital Rings + Subsystems (Earth+Moon+Suncatcher, Saturn Rings, Uranus Ring)
  const planetEntries = [];
  for (const p of orbitSim.planets) {
    const orbitRingPts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      orbitRingPts.push(
        new THREE.Vector3(Math.cos(a) * p.orbitRadius, 0, Math.sin(a) * p.orbitRadius)
      );
    }
    const ringCurve = new THREE.CatmullRomCurve3(orbitRingPts, true);
    const isEarth = p.key === 'earth';
    const ringTube = new THREE.Mesh(
      new THREE.TubeGeometry(ringCurve, 120, isEarth ? 0.018 : 0.011, 8, true),
      new THREE.MeshBasicMaterial({
        color: isEarth ? 0x38bdf8 : p.color,
        transparent: true,
        opacity: isEarth ? 0.78 : 0.36,
      })
    );
    solarSystemGroup.add(ringTube);

    const pGroup = new THREE.Group();
    pGroup.name = `SolarPlanet_${p.key}`;
    solarSystemGroup.add(pGroup);

    let pMat;
    if (p.key === 'earth') {
      pMat = new THREE.MeshStandardMaterial({
        map: earthLayers.surfTex,
        roughness: 0.5,
        metalness: 0.1,
        emissive: new THREE.Color(0x0ea5e9),
        emissiveIntensity: 0.22,
      });
    } else if (p.key === 'jupiter') {
      pMat = new THREE.MeshStandardMaterial({
        map: celestialSky.jupiterTex,
        roughness: 0.6,
        emissive: new THREE.Color(0x78350f),
        emissiveIntensity: 0.18,
      });
    } else if (p.key === 'saturn') {
      pMat = new THREE.MeshStandardMaterial({
        map: celestialSky.saturnTex,
        roughness: 0.6,
        emissive: new THREE.Color(0x713f12),
        emissiveIntensity: 0.18,
      });
    } else {
      pMat = new THREE.MeshStandardMaterial({
        color: p.color,
        roughness: 0.55,
        metalness: 0.12,
        emissive: new THREE.Color(p.color),
        emissiveIntensity: 0.25,
      });
    }

    const pMesh = new THREE.Mesh(new THREE.SphereGeometry(p.size, 28, 28), pMat);
    const pHalo = new THREE.Mesh(
      new THREE.SphereGeometry(p.size * 1.32, 20, 20),
      new THREE.MeshBasicMaterial({
        color: p.color,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    pGroup.add(pMesh, pHalo);

    if (p.hasRings || p.hasThinRing || p.hasRing) {
      const ringInner = p.size * 1.38;
      const ringOuter = p.size * (p.key === 'saturn' ? 2.45 : 1.85);
      const pRing = new THREE.Mesh(
        new THREE.RingGeometry(ringInner, ringOuter, 48),
        new THREE.MeshBasicMaterial({
          map: p.key === 'saturn' ? celestialSky.saturnRingTex : null,
          color: p.key === 'saturn' ? 0xfde68a : 0x7dd3fc,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: p.key === 'saturn' ? 0.85 : 0.45,
        })
      );
      pRing.rotation.x = p.key === 'saturn' ? Math.PI * 0.42 : Math.PI * 0.15;
      pRing.rotation.y = 0.25;
      pGroup.add(pRing);
    }

    // Special subsystems on Earth inside the Solar System Orrery: Moon + Suncatcher 650km Orbit
    if (isEarth) {
      const miniMoonOrbitPts = [];
      const miniMoonR = 0.34;
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        miniMoonOrbitPts.push(
          new THREE.Vector3(Math.cos(a) * miniMoonR, 0, Math.sin(a) * miniMoonR)
        );
      }
      const miniMoonRing = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(miniMoonOrbitPts),
        new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.65 })
      );
      miniMoonRing.rotation.x = 0.22;
      pGroup.add(miniMoonRing);

      const solarMoonPivot = new THREE.Group();
      solarMoonPivot.rotation.x = 0.22;
      const solarMoonMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 16, 16),
        new THREE.MeshBasicMaterial({ map: celestialSky.moonTex })
      );
      solarMoonMesh.position.set(miniMoonR, 0, 0);
      solarMoonPivot.add(solarMoonMesh);
      pGroup.add(solarMoonPivot);

      // Mini Suncatcher 650km orbit ring + golden marker around Earth in Solar System view
      const miniScPts = [];
      const miniScR = 0.21;
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        miniScPts.push(new THREE.Vector3(Math.cos(a) * miniScR, 0, Math.sin(a) * miniScR));
      }
      const miniScRing = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(miniScPts),
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 })
      );
      miniScRing.rotation.x = 0.54;
      miniScRing.rotation.z = -0.34;
      pGroup.add(miniScRing);

      const solarSuncatcherPivot = new THREE.Group();
      solarSuncatcherPivot.rotation.x = 0.54;
      solarSuncatcherPivot.rotation.z = -0.34;
      const solarSuncatcherMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.042, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xfde047 })
      );
      solarSuncatcherMarker.position.set(miniScR, 0, 0);
      solarSuncatcherPivot.add(solarSuncatcherMarker);
      pGroup.add(solarSuncatcherPivot);

      orbitMonitorView.solarEarthGroup = pGroup;
      orbitMonitorView.solarMoonPivot = solarMoonPivot;
      orbitMonitorView.solarSuncatcherPivot = solarSuncatcherPivot;
      orbitMonitorView.solarSuncatcherMarker = solarSuncatcherMarker;
    }

    planetEntries.push({
      data: p,
      group: pGroup,
      mesh: pMesh,
    });
  }

  // Build floating 2D planet label DOM elements inside #orbit-planet-labels
  const labelsContainer = document.getElementById('orbit-planet-labels');
  if (labelsContainer) {
    labelsContainer.innerHTML = '';
    const allLabelKeys = [
      'sun',
      'mercury',
      'venus',
      'earth',
      'moon',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ];
    for (const key of allLabelKeys) {
      const tag = document.createElement('div');
      tag.className = `orbit-planet-tag${
        key === 'sun' ? ' is-sun' : key === 'earth' ? ' is-earth' : key === 'moon' ? ' is-moon' : ''
      }`;
      tag.id = `orbit-planet-tag-${key}`;
      labelsContainer.appendChild(tag);
      orbitMonitorView.planetLabelEls[key] = tag;
    }
  }

  // Interactive Orbit Camera Drag & Wheel Zoom inside #orbit-monitor-canvas
  omCanvas.addEventListener('pointerdown', (e) => {
    orbitMonitorView.solarCam.dragging = true;
    orbitMonitorView.solarCam.lastX = e.clientX;
    orbitMonitorView.solarCam.lastY = e.clientY;
    try {
      omCanvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  });
  omCanvas.addEventListener('pointermove', (e) => {
    if (!orbitMonitorView.solarCam.dragging) return;
    const dx = e.clientX - orbitMonitorView.solarCam.lastX;
    const dy = e.clientY - orbitMonitorView.solarCam.lastY;
    orbitMonitorView.solarCam.lastX = e.clientX;
    orbitMonitorView.solarCam.lastY = e.clientY;
    orbitMonitorView.solarCam.azimuth -= dx * 0.0055;
    orbitMonitorView.solarCam.elevation = Math.max(
      0.18,
      Math.min(1.38, orbitMonitorView.solarCam.elevation + dy * 0.0045)
    );
  });
  const stopOmDrag = (e) => {
    orbitMonitorView.solarCam.dragging = false;
    try {
      if (e?.pointerId !== undefined) omCanvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };
  omCanvas.addEventListener('pointerup', stopOmDrag);
  omCanvas.addEventListener('pointercancel', stopOmDrag);
  omCanvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      orbitMonitorView.solarCam.distance = Math.max(
        5.5,
        Math.min(15.5, orbitMonitorView.solarCam.distance + (e.deltaY > 0 ? 0.55 : -0.55))
      );
    },
    { passive: false }
  );

  orbitMonitorView.initialized = true;
  orbitMonitorView.renderer = omRenderer;
  orbitMonitorView.scene = omScene;
  orbitMonitorView.camera = omCamera;
  orbitMonitorView.pipCamera = pipCamera;
  orbitMonitorView.earthSystemGroup = earthSystemGroup;
  orbitMonitorView.earthSpinGroup = earthSpinGroup;
  orbitMonitorView.cloudMesh = globeCloudMesh;
  orbitMonitorView.orbitPlaneGroup = orbitPlaneGroup;
  orbitMonitorView.markerGroup = markerGroup;
  orbitMonitorView.markerPulseHalo = markerPulseHalo;
  orbitMonitorView.directionArrow = directionArrow;
  orbitMonitorView.nadirLineGeom = nadirGeom;
  orbitMonitorView.moonOrbitPlaneGroup = moonOrbitPlaneGroup;
  orbitMonitorView.moonGroup = moonGroup;
  orbitMonitorView.moonMesh = moonMesh;
  orbitMonitorView.monitorSunGroup = monitorSunGroup;
  orbitMonitorView.monitorSunMesh = monitorSunMesh;
  orbitMonitorView.monitorSunCorona = monitorSunCorona;
  orbitMonitorView.solarSystemGroup = solarSystemGroup;
  orbitMonitorView.solarSunMesh = solarSunMesh;
  orbitMonitorView.solarSunCorona = solarSunCorona;
  orbitMonitorView.asteroidBelt = asteroidBelt;
  orbitMonitorView.planetEntries = planetEntries;
}

function resizeOrbitMonitorRenderer() {
  if (!orbitMonitorView.initialized || !orbitMonitorView.renderer) return;
  const vp = document.getElementById('orbit-monitor-viewport');
  if (!vp) return;
  const w = Math.max(320, vp.clientWidth || 680);
  const h = Math.max(220, vp.clientHeight || 425);
  orbitMonitorView.camera.aspect = w / h;
  orbitMonitorView.camera.updateProjectionMatrix();
  orbitMonitorView.renderer.setSize(w, h, false);
}

// Advance Shared Orbital & Solar System Simulation State & Synchronize Out-the-Window 3D Sky
function stepOrbitSimulation(dt) {
  orbitSim.simTimeSec += dt * orbitSim.timeScale;
  orbitSim.orbitAngleRad =
    (orbitSim.orbitAngleRad + dt * orbitSim.orbitRateRadPerRealSec) % (Math.PI * 2);
  orbitSim.earthSpinRad =
    (orbitSim.earthSpinRad + dt * orbitSim.earthSpinRateRadPerRealSec) % (Math.PI * 2);
  orbitSim.cloudDriftRad =
    (orbitSim.cloudDriftRad + dt * orbitSim.earthSpinRateRadPerRealSec * 1.28) %
    (Math.PI * 2);
  orbitSim.moonOrbitAngleRad =
    (orbitSim.moonOrbitAngleRad + dt * orbitSim.moonOrbitRateRadPerRealSec) %
    (Math.PI * 2);
  orbitSim.moonSpinRad = (orbitSim.moonSpinRad + dt * 0.025) % (Math.PI * 2);
  orbitSim.sunSpinRad = (orbitSim.sunSpinRad + dt * 0.018) % (Math.PI * 2);

  for (const p of orbitSim.planets) {
    p.angle = (p.angle + dt * p.speed) % (Math.PI * 2);
  }

  // 1) Synchronize Main Scene Out-the-Window 3D Earth with orbitSim state
  earthLayers.orbitalTrackPitchGroup.rotation.x = -orbitSim.orbitAngleRad;
  earthLayers.earthAxialSpinGroup.rotation.y = orbitSim.earthSpinRad;
  earthLayers.cloudMesh.rotation.y = orbitSim.cloudDriftRad - orbitSim.earthSpinRad;

  // 2) Synchronize Main Scene Out-the-Window 3D Sun, 3D Moon, and Ecliptic Solar System Planets
  if (celestialSky) {
    celestialSky.sunCoreMesh.rotation.y = orbitSim.sunSpinRad;
    const sunPulse = 28 + Math.sin(orbitSim.simTimeSec * 0.04) * 1.4;
    celestialSky.sunCoronaSprite.scale.set(sunPulse, sunPulse, 1);

    // Visible orbital motion of the 3D Moon along its inclined 3D sky lunar orbit ring
    const mPhase = orbitSim.moonOrbitAngleRad;
    const mR = celestialSky.moonSkyOrbitRadius;
    celestialSky.moonBodyGroup.position.set(
      Math.cos(mPhase) * mR,
      0,
      Math.sin(mPhase) * mR
    );
    celestialSky.moonMesh.rotation.y = orbitSim.moonSpinRad;

    // Gentle orbital drift & axial spin of Ecliptic Solar System Planets in the sky
    for (let i = 0; i < celestialSky.skyPlanets.length; i++) {
      const sp = celestialSky.skyPlanets[i];
      const pSim = orbitSim.planets.find((pl) => pl.key === sp.key);
      const tShift = pSim ? Math.sin(pSim.angle) * 0.015 : 0;
      const t = Math.max(0.02, Math.min(0.98, sp.baseT + tShift));
      const pt = celestialSky.eclipticCurve.getPoint(t);
      sp.group.position.copy(pt);
      sp.mesh.rotation.y += dt * 0.25;
    }
  }

  // Keep the in-scene 3D monitor screen canvas updated with Sun, Moon, Earth & Suncatcher
  updateInSceneMonitorScreen(player.hoverTarget === 'monitor');
}

// Helper to project a 3D world position to 2D viewport pixel coordinates inside #orbit-monitor-viewport
const omTempWorldVec = new THREE.Vector3();
const omPlanetTempVec = new THREE.Vector3();

function projectToMonitorViewport(worldVec, cameraObj, vpW, vpH) {
  omPlanetTempVec.copy(worldVec).project(cameraObj);
  return {
    x: (omPlanetTempVec.x * 0.5 + 0.5) * vpW,
    y: (-omPlanetTempVec.y * 0.5 + 0.5) * vpH,
    visible: omPlanetTempVec.z > -1 && omPlanetTempVec.z < 1,
  };
}

// Render 1 Frame of the 3D Orbit & Solar System Monitor Modal (Called ONLY when gameState.orbitMonitorOpen === true)
function renderOrbitMonitorFrame(nowSec = 0) {
  if (!gameState.orbitMonitorOpen) return;
  initOrbitMonitor3DView();
  if (!orbitMonitorView.initialized) return;

  const vp = document.getElementById('orbit-monitor-viewport');
  const w = vp ? vp.clientWidth || 680 : 680;
  const h = vp ? vp.clientHeight || 425 : 425;
  const isSolarMode = orbitSim.orbitViewMode === 'solar';
  const planetNames =
    I18N[gameState.lang]?.orbitMonitor?.planets || I18N.ko.orbitMonitor.planets;

  // --------------------------------------------------------------------------
  // Update Group A: 3D Earth + Suncatcher 650km Orbit + 3D Moon + 3D Sun
  // --------------------------------------------------------------------------
  const R = orbitMonitorView.orbitRadius;
  const angle = orbitSim.orbitAngleRad;

  orbitMonitorView.earthSpinGroup.rotation.y = orbitSim.earthSpinRad;
  orbitMonitorView.cloudMesh.rotation.y =
    orbitSim.cloudDriftRad - orbitSim.earthSpinRad;

  const mx = Math.cos(angle) * R;
  const mz = Math.sin(angle) * R;
  orbitMonitorView.markerGroup.position.set(mx, 0, mz);

  const pulseScale = 1 + Math.sin(nowSec * 5.0) * 0.18;
  orbitMonitorView.markerPulseHalo.scale.setScalar(pulseScale);

  const posAttr = orbitMonitorView.nadirLineGeom.getAttribute('position');
  const surfR = orbitMonitorView.earthRadius;
  posAttr.setXYZ(0, Math.cos(angle) * surfR, 0, Math.sin(angle) * surfR);
  posAttr.setXYZ(1, mx, 0, mz);
  posAttr.needsUpdate = true;

  const aheadAngle = angle + 0.14;
  const ax = Math.cos(aheadAngle) * R;
  const az = Math.sin(aheadAngle) * R;
  orbitMonitorView.directionArrow.position.set(ax, 0, az);
  const tangentTarget = new THREE.Vector3(
    ax - Math.sin(aheadAngle) * 0.5,
    0,
    az + Math.cos(aheadAngle) * 0.5
  );
  orbitMonitorView.orbitPlaneGroup.localToWorld(tangentTarget);
  orbitMonitorView.directionArrow.lookAt(tangentTarget);

  // Update 3D Moon on its Lunar Orbit around Earth
  const moonR = orbitMonitorView.moonOrbitRadius;
  const mAngle = orbitSim.moonOrbitAngleRad;
  orbitMonitorView.moonGroup.position.set(
    Math.cos(mAngle) * moonR,
    0,
    Math.sin(mAngle) * moonR
  );
  orbitMonitorView.moonMesh.rotation.y = orbitSim.moonSpinRad;

  // Update 3D Sun in the Earth Monitor Backdrop
  orbitMonitorView.monitorSunMesh.rotation.y = orbitSim.sunSpinRad;
  orbitMonitorView.monitorSunCorona.scale.setScalar(1 + Math.sin(nowSec * 3.2) * 0.08);

  // --------------------------------------------------------------------------
  // Update Group B: Full 3D Solar System Orrery (Sun + 8 Planets + Subsystems)
  // --------------------------------------------------------------------------
  orbitMonitorView.solarSunMesh.rotation.y = orbitSim.sunSpinRad;
  orbitMonitorView.solarSunCorona.scale.setScalar(1 + Math.sin(nowSec * 3.5) * 0.08);
  orbitMonitorView.asteroidBelt.rotation.y = orbitSim.simTimeSec * 0.0004;

  for (const entry of orbitMonitorView.planetEntries) {
    const p = entry.data;
    const px = Math.cos(p.angle) * p.orbitRadius;
    const pz = Math.sin(p.angle) * p.orbitRadius;
    entry.group.position.set(px, 0, pz);
    entry.mesh.rotation.y = orbitSim.earthSpinRad * 0.8;
  }

  if (orbitMonitorView.solarMoonPivot) {
    orbitMonitorView.solarMoonPivot.rotation.y = -orbitSim.moonOrbitAngleRad;
  }
  if (orbitMonitorView.solarSuncatcherPivot) {
    orbitMonitorView.solarSuncatcherPivot.rotation.y = -orbitSim.orbitAngleRad;
  }

  // --------------------------------------------------------------------------
  // Render Pass 1: Main Viewport ('earth' mode OR 'solar' mode)
  // --------------------------------------------------------------------------
  const pipBadgeEl = document.getElementById('orbit-solar-pip-badge');

  if (!isSolarMode) {
    orbitMonitorView.earthSystemGroup.visible = true;
    orbitMonitorView.solarSystemGroup.visible = false;

    orbitMonitorView.camera.position.set(0, 1.65, 6.25);
    orbitMonitorView.camera.lookAt(0, 0, 0);
    orbitMonitorView.scene.updateMatrixWorld(true);

    orbitMonitorView.renderer.setViewport(0, 0, w, h);
    orbitMonitorView.renderer.setScissorTest(false);
    orbitMonitorView.renderer.render(orbitMonitorView.scene, orbitMonitorView.camera);

    // Project 3D Suncatcher Marker to 2D floating label
    orbitMonitorView.markerGroup.getWorldPosition(omTempWorldVec);
    orbitMonitorView.markerWorldPos.copy(omTempWorldVec);
    omTempWorldVec.project(orbitMonitorView.camera);
    const sx = (omTempWorldVec.x * 0.5 + 0.5) * w;
    const sy = (-omTempWorldVec.y * 0.5 + 0.5) * h;
    orbitMonitorView.markerScreenPos = { x: Number(sx.toFixed(1)), y: Number(sy.toFixed(1)) };
    const labelEl = document.getElementById('orbit-marker-label');
    if (labelEl) {
      labelEl.style.left = `${sx}px`;
      labelEl.style.top = `${sy}px`;
    }

    // Show floating 2D tags for 3D Sun (☀️ 태양) and 3D Moon (🌙 달) in 'earth' mode
    for (const [key, el] of Object.entries(orbitMonitorView.planetLabelEls)) {
      if (key === 'sun') {
        orbitMonitorView.monitorSunGroup.getWorldPosition(omPlanetTempVec);
        const pt = projectToMonitorViewport(omPlanetTempVec, orbitMonitorView.camera, w, h);
        el.textContent = `☀️ ${planetNames.sun}`;
        el.style.left = `${pt.x}px`;
        el.style.top = `${pt.y - 26}px`;
        el.style.display = pt.visible ? 'block' : 'none';
      } else if (key === 'moon') {
        orbitMonitorView.moonGroup.getWorldPosition(omPlanetTempVec);
        const pt = projectToMonitorViewport(omPlanetTempVec, orbitMonitorView.camera, w, h);
        el.textContent = `🌙 ${planetNames.moon}`;
        el.style.left = `${pt.x}px`;
        el.style.top = `${pt.y - 20}px`;
        el.style.display = pt.visible ? 'block' : 'none';
      } else {
        el.style.display = 'none';
      }
    }

    // ------------------------------------------------------------------------
    // Render Pass 2 (PiP Inset): Live 3D Solar System Mini-Map in bottom-right
    // ------------------------------------------------------------------------
    const pipW = Math.min(200, Math.round(w * 0.28));
    const pipH = Math.min(126, Math.round(h * 0.28));
    const pipX = w - pipW - 12;
    const pipY = 12; // Bottom-right in WebGL coordinates (Y=0 is bottom)

    orbitMonitorView.earthSystemGroup.visible = false;
    orbitMonitorView.solarSystemGroup.visible = true;
    orbitMonitorView.pipCamera.aspect = pipW / pipH;
    orbitMonitorView.pipCamera.updateProjectionMatrix();
    orbitMonitorView.scene.updateMatrixWorld(true);

    orbitMonitorView.renderer.setViewport(pipX, pipY, pipW, pipH);
    orbitMonitorView.renderer.setScissor(pipX, pipY, pipW, pipH);
    orbitMonitorView.renderer.setScissorTest(true);
    orbitMonitorView.renderer.render(orbitMonitorView.scene, orbitMonitorView.pipCamera);

    // Restore default state for 'earth' mode
    orbitMonitorView.renderer.setScissorTest(false);
    orbitMonitorView.renderer.setViewport(0, 0, w, h);
    orbitMonitorView.earthSystemGroup.visible = true;
    orbitMonitorView.solarSystemGroup.visible = false;
    if (pipBadgeEl) pipBadgeEl.style.display = 'block';
  } else {
    // ------------------------------------------------------------------------
    // Full-Screen 3D Solar System Orrery Mode ('solar' mode)
    // ------------------------------------------------------------------------
    orbitMonitorView.earthSystemGroup.visible = false;
    orbitMonitorView.solarSystemGroup.visible = true;
    if (pipBadgeEl) pipBadgeEl.style.display = 'none';

    const sc = orbitMonitorView.solarCam;
    const camX = Math.sin(sc.azimuth) * Math.cos(sc.elevation) * sc.distance;
    const camY = Math.sin(sc.elevation) * sc.distance;
    const camZ = Math.cos(sc.azimuth) * Math.cos(sc.elevation) * sc.distance;
    orbitMonitorView.camera.position.set(camX, camY, camZ);
    orbitMonitorView.camera.lookAt(0, -0.15, 0);
    orbitMonitorView.scene.updateMatrixWorld(true);

    orbitMonitorView.renderer.setViewport(0, 0, w, h);
    orbitMonitorView.renderer.setScissorTest(false);
    orbitMonitorView.renderer.render(orbitMonitorView.scene, orbitMonitorView.camera);

    // Project Suncatcher marker around Earth in Solar System mode
    if (orbitMonitorView.solarSuncatcherMarker) {
      orbitMonitorView.solarSuncatcherMarker.getWorldPosition(omTempWorldVec);
      orbitMonitorView.markerWorldPos.copy(omTempWorldVec);
      omTempWorldVec.project(orbitMonitorView.camera);
      const sx = (omTempWorldVec.x * 0.5 + 0.5) * w;
      const sy = (-omTempWorldVec.y * 0.5 + 0.5) * h;
      orbitMonitorView.markerScreenPos = { x: Number(sx.toFixed(1)), y: Number(sy.toFixed(1)) };
      const labelEl = document.getElementById('orbit-marker-label');
      if (labelEl) {
        labelEl.style.left = `${sx}px`;
        labelEl.style.top = `${sy}px`;
      }
    }

    // Project Floating 2D Labels for Sun + All 8 Planets + Moon
    const sunTag = orbitMonitorView.planetLabelEls.sun;
    if (sunTag) {
      const pt = projectToMonitorViewport(
        new THREE.Vector3(0, 0.72, 0),
        orbitMonitorView.camera,
        w,
        h
      );
      sunTag.textContent = `☀️ ${planetNames.sun}`;
      sunTag.style.left = `${pt.x}px`;
      sunTag.style.top = `${pt.y}px`;
      sunTag.style.display = pt.visible ? 'block' : 'none';
    }

    const moonTag = orbitMonitorView.planetLabelEls.moon;
    if (moonTag) {
      moonTag.style.display = 'none';
    }

    for (const entry of orbitMonitorView.planetEntries) {
      const key = entry.data.key;
      const tag = orbitMonitorView.planetLabelEls[key];
      if (!tag) continue;
      entry.group.getWorldPosition(omPlanetTempVec);
      omPlanetTempVec.y += entry.data.size + 0.16;
      const pt = projectToMonitorViewport(omPlanetTempVec, orbitMonitorView.camera, w, h);
      if (key === 'earth') {
        tag.textContent = `🌍 ${planetNames.earth} + 🌙 ${planetNames.moon}`;
      } else if (key === 'saturn') {
        tag.textContent = `🪐 ${planetNames.saturn}`;
      } else {
        tag.textContent = planetNames[key] || key;
      }
      tag.style.left = `${pt.x}px`;
      tag.style.top = `${pt.y}px`;
      tag.style.display = pt.visible ? 'block' : 'none';
    }
  }

  orbitSim.monitorRenderFrames += 1;
}

function setOrbitMonitorMode(mode) {
  if (mode !== 'earth' && mode !== 'solar') return;
  orbitSim.orbitViewMode = mode;
  updateHudTranslations();
  if (gameState.orbitMonitorOpen) {
    renderOrbitMonitorFrame(performance.now() * 0.001);
  }
}

function clearActiveInputsAndDrag() {
  endMouseDrag();
  player.keys.w = false;
  player.keys.a = false;
  player.keys.s = false;
  player.keys.d = false;
  player.alignKeys.yawLeft = false;
  player.alignKeys.yawRight = false;
  player.alignKeys.pitchDown = false;
  player.alignKeys.pitchUp = false;
}

function openOrbitMonitor(preferredMode = 'earth') {
  void ensureBgmPlaying();
  clearActiveInputsAndDrag();

  if (preferredMode === 'earth' || preferredMode === 'solar') {
    orbitSim.orbitViewMode = preferredMode;
  }

  // Release Pointer Lock if active when opening the monitor
  if (document.pointerLockElement) {
    try {
      document.exitPointerLock?.();
    } catch {
      // Ignore
    }
  }

  if (!gameState.orbitMonitorOpen) {
    gameState.orbitMonitorOpen = true;
    orbitSim.openCount += 1;
  }

  const modal = document.getElementById('orbit-modal');
  if (modal) modal.classList.add('open');

  initOrbitMonitor3DView();
  resizeOrbitMonitorRenderer();
  renderOrbitMonitorFrame(performance.now() * 0.001);
  updateHudTranslations();
}

function closeOrbitMonitor() {
  if (!gameState.orbitMonitorOpen) return;
  gameState.orbitMonitorOpen = false;
  clearActiveInputsAndDrag();

  const modal = document.getElementById('orbit-modal');
  if (modal) modal.classList.remove('open');

  // Intentionally do NOT re-lock Pointer Lock on close
  updateHudTranslations();
}

const lblOrbitMonitorBtn = document.getElementById('label-orbit-monitor');
if (lblOrbitMonitorBtn) {
  lblOrbitMonitorBtn.addEventListener('mouseenter', () => {
    player.hoverTarget = 'monitor';
    updateInSceneMonitorScreen(true);
    updateSceneHintText();
  });
  lblOrbitMonitorBtn.addEventListener('mouseleave', () => {
    if (player.hoverTarget === 'monitor') {
      player.hoverTarget = null;
      updateInSceneMonitorScreen(false);
      updateSceneHintText();
    }
  });
  lblOrbitMonitorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openOrbitMonitor('earth');
  });
}

// Sky Labels for Sun, Moon, and Solar System open the 3D Monitor directly
const lblSunBtn = document.getElementById('label-sun');
if (lblSunBtn) {
  lblSunBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openOrbitMonitor('solar');
  });
}

const lblMoonBtn = document.getElementById('label-moon');
if (lblMoonBtn) {
  lblMoonBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openOrbitMonitor('earth');
  });
}

const lblSolarSystemBtn = document.getElementById('label-solar-system');
if (lblSolarSystemBtn) {
  lblSolarSystemBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openOrbitMonitor('solar');
  });
}

// Mode Switch Buttons inside Orbit Monitor Header & PiP Badge
const modeEarthBtn = document.getElementById('orbit-mode-earth-btn');
if (modeEarthBtn) {
  modeEarthBtn.addEventListener('click', () => setOrbitMonitorMode('earth'));
}
const modeSolarBtn = document.getElementById('orbit-mode-solar-btn');
if (modeSolarBtn) {
  modeSolarBtn.addEventListener('click', () => setOrbitMonitorMode('solar'));
}
const solarPipBadge = document.getElementById('orbit-solar-pip-badge');
if (solarPipBadge) {
  solarPipBadge.addEventListener('click', () => {
    setOrbitMonitorMode(orbitSim.orbitViewMode === 'solar' ? 'earth' : 'solar');
  });
}

const closeOrbitModalBtn = document.getElementById('close-orbit-modal-btn');
if (closeOrbitModalBtn) {
  closeOrbitModalBtn.addEventListener('click', () => {
    closeOrbitMonitor();
  });
}

// Keyboard Controls (Supports both physical e.code and Korean IME Jamo)
window.addEventListener('keydown', (e) => {
  if (gameState.orbitMonitorOpen) {
    if (e.key === 'Escape' || e.code === 'Escape') {
      e.preventDefault();
      closeOrbitMonitor();
    }
    return;
  }

  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }

  const code = e.code || '';
  const k = (e.key || '').toLowerCase();

  if (code === 'KeyW' || code === 'ArrowUp' || k === 'w' || k === 'ㅈ') {
    player.camTween = null;
    player.keys.w = true;
  }
  if (code === 'KeyA' || code === 'ArrowLeft' || k === 'a' || k === 'ㅁ') {
    player.camTween = null;
    player.keys.a = true;
  }
  if (code === 'KeyS' || code === 'ArrowDown' || k === 's' || k === 'ㄴ') {
    player.camTween = null;
    player.keys.s = true;
  }
  if (code === 'KeyD' || code === 'ArrowRight' || k === 'd' || k === 'ㅇ') {
    player.camTween = null;
    player.keys.d = true;
  }

  if (code === 'Space' || k === ' ') {
    e.preventDefault();
    player.camTween = null;
    if (player.isGrounded) {
      player.velocityY = 4.6;
      player.isGrounded = false;
    }
  }
  if (code === 'KeyV' || k === 'v' || k === 'ㅍ') triggerVoiceInput();
  if (code === 'KeyE' || k === 'e' || k === 'ㄷ') mountActiveReflectorOnPedestal();
  if (code === 'KeyC' || k === 'c' || k === 'ㅊ') resetCameraToStageFocus();

  if (code === 'KeyQ' || k === 'q' || k === 'ㅂ') {
    player.alignKeys.yawLeft = true;
    if (!e.repeat) adjustReflectorAngle(-0.035, 0);
  }
  if (code === 'KeyR' || k === 'r' || k === 'ㄱ') {
    player.alignKeys.yawRight = true;
    if (!e.repeat) adjustReflectorAngle(0.035, 0);
  }
  if (code === 'KeyF' || k === 'f' || k === 'ㄹ') {
    player.alignKeys.pitchDown = true;
    if (!e.repeat) adjustReflectorAngle(0, -0.035);
  }
  if (code === 'KeyG' || k === 'g' || k === 'ㅎ') {
    player.alignKeys.pitchUp = true;
    if (!e.repeat) adjustReflectorAngle(0, 0.035);
  }
});

window.addEventListener('keyup', (e) => {
  const code = e.code || '';
  const k = (e.key || '').toLowerCase();

  if (code === 'KeyW' || code === 'ArrowUp' || k === 'w' || k === 'ㅈ') player.keys.w = false;
  if (code === 'KeyA' || code === 'ArrowLeft' || k === 'a' || k === 'ㅁ') player.keys.a = false;
  if (code === 'KeyS' || code === 'ArrowDown' || k === 's' || k === 'ㄴ') player.keys.s = false;
  if (code === 'KeyD' || code === 'ArrowRight' || k === 'd' || k === 'ㅇ') player.keys.d = false;

  if (code === 'KeyQ' || k === 'q' || k === 'ㅂ') player.alignKeys.yawLeft = false;
  if (code === 'KeyR' || k === 'r' || k === 'ㄱ') player.alignKeys.yawRight = false;
  if (code === 'KeyF' || k === 'f' || k === 'ㄹ') player.alignKeys.pitchDown = false;
  if (code === 'KeyG' || k === 'g' || k === 'ㅎ') player.alignKeys.pitchUp = false;
});

// Direct 3D Mouse Look & Reflector Dragging
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

const mouseDrag = {
  active: false,
  mode: 'look',
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  movedDist: 0,
  clickedTarget: null,
};

function getSceneTargetAtClientPos(clientX, clientY) {
  pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);

  const monitorHits = raycaster.intersectObjects([orbitMonitorGroup], true);
  if (monitorHits.length > 0) return 'monitor';

  const mountHits = raycaster.intersectObjects(
    [reflectorMountPivot, mountPedestalGroup],
    true
  );
  if (mountHits.length > 0) return 'mount';

  const argonHits = raycaster.intersectObjects([argonDrone], true);
  if (argonHits.length > 0) return 'argon';

  return null;
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (gameState.orbitMonitorOpen) return;
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur?.();
  }
  void ensureBgmPlaying();

  if (document.pointerLockElement === canvas) return;

  const hitTarget = getSceneTargetAtClientPos(e.clientX, e.clientY);
  mouseDrag.active = true;
  mouseDrag.startX = e.clientX;
  mouseDrag.startY = e.clientY;
  mouseDrag.lastX = e.clientX;
  mouseDrag.lastY = e.clientY;
  mouseDrag.movedDist = 0;
  mouseDrag.clickedTarget = hitTarget;

  if (e.button === 2 || e.shiftKey || (hitTarget === 'mount' && gameState.reflectorMounted)) {
    mouseDrag.mode = 'reflector';
  } else {
    mouseDrag.mode = 'look';
    player.camTween = null;
  }

  canvas.classList.add('dragging');
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // Ignore
  }
});

window.addEventListener('pointermove', (e) => {
  if (gameState.orbitMonitorOpen) return;

  if (document.pointerLockElement === canvas) {
    if (e.buttons === 2 || e.shiftKey) {
      adjustReflectorAngle(e.movementX * 0.0025, -e.movementY * 0.0025);
    } else {
      player.yaw -= e.movementX * 0.0024;
      player.pitch = clampAngle(
        player.pitch - e.movementY * 0.0024,
        -Math.PI / 2.3,
        Math.PI / 2.3
      );
    }
    return;
  }

  if (mouseDrag.active) {
    const dx = e.clientX - mouseDrag.lastX;
    const dy = e.clientY - mouseDrag.lastY;
    mouseDrag.lastX = e.clientX;
    mouseDrag.lastY = e.clientY;
    mouseDrag.movedDist += Math.hypot(dx, dy);

    if (mouseDrag.mode === 'reflector') {
      adjustReflectorAngle(dx * 0.0032, -dy * 0.0032);
    } else {
      player.yaw -= dx * 0.0032;
      player.pitch = clampAngle(
        player.pitch - dy * 0.0032,
        -Math.PI / 2.3,
        Math.PI / 2.3
      );
    }
    return;
  }

  if (e.target === canvas) {
    const hovered = getSceneTargetAtClientPos(e.clientX, e.clientY);
    if (hovered !== player.hoverTarget) {
      player.hoverTarget = hovered;
      canvas.style.cursor = hovered ? 'pointer' : 'grab';
      updateInSceneMonitorScreen(hovered === 'monitor');
      updateSceneHintText();
    }
  }
});

function endMouseDrag(e) {
  if (!mouseDrag.active) return;
  mouseDrag.active = false;
  canvas.classList.remove('dragging');
  try {
    if (e?.pointerId !== undefined) canvas.releasePointerCapture(e.pointerId);
  } catch {
    // Ignore
  }

  if (mouseDrag.movedDist < 6) {
    if (mouseDrag.clickedTarget === 'monitor') {
      openOrbitMonitor();
    } else if (
      mouseDrag.clickedTarget === 'mount' &&
      gameState.loadedReflectorObject &&
      !gameState.reflectorMounted
    ) {
      mountActiveReflectorOnPedestal();
    } else if (mouseDrag.clickedTarget === 'argon') {
      triggerVoiceInput();
    }
  }
}

window.addEventListener('pointerup', endMouseDrag);
window.addEventListener('pointercancel', endMouseDrag);

canvas.addEventListener(
  'wheel',
  (e) => {
    if (gameState.orbitMonitorOpen) return;
    e.preventDefault();
    if (e.shiftKey) {
      adjustReflectorAngle(e.deltaY > 0 ? -0.02 : 0.02, 0);
      return;
    }
    player.camTween = null;
    const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const step = e.deltaY < 0 ? 0.55 : -0.55;
    player.position.addScaledVector(forward, step);
    stepPlayerPhysics(0.016);
  },
  { passive: false }
);

function stepPlayerPhysics(dt) {
  if (player.camTween) {
    player.camTween.elapsed += dt;
    const t = Math.min(1, player.camTween.elapsed / player.camTween.duration);
    const ease = 1 - Math.pow(1 - t, 3);
    player.position.lerpVectors(player.camTween.startPos, player.camTween.endPos, ease);
    player.yaw =
      player.camTween.startYaw +
      (player.camTween.endYaw - player.camTween.startYaw) * ease;
    player.pitch =
      player.camTween.startPitch +
      (player.camTween.endPitch - player.camTween.startPitch) * ease;
    if (t >= 1) player.camTween = null;
  }

  if (!gameState.orbitMonitorOpen) {
    const speed = 5.4;
    const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));

    const move = new THREE.Vector3();
    if (player.keys.w) move.add(forward);
    if (player.keys.s) move.sub(forward);
    if (player.keys.d) move.add(right);
    if (player.keys.a) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      player.position.add(move);
    }

    // Smooth continuous reflector rotation when holding Q/R/F/G
    const alignRate = 0.6 * dt;
    let dYaw = 0;
    let dPitch = 0;
    if (player.alignKeys.yawLeft) dYaw -= alignRate;
    if (player.alignKeys.yawRight) dYaw += alignRate;
    if (player.alignKeys.pitchDown) dPitch -= alignRate;
    if (player.alignKeys.pitchUp) dPitch += alignRate;
    if (dYaw !== 0 || dPitch !== 0) {
      adjustReflectorAngle(dYaw, dPitch);
    }
  }

  if (!player.isGrounded) {
    player.position.y += player.velocityY * dt;
    player.velocityY -= 9.2 * dt;
    if (player.position.y <= WORK_ZONE.eyeHeight) {
      player.position.y = WORK_ZONE.eyeHeight;
      player.velocityY = 0;
      player.isGrounded = true;
    }
  }

  // Enforce Allowed EVA Work Zone Bounds
  let clamped = false;
  if (player.position.x < WORK_ZONE.minX) {
    player.position.x = WORK_ZONE.minX;
    clamped = true;
  } else if (player.position.x > WORK_ZONE.maxX) {
    player.position.x = WORK_ZONE.maxX;
    clamped = true;
  }
  if (player.position.z < WORK_ZONE.minZ) {
    player.position.z = WORK_ZONE.minZ;
    clamped = true;
  } else if (player.position.z > WORK_ZONE.maxZ) {
    player.position.z = WORK_ZONE.maxZ;
    clamped = true;
  }
  player.clampedByBoundary = clamped;

  camera.position.copy(player.position);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  const coordsEl = document.getElementById('player-coords-badge');
  if (coordsEl) {
    coordsEl.textContent = `X:${player.position.x.toFixed(1)} Z:${player.position.z.toFixed(1)}`;
  }
}

// Animate Photon Pulses along Incident & Reflected Beams
function animateBeamPulses(beamObj, nowSec, speed = 0.65) {
  if (!beamObj.group.visible) return;
  const count = beamObj.pulses.length;
  for (let i = 0; i < count; i++) {
    const frac = (nowSec * speed + i / count) % 1;
    beamObj.pulses[i].position.lerpVectors(beamObj.start, beamObj.end, frac);
  }
}

// Single Unified Main Render Loop (Never duplicated when opening/closing the Orbit Monitor)
let lastTime = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const nowSec = now * 0.001;

  stepOrbitSimulation(dt);
  stepPlayerPhysics(dt);

  // Subtle Argon drone motion
  argonDrone.position.y = 2.45 + Math.sin(now * 0.0025) * 0.06;
  argonRing.rotation.z = now * 0.0015;
  argonRing.rotation.x = Math.sin(now * 0.001) * 0.35;

  // Animate light pulses along both optical beams
  animateBeamPulses(incidentBeam, nowSec, 0.72);
  animateBeamPulses(reflectedBeam, nowSec, gameState.receiverAligned ? 0.95 : 0.55);

  // Airlock Gate Opening Animation when Optical Link is Restored
  if (gameState.doorOpened && gameState.doorOpenProgress < 1) {
    gameState.doorOpenProgress = Math.min(1, gameState.doorOpenProgress + dt * 1.4);
    leftDoorPanel.position.x = -0.96 - gameState.doorOpenProgress * 1.55;
    rightDoorPanel.position.x = 0.96 + gameState.doorOpenProgress * 1.55;
  }

  updateWorldLabels();
  renderer.render(scene, camera);

  // Render Orbit Monitor 3D view ONLY when open (paused when closed while orbitSim continues)
  if (gameState.orbitMonitorOpen) {
    renderOrbitMonitorFrame(nowSec);
  }
}

// Initialize Game State from Backend
async function initGame() {
  const res = await fetch('/api/state');
  const s = await res.json();
  if (s.sessionId) {
    gameState.sessionId = s.sessionId;
  }
  gameState.lang = s.lang || 'en';
  gameState.activeDesignVersion = s.activeDesignVersion;
  gameState.designConfirmed = s.designConfirmed;
  gameState.approvedDesignVersion = s.approvedDesignVersion;
  gameState.designPreview = s.designPreview;

  if (s.designPreview) {
    document.getElementById('design-preview-img').src = s.designPreview.imageUrl;
    document.getElementById('design-summary-thumb').src = s.designPreview.imageUrl;
    document.getElementById('gen-summary-thumb').src = s.designPreview.imageUrl;
    document.getElementById('design-summary-desc').textContent = s.designPreview.description;
    document.getElementById('design-desc-input').value = s.designPreview.description;
  }

  if (s.provenanceSummary) {
    const provEl = document.getElementById('provenance-box');
    if (provEl) {
      provEl.innerHTML =
        `• <strong>GCP:</strong> ${s.provenanceSummary.gcpProject}<br/>` +
        `• <strong>Argon:</strong> ${s.provenanceSummary.companionDialogue.status}<br/>` +
        `• <strong>Preview:</strong> ${s.provenanceSummary.designPreview.requestedModel}<br/>` +
        `• <strong>3D Mesh:</strong> ${s.provenanceSummary.reflector3D.method}<br/>` +
        `• <strong>BGM:</strong> ${s.provenanceSummary.bgm.status}`;
    }
  }

  // Load initial Lyria Playlist & Prompt Pool
  try {
    const lyriaRes = await fetch('/api/lyria/status');
    if (lyriaRes.ok) {
      const lyriaStatus = await lyriaRes.json();
      if (Array.isArray(lyriaStatus.promptPool) && lyriaStatus.promptPool.length > 0) {
        gameState.lyriaPromptPool = lyriaStatus.promptPool;
      }
      if (Array.isArray(lyriaStatus.playlist) && lyriaStatus.playlist.length > 0) {
        gameState.lyriaPlaylist = lyriaStatus.playlist;
        playLyriaPlaylistTrack(0, false);
      } else {
        renderLyriaPlaylistQueue();
      }
    }
  } catch (_err) {
    renderLyriaPlaylistQueue();
  }

  appendDialogueMessage('argon', I18N[gameState.lang].argon.welcome);
  stepOrbitSimulation(0.016);
  stepPlayerPhysics(0.016);
  updateOpticalPuzzle();
  updateHudTranslations();
  updateWorldLabels();
  renderer.render(scene, camera);
  if (!orbitSim.mainLoopStarted) {
    orbitSim.mainLoopStarted = true;
    orbitSim.renderLoopCount += 1;
    requestAnimationFrame(animate);
  }
}
void initGame();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (gameState.orbitMonitorOpen) {
    resizeOrbitMonitorRenderer();
    renderOrbitMonitorFrame(performance.now() * 0.001);
  }
});

// Expose comprehensive test & verification interface for Playwright E2E checks
window.__suncatcherTest = {
  getState: () => ({
    lang: gameState.lang,
    uiStage: getCurrentUiStage(),
    designDrawerOpen: gameState.designDrawerOpen,
    orbitMonitorOpen: gameState.orbitMonitorOpen,
    activeDesignVersion: gameState.activeDesignVersion,
    designConfirmed: gameState.designConfirmed,
    approvedDesignVersion: gameState.approvedDesignVersion,
    activeReflectorMeta: gameState.activeReflectorMeta,
    reflectorMounted: gameState.reflectorMounted,
    mountedYawRad: gameState.mountedYawRad,
    mountedPitchRad: gameState.mountedPitchRad,
    targetYawRad: TARGET_YAW_RAD,
    targetPitchRad: TARGET_PITCH_RAD,
    beamAngleErrorDeg: gameState.beamAngleErrorDeg,
    receiverAligned: gameState.receiverAligned,
    receiverColorHex: gameState.receiverColorHex,
    commsRestored: gameState.commsRestored,
    doorOpened: gameState.doorOpened,
    doorOpenProgress: gameState.doorOpenProgress,
    leftDoorX: leftDoorPanel.position.x,
    rightDoorX: rightDoorPanel.position.x,
    bgmVolume: gameState.bgmVolume,
    bgmDucked: gameState.bgmDucked,
    bgmPlaylistMode: gameState.bgmPlaylistMode,
    lyriaPlaylistCount: gameState.lyriaPlaylist.length,
    lyriaCurrentTrackIndex: gameState.lyriaCurrentTrackIndex,
    argonSpeaking: gameState.argonSpeaking,
    player: {
      position: player.position.toArray(),
      yaw: player.yaw,
      pitch: player.pitch,
      isGrounded: player.isGrounded,
      clampedByBoundary: player.clampedByBoundary,
    },
  }),
  getOrbitState: () => ({
    orbitMonitorOpen: gameState.orbitMonitorOpen,
    orbitViewMode: orbitSim.orbitViewMode,
    altitudeKm: orbitSim.altitudeKm,
    inclinationDeg: orbitSim.inclinationDeg,
    timeScale: orbitSim.timeScale,
    simTimeSec: Number(orbitSim.simTimeSec.toFixed(2)),
    orbitAngleRad: Number(orbitSim.orbitAngleRad.toFixed(4)),
    orbitAngleDeg: Number(((orbitSim.orbitAngleRad * 180) / Math.PI).toFixed(2)),
    earthSpinRad: Number(orbitSim.earthSpinRad.toFixed(4)),
    earthSpinDeg: Number(((orbitSim.earthSpinRad * 180) / Math.PI).toFixed(2)),
    moonOrbitAngleRad: Number(orbitSim.moonOrbitAngleRad.toFixed(4)),
    sunSpinRad: Number(orbitSim.sunSpinRad.toFixed(4)),
    outWindowEarthPitchRad: Number(earthLayers.orbitalTrackPitchGroup.rotation.x.toFixed(4)),
    outWindowEarthSpinRad: Number(earthLayers.earthAxialSpinGroup.rotation.y.toFixed(4)),
    monitorEarthSpinRad: orbitMonitorView.earthSpinGroup
      ? Number(orbitMonitorView.earthSpinGroup.rotation.y.toFixed(4))
      : null,
    monitorMoonPos: orbitMonitorView.moonGroup
      ? orbitMonitorView.moonGroup.position.toArray().map((v) => Number(v.toFixed(3)))
      : null,
    markerLocalPos: orbitMonitorView.markerGroup
      ? orbitMonitorView.markerGroup.position.toArray().map((v) => Number(v.toFixed(3)))
      : null,
    markerScreenPos: orbitMonitorView.markerScreenPos,
    planets: orbitSim.planets.map((p) => ({
      key: p.key,
      orbitRadius: p.orbitRadius,
      angleRad: Number(p.angle.toFixed(4)),
    })),
    openCount: orbitSim.openCount,
    monitorRenderFrames: orbitSim.monitorRenderFrames,
    renderLoopCount: orbitSim.renderLoopCount,
  }),
  openOrbitMonitor: (mode = 'earth') => {
    openOrbitMonitor(mode);
    return window.__suncatcherTest.getOrbitState();
  },
  setOrbitViewMode: (mode = 'solar') => {
    setOrbitMonitorMode(mode);
    return window.__suncatcherTest.getOrbitState();
  },
  closeOrbitMonitor: () => {
    closeOrbitMonitor();
    return window.__suncatcherTest.getOrbitState();
  },
  advanceOrbitSim: (dtSec = 1.0, steps = 1) => {
    for (let i = 0; i < steps; i++) {
      stepOrbitSimulation(dtSec);
    }
    renderer.render(scene, camera);
    if (gameState.orbitMonitorOpen) {
      renderOrbitMonitorFrame(performance.now() * 0.001);
    }
    return window.__suncatcherTest.getOrbitState();
  },
  getEarthVerification: () => ({
    orbitAltitudeKm: 650,
    orbitType: 'dawn-dusk-sun-synchronous',
    fixedMissionTimeUtc: '06:12:00Z',
    layersPresent: {
      surface: Boolean(earthLayers.surfaceMesh?.visible),
      nightCityLights: Boolean(earthLayers.cityLightsMesh?.visible),
      clouds: Boolean(earthLayers.cloudMesh?.visible),
      atmosphere: Boolean(earthLayers.atmosphereMesh?.visible),
      sun: Boolean(celestialSky?.sunCoreMesh?.visible),
      moon: Boolean(celestialSky?.moonMesh?.visible),
      solarSystemPlanets: (celestialSky?.skyPlanets?.length || 0) >= 6,
    },
  }),
  stepPhysics: (dtSec, count = 1) => {
    player.camTween = null;
    for (let i = 0; i < count; i++) stepPlayerPhysics(dtSec);
  },
  setLookAngles: (yaw, pitch) => {
    player.camTween = null;
    player.yaw = yaw;
    player.pitch = pitch;
    stepPlayerPhysics(0.016);
  },
  loadAndMountGLBDirect: async (meta) => {
    await loadGeneratedReflectorGLB(meta);
    mountActiveReflectorOnPedestal();
    return window.__suncatcherTest.getState();
  },
  setReflectorAngles: (yawRad, pitchRad) => {
    gameState.mountedYawRad = yawRad;
    gameState.mountedPitchRad = pitchRad;
    updateOpticalPuzzle();
    if (gameState.doorOpened) {
      gameState.doorOpenProgress = 1;
      leftDoorPanel.position.x = -0.96 - 1.55;
      rightDoorPanel.position.x = 0.96 + 1.55;
      renderer.render(scene, camera);
    }
    return window.__suncatcherTest.getState();
  },
  setArgonSpeaking: (speaking) => {
    setBgmDucked(speaking);
    return {
      bgmVolume: gameState.bgmVolume,
      bgmDucked: gameState.bgmDucked,
    };
  },
};

