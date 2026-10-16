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

// Unified Orbital Simulation State (Shared by Out-the-Window 3D Earth, In-Scene Monitor & 3D Orbit Modal)
// Backed by Real Satellite Orbit API (NORAD 100902 · PROJECT SUNCATCHER M1 · CelesTrak GP + SatelliteMap)
const MU_EARTH_KM3_S2 = 398600.4418;
const EARTH_RADIUS_KM = 6378.137;
const SECONDS_PER_DAY = 86400;
const EARTH_SIDEREAL_RAD_PER_SEC = (2 * Math.PI) / 86164.0905;

const orbitSim = {
  apiSynced: false,
  apiSource: 'celestrak-gp-live',
  noradId: 100902,
  objectName: 'PROJECT SUNCATCHER M1',
  objectId: '2026-227V',
  altitudeKm: 515.0,
  stationDesignAltitudeKm: 650,
  inclinationDeg: 97.4423,
  velocityKms: 7.61,
  periodMin: 94.92,
  latDeg: 18.42,
  lonDeg: 127.65,
  timeScale: 1, // Real-time 1x speed by default (can toggle 1x -> 10x -> 30x)
  simTimeSec: 0,
  virtualTimestampMs: Date.now(),
  initialArgOfLatitudeRad: null,
  initialGmstRad: null,
  orbitAngleRad: 0.72, // Anchored on front hemisphere so marker is always immediately visible
  earthSpinRad: 0.45,
  baseOrbitRateRadPerSec: (15.17120308 * 2 * Math.PI) / SECONDS_PER_DAY, // ~0.0011033 rad/s (0.0632 deg/s at 1x)
  baseEarthSpinRateRadPerSec: EARTH_SIDEREAL_RAD_PER_SEC,
  cloudDriftRad: 0,
  elements: {
    noradId: 100902,
    objectName: 'PROJECT SUNCATCHER M1',
    objectId: '2026-227V',
    epoch: '2026-10-15T22:17:51.238464',
    epochMs: Date.parse('2026-10-15T22:17:51.238464Z'),
    meanMotionRevPerDay: 15.17120308,
    eccentricity: 0.00023159,
    inclinationDeg: 97.4423,
    raanDeg: 358.1937,
    argOfPericenterDeg: 82.7922,
    meanAnomalyDeg: 277.3574,
  },
  openCount: 0,
  monitorRenderFrames: 0,
  mainLoopStarted: false,
  renderLoopCount: 0,
};

function normalizePosAngle(rad) {
  const twoPi = Math.PI * 2;
  return ((rad % twoPi) + twoPi) % twoPi;
}

function wrapDeg180Client(deg) {
  return (((deg + 180) % 360) + 360) % 360 - 180;
}

function propagateClientOrbit(elements, timestampMs) {
  const nRadPerSec = (elements.meanMotionRevPerDay * 2 * Math.PI) / SECONDS_PER_DAY;
  const semiMajorAxisKm = Math.cbrt(MU_EARTH_KM3_S2 / (nRadPerSec * nRadPerSec));
  const dtSec = (timestampMs - elements.epochMs) / 1000;

  const m0Rad = (elements.meanAnomalyDeg * Math.PI) / 180;
  const meanAnomalyRad = normalizePosAngle(m0Rad + nRadPerSec * dtSec);

  const e = elements.eccentricity;
  let E = meanAnomalyRad;
  for (let i = 0; i < 4; i++) {
    E = E - (E - e * Math.sin(E) - meanAnomalyRad) / (1 - e * Math.cos(E));
  }

  const trueAnomalyRad =
    2 *
    Math.atan2(
      Math.sqrt(1 + e) * Math.sin(E / 2),
      Math.sqrt(1 - e) * Math.cos(E / 2)
    );
  const argPericenterRad = (elements.argOfPericenterDeg * Math.PI) / 180;
  const argumentOfLatitudeRad = normalizePosAngle(argPericenterRad + trueAnomalyRad);

  const radiusKm = semiMajorAxisKm * (1 - e * Math.cos(E));
  const altitudeKm = radiusKm - EARTH_RADIUS_KM;
  const velocityKms = Math.sqrt(MU_EARTH_KM3_S2 * (2 / radiusKm - 1 / semiMajorAxisKm));

  const incRad = (elements.inclinationDeg * Math.PI) / 180;
  const raanRad = (elements.raanDeg * Math.PI) / 180;

  const xOrb = Math.cos(argumentOfLatitudeRad);
  const yOrb = Math.sin(argumentOfLatitudeRad);

  const xEci = xOrb * Math.cos(raanRad) - yOrb * Math.cos(incRad) * Math.sin(raanRad);
  const yEci = xOrb * Math.sin(raanRad) + yOrb * Math.cos(incRad) * Math.cos(raanRad);
  const zEci = yOrb * Math.sin(incRad);

  const jd = timestampMs / 86400000 + 2440587.5;
  const gmstDeg = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
  const gmstRad = normalizePosAngle((gmstDeg * Math.PI) / 180);

  const latRad = Math.asin(Math.max(-1, Math.min(1, zEci)));
  const lonRad = Math.atan2(yEci, xEci) - gmstRad;

  return {
    argumentOfLatitudeRad,
    gmstRad,
    latDeg: Number(((latRad * 180) / Math.PI).toFixed(2)),
    lonDeg: Number(wrapDeg180Client((lonRad * 180) / Math.PI).toFixed(2)),
    altitudeKm: Number(altitudeKm.toFixed(1)),
    velocityKms: Number(velocityKms.toFixed(2)),
  };
}

async function syncOrbitFromApi() {
  try {
    const res = await fetch('/api/orbit');
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.ok && data.elements) {
      orbitSim.apiSynced = true;
      orbitSim.apiSource = data.source || 'celestrak-gp-live';
      orbitSim.noradId = data.elements.noradId || 100902;
      orbitSim.objectName = data.elements.objectName || 'PROJECT SUNCATCHER M1';
      orbitSim.objectId = data.elements.objectId || '2026-227V';
      orbitSim.elements = data.elements;
      orbitSim.inclinationDeg = Number(data.elements.inclinationDeg.toFixed(2));
      orbitSim.baseOrbitRateRadPerSec =
        data.derived?.angularRateRadPerSec ||
        (data.elements.meanMotionRevPerDay * 2 * Math.PI) / SECONDS_PER_DAY;
      orbitSim.periodMin = data.derived?.periodMin || 94.92;

      const prop = propagateClientOrbit(orbitSim.elements, orbitSim.virtualTimestampMs);
      if (orbitSim.initialArgOfLatitudeRad === null) {
        orbitSim.initialArgOfLatitudeRad = prop.argumentOfLatitudeRad;
        orbitSim.initialGmstRad = prop.gmstRad;
      }
      orbitSim.latDeg = prop.latDeg;
      orbitSim.lonDeg = prop.lonDeg;
      orbitSim.altitudeKm = prop.altitudeKm;
      orbitSim.velocityKms = prop.velocityKms;
      updateOrbitMonitorHudLabels();
    }
  } catch {
    // Offline fallback uses preloaded NORAD 100902 elements
  }
}

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
  const inPass = typeof gameState !== 'undefined' && Boolean(gameState.inPassWindow);
  const txPct = typeof gameState !== 'undefined' ? Math.round(gameState.txProgress || 0) : 0;

  mctx.fillStyle = hovered ? '#071b34' : '#041022';
  mctx.fillRect(0, 0, 512, 320);

  // Border glow inside screen
  mctx.strokeStyle = inPass ? '#10b981' : hovered ? '#7dd3fc' : 'rgba(56, 189, 248, 0.55)';
  mctx.lineWidth = hovered || inPass ? 6 : 3;
  mctx.strokeRect(8, 8, 496, 304);

  // Stylized Earth Icon & Orbit Ring on the left side of the monitor screen
  const cx = 148;
  const cy = 162;
  const earthR = 64;

  const grad = mctx.createRadialGradient(cx - 18, cy - 18, 10, cx, cy, earthR);
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
    cx - 14 + Math.sin(orbitSim.earthSpinRad) * 16,
    cy - 12,
    22,
    14,
    0.3,
    0,
    Math.PI * 2
  );
  mctx.fill();
  mctx.beginPath();
  mctx.ellipse(
    cx + 18 - Math.cos(orbitSim.earthSpinRad) * 14,
    cy + 16,
    18,
    12,
    -0.25,
    0,
    Math.PI * 2
  );
  mctx.fill();

  // Inclined Orbit Ellipse around Earth icon + Green Pass Window Arc + Ground Station
  mctx.save();
  mctx.translate(cx, cy);
  mctx.rotate(-0.38);
  mctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
  mctx.lineWidth = 3.2;
  mctx.beginPath();
  mctx.ellipse(0, 0, 96, 44, 0, 0, Math.PI * 2);
  mctx.stroke();

  // Green Pass Window Arc [1.05 rad .. 1.95 rad]
  mctx.strokeStyle = inPass ? '#34d399' : '#10b981';
  mctx.lineWidth = inPass ? 7.5 : 5.5;
  mctx.beginPath();
  mctx.ellipse(0, 0, 96, 44, 0, 1.05, 1.95);
  mctx.stroke();

  // Ground Station Marker on Earth surface at 1.50 rad
  const gsx = Math.cos(1.5) * 52;
  const gsy = Math.sin(1.5) * 28;
  mctx.fillStyle = '#10b981';
  mctx.beginPath();
  mctx.arc(gsx, gsy, 5.5, 0, Math.PI * 2);
  mctx.fill();
  mctx.strokeStyle = '#a7f3d0';
  mctx.lineWidth = 1.8;
  mctx.stroke();

  // Moving Suncatcher Marker Dot on the monitor's mini orbit
  const mx = Math.cos(orbitSim.orbitAngleRad) * 96;
  const my = Math.sin(orbitSim.orbitAngleRad) * 44;
  mctx.fillStyle = inPass ? '#34d399' : '#fbbf24';
  mctx.beginPath();
  mctx.arc(mx, my, 8.5, 0, Math.PI * 2);
  mctx.fill();
  mctx.strokeStyle = '#ffffff';
  mctx.lineWidth = 2.5;
  mctx.stroke();
  mctx.restore();

  // Right-side Call-to-Action Text ("궤도 보기" / "Orbit View")
  mctx.fillStyle = inPass ? '#6ee7b7' : '#7dd3fc';
  mctx.font = 'bold 18px "Segoe UI", sans-serif';
  const passBadgeText = inPass
    ? isEn
      ? `PASS ACTIVE · TX ${txPct}%`
      : `교신 가능 구간 · 송신 ${txPct}%`
    : `NORAD ${orbitSim.noradId} · TX ${txPct}%`;
  mctx.fillText(passBadgeText, 256, 108);

  mctx.fillStyle = '#ffffff';
  mctx.font = 'bold 42px "Segoe UI", "Malgun Gothic", sans-serif';
  mctx.fillText(isEn ? '🌍 Orbit View' : '🌍 궤도 보기', 256, 166);

  mctx.fillStyle = hovered ? '#fde047' : '#bae6fd';
  mctx.font = 'bold 21px "Segoe UI", "Malgun Gothic", sans-serif';
  const speedTag = orbitSim.timeScale === 1 ? (isEn ? '1× LIVE' : '1× 실시간') : `${orbitSim.timeScale}×`;
  mctx.fillText(
    isEn ? `▶ Click to Open (${speedTag})` : `▶ 클릭하여 열기 (${speedTag})`,
    256,
    218
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

// Pass Window & Uplink Transmission Configuration ("마지막 교신 / The Final Transmission")
const PASS_CONFIG = {
  passStartRad: 1.05,
  passEndRad: 1.95,
  groundAngleRad: 1.5,
  windowDurationSec: 45,
  passOrbitRateRadPerSec: (1.95 - 1.05) / 45, // 0.02 rad/s during active pass mode
  approachSec: 5,
  txDurationSec: 12.0, // ~12 seconds of aligned beam inside pass window reaches 100%
};

// Game & Mission State
const gameState = {
  lang: 'ko',
  missionPhase: 'briefing', // 'briefing' | 'prep' | 'ready_for_pass' | 'pass_window' | 'transmitting' | 'ground_ack' | 'returning' | 'completed'
  briefingDone: false,
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
  passStarted: false,
  passActiveMode: false,
  inPassWindow: false,
  passMissed: false,
  passCountdownSec: 0,
  passRemainingSec: 0,
  txProgress: 0,
  txCompleted: false,
  groundAckReceived: false,
  returningInProgress: false,
  returnedToBase: false,
  commsRestored: false,
  doorOpened: false,
  doorOpenProgress: 0,
  hintActive: false,
  bgmPlaying: false,
  userMutedBgm: false,
  bgmVolume: 0.42,
  bgmDucked: false,
  argonSpeaking: false,
  lyriaModalOpen: false,
  lyriaGenerating: false,
  lyriaModel: 'lyria-3-clip-preview',
  lyriaAudioDataUrl: null,
  lyriaAudioUrl: '/audio/lyria-bgm-latest.mp3',
  lyriaLyricsText: '<instrumental>',
  autoPlayActive: false,
  reviewingAlignAfterComplete: false,
  lastRetryAction: null,
  triggeredStoryKeys: new Set(),
  groundAckTimerId: null,
};

// Audio / BGM (Gemini Lyria MP3 with Speech Ducking & WAV fallback)
const bgmAudio = new Audio('/audio/lyria-bgm-latest.mp3');
bgmAudio.loop = true;
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

function setBgmDucked(ducked) {
  gameState.bgmDucked = Boolean(ducked);
  gameState.argonSpeaking = Boolean(ducked);
  if (!gameState.userMutedBgm) {
    bgmAudio.volume = ducked ? 0.08 : 0.42;
  }
  gameState.bgmVolume = bgmAudio.volume;
  updateHudTranslations();
}

async function ensureBgmPlaying() {
  if (gameState.userMutedBgm) return;
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

// Determine Explicit 8-Step Story Mission Phase
// ('briefing' -> 'prep' -> 'ready_for_pass' -> 'pass_window' -> 'transmitting' -> 'ground_ack' -> 'returning' -> 'completed')
function getCurrentMissionPhase() {
  if (gameState.returnedToBase) return 'completed';
  if (gameState.returningInProgress) return 'returning';
  if (gameState.groundAckReceived) return 'ground_ack';
  if (gameState.reflectorMounted && gameState.loadedReflectorObject) {
    if (gameState.inPassWindow && gameState.receiverAligned && !gameState.txCompleted) {
      return 'transmitting';
    }
    if (gameState.inPassWindow) {
      return 'pass_window';
    }
    return 'ready_for_pass';
  }
  if (
    gameState.briefingDone ||
    gameState.designConfirmed ||
    gameState.designDrawerOpen ||
    Boolean(gameState.loadedReflectorObject)
  ) {
    return 'prep';
  }
  return 'briefing';
}

async function syncMissionTelemetry() {
  gameState.missionPhase = getCurrentMissionPhase();
  try {
    await fetch('/api/mission/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        missionPhase: gameState.missionPhase,
        reflectorMounted: gameState.reflectorMounted,
        receiverAligned: gameState.receiverAligned,
        passStarted: gameState.passStarted,
        passActiveMode: gameState.passActiveMode,
        txProgress: Number(gameState.txProgress.toFixed(1)),
        txCompleted: gameState.txCompleted,
        groundAckReceived: gameState.groundAckReceived,
        commsRestored: gameState.commsRestored,
        doorOpened: gameState.doorOpened,
        returnedToBase: gameState.returnedToBase,
        beamErrorDeg: gameState.beamAngleErrorDeg,
        mountedPitchRad: gameState.mountedPitchRad,
        mountedYawRad: gameState.mountedYawRad,
        orbitAngleRad: Number(orbitSim.orbitAngleRad.toFixed(4)),
      }),
    });
  } catch {
    // Ignore transient network errors
  }
}

function getAlignmentDirectionHint() {
  const t = I18N[gameState.lang];
  if (!t.alignHint) return '';
  if (gameState.receiverAligned) {
    return t.alignHint.locked;
  }
  const dYawDeg = ((TARGET_YAW_RAD - gameState.mountedYawRad) * 180) / Math.PI;
  const dPitchDeg = ((TARGET_PITCH_RAD - gameState.mountedPitchRad) * 180) / Math.PI;
  const yawPart =
    Math.abs(dYawDeg) < 0.4
      ? t.alignHint.yawOk
      : dYawDeg > 0
        ? t.alignHint.yawRight(Math.abs(dYawDeg).toFixed(1))
        : t.alignHint.yawLeft(Math.abs(dYawDeg).toFixed(1));
  const pitchPart =
    Math.abs(dPitchDeg) < 0.4
      ? t.alignHint.pitchOk
      : dPitchDeg > 0
        ? t.alignHint.pitchUp(Math.abs(dPitchDeg).toFixed(1))
        : t.alignHint.pitchDown(Math.abs(dPitchDeg).toFixed(1));
  const errStr =
    gameState.beamAngleErrorDeg !== null ? gameState.beamAngleErrorDeg.toFixed(1) : '--';
  return t.alignHint.adjustFormat(yawPart, pitchPart, errStr);
}

// Compute 3D Optical Reflection & Synchronize Beam + Station Uplink Relay + Airlock Gate State
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
    gameState.missionPhase = getCurrentMissionPhase();
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

  // Smooth proximity feedback as the player gets closer to the Station Uplink Relay
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

  const wasAligned = gameState.receiverAligned;
  gameState.receiverAligned = aligned;

  if (aligned) {
    gameState.receiverColorHex = '#06d6a0';
    receiverSensorMat.color.setHex(0x06d6a0);
    receiverSensorMat.emissive.setHex(0x10b981);
    receiverRingMat.color.setHex(0x10b981);
    receiverRingMat.emissive.setHex(0x059669);
    receiverGlowLight.color.setHex(0x10b981);
    receiverGlowLight.intensity = 4.5;

    if (!wasAligned) {
      triggerStoryLine('beamAligned');
      void syncMissionTelemetry();
    }
  } else {
    gameState.receiverColorHex = '#ff2a55';
    receiverSensorMat.color.setHex(0xff2a55);
    receiverSensorMat.emissive.setHex(0xff1e42);
    receiverRingMat.color.setHex(0xf43f5e);
    receiverRingMat.emissive.setHex(0xe11d48);
    receiverGlowLight.color.setHex(0xf43f5e);
    receiverGlowLight.intensity = 2.4;
  }

  // Airlock and Comms Restored depend on Ground Control Ack (100% rescue transmission), NOT mere beam alignment!
  // Once Ground Control Ack is received, the airlock remains unlocked even if reflector angles are adjusted later.
  if (gameState.groundAckReceived) {
    gameState.commsRestored = true;
    gameState.doorOpened = true;
    doorBeaconMat.color.setHex(0x10b981);
    doorBeaconMat.emissive.setHex(0x059669);
    interiorBayCore.material.opacity = 0.78;
    interiorBayLight.intensity = 4.5;
  } else {
    gameState.commsRestored = false;
    gameState.doorOpened = false;
    gameState.doorOpenProgress = 0;
    leftDoorPanel.position.x = -0.96;
    rightDoorPanel.position.x = 0.96;
    doorBeaconMat.color.setHex(gameState.txCompleted ? 0xf59e0b : 0xf43f5e);
    doorBeaconMat.emissive.setHex(gameState.txCompleted ? 0xd97706 : 0xe11d48);
    interiorBayCore.material.opacity = 0.15;
    interiorBayLight.intensity = 0.0;
  }

  gameState.missionPhase = getCurrentMissionPhase();
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

  const alignSubEl = document.getElementById('ui-align-sub');
  if (alignSubEl) {
    if (gameState.hintActive && !gameState.groundAckReceived) {
      alignSubEl.textContent = getAlignmentDirectionHint();
      alignSubEl.style.color = gameState.receiverAligned ? '#6ee7b7' : '#fde68a';
    } else {
      alignSubEl.textContent = t.stageCards.alignSub;
      alignSubEl.style.color = '';
    }
  }
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
  gameState.briefingDone = true;
  gameState.designDrawerOpen = false;
  animateCameraToPreset('alignFocus', 0.7);
  updateOpticalPuzzle();
  triggerStoryLine('mounted');
  void syncMissionTelemetry();
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

// Non-Overlapping Argon & Ground Control Subtitle + Chat Log
let speechDuckTimerId = null;

function appendDialogueMessage(sender, text) {
  const log = document.getElementById('dialogue-log');
  if (log) {
    const div = document.createElement('div');
    div.className = sender === 'user' ? 'msg-user' : 'msg-argon';
    const prefix =
      sender === 'control'
        ? gameState.lang === 'en'
          ? '📡 CONTROL'
          : '📡 지상 관제국'
        : sender === 'argon'
          ? '🤖 ARGON'
          : '🧑‍🚀 EVA';
    div.textContent = `${prefix}: ${text}`;
    if (sender === 'control') {
      div.style.borderLeftColor = '#10b981';
      div.style.color = '#a7f3d0';
    }
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
  if (sender === 'argon' || sender === 'control') {
    const sub = document.getElementById('argon-subtitle-text');
    if (sub) {
      sub.textContent = text;
      sub.style.color = sender === 'control' ? '#6ee7b7' : '#f1f5f9';
    }
  }
}

function speakArgonText(text, lang = gameState.lang) {
  if (speechDuckTimerId) {
    clearTimeout(speechDuckTimerId);
    speechDuckTimerId = null;
  }
  setBgmDucked(true);
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang === 'en' ? 'en-US' : 'ko-KR';
      utter.rate = 1.06;
      utter.onend = () => setBgmDucked(false);
      utter.onerror = () => setBgmDucked(false);
      window.speechSynthesis.speak(utter);
      speechDuckTimerId = setTimeout(() => setBgmDucked(false), 3200);
      return;
    } catch {
      // Fallback below
    }
  }
  speechDuckTimerId = setTimeout(() => setBgmDucked(false), 2400);
}

function triggerStoryLine(storyKey, sender = 'argon', force = false) {
  if (!force && gameState.triggeredStoryKeys.has(storyKey)) return;
  const lines = I18N[gameState.lang]?.argon?.storyLines;
  const text = lines?.[storyKey];
  if (!text) return;
  gameState.triggeredStoryKeys.add(storyKey);
  appendDialogueMessage(sender, text);
  speakArgonText(text, gameState.lang);
}

// Determine Active UI Stage ('design' | 'generate' | 'mount' | 'align' | 'completed')
function getCurrentUiStage() {
  if (gameState.returnedToBase && !gameState.reviewingAlignAfterComplete) {
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
  const lblAirlock = document.getElementById('label-airlock');
  const isMonitorHovered = player.hoverTarget === 'monitor';
  const isAirlockHovered = player.hoverTarget === 'airlock';

  if (lblMonitor) {
    lblMonitor.classList.toggle('hovered', isMonitorHovered);
  }
  if (lblAirlock) {
    lblAirlock.classList.toggle('hovered', isAirlockHovered);
  }
  monitorBezelMat.emissiveIntensity = isMonitorHovered ? 2.4 : 1.1;
  monitorGlowLight.intensity = isMonitorHovered ? 2.4 : 1.35;

  if (!hintEl) return;
  if (isMonitorHovered) {
    hintEl.textContent = t.mouseHints.hoverMonitor;
  } else if (isAirlockHovered) {
    hintEl.textContent = gameState.doorOpened
      ? t.mouseHints.hoverAirlockOpen
      : t.mouseHints.hoverAirlockLocked;
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

function updateTransmissionHudElements() {
  const t = I18N[gameState.lang];
  if (!t.txHud) return;

  const txStateEl = document.getElementById('tx-state-label');
  const txPctEl = document.getElementById('tx-percent-label');
  const txFillEl = document.getElementById('tx-progress-fill');
  const txTimerEl = document.getElementById('tx-pass-timer-text');
  const startPassBtn = document.getElementById('start-pass-btn');
  const nextPassBtn = document.getElementById('next-pass-btn');
  const returnBaseBtn = document.getElementById('return-base-btn');

  const pct = Math.round(gameState.txProgress);
  if (txPctEl) {
    txPctEl.textContent = `${pct}%`;
    txPctEl.style.color = gameState.txCompleted
      ? '#6ee7b7'
      : gameState.inPassWindow && gameState.receiverAligned
        ? '#38bdf8'
        : '#fde68a';
  }
  if (txFillEl) {
    txFillEl.style.width = `${pct}%`;
    txFillEl.style.background = gameState.txCompleted
      ? 'linear-gradient(90deg, #10b981, #34d399)'
      : 'linear-gradient(90deg, #38bdf8, #10b981)';
  }

  if (txStateEl && txTimerEl) {
    if (gameState.returnedToBase) {
      txStateEl.textContent = t.txHud.stateAck;
      txStateEl.style.color = '#6ee7b7';
      txTimerEl.textContent = t.txHud.timerDone;
    } else if (gameState.groundAckReceived) {
      txStateEl.textContent = t.txHud.stateAck;
      txStateEl.style.color = '#6ee7b7';
      txTimerEl.textContent = t.txHud.timerAckReady;
    } else if (gameState.txCompleted) {
      txStateEl.textContent = t.txHud.stateCompleteWaitAck;
      txStateEl.style.color = '#fde68a';
      txTimerEl.textContent = t.txHud.timerAckWait;
    } else if (gameState.inPassWindow) {
      const rem = Math.ceil(gameState.passRemainingSec);
      if (gameState.receiverAligned) {
        txStateEl.textContent = t.txHud.stateTransmitting;
        txStateEl.style.color = '#34d399';
        txTimerEl.textContent = t.txHud.timerRemaining(rem);
      } else {
        txStateEl.textContent = t.txHud.statePassHoldBeam;
        txStateEl.style.color = '#fde68a';
        txTimerEl.textContent = `${t.txHud.timerRemaining(rem)} · ${t.txHud.timerPaused}`;
      }
    } else if (gameState.passMissed) {
      txStateEl.textContent = t.txHud.statePassMissed;
      txStateEl.style.color = '#fca5a5';
      txTimerEl.textContent = t.txHud.timerPaused;
    } else if (gameState.passActiveMode) {
      txStateEl.textContent = t.txHud.statePassApproaching;
      txStateEl.style.color = '#38bdf8';
      txTimerEl.textContent = t.txHud.timerApproaching(Math.ceil(gameState.passCountdownSec));
    } else {
      txStateEl.textContent = t.txHud.stateStandby;
      txStateEl.style.color = '#94a3b8';
      txTimerEl.textContent = t.txHud.timerStandby;
    }
  }

  if (startPassBtn) {
    const showStart =
      gameState.reflectorMounted &&
      !gameState.passActiveMode &&
      !gameState.inPassWindow &&
      !gameState.passMissed &&
      !gameState.txCompleted;
    startPassBtn.style.display = showStart ? 'inline-flex' : 'none';
    startPassBtn.textContent = t.stageCards.startPassBtn;
  }
  if (nextPassBtn) {
    const showNext =
      gameState.reflectorMounted &&
      !gameState.txCompleted &&
      (gameState.passMissed || (!gameState.inPassWindow && gameState.passActiveMode && gameState.passCountdownSec > 15));
    nextPassBtn.style.display = showNext ? 'inline-flex' : 'none';
    nextPassBtn.textContent = t.stageCards.nextPassBtn;
  }
  if (returnBaseBtn) {
    const showReturn = gameState.groundAckReceived && !gameState.returnedToBase;
    returnBaseBtn.style.display = showReturn ? 'inline-flex' : 'none';
    returnBaseBtn.textContent = t.stageCards.returnToBaseBtn;
  }
}

function updateHudTranslations() {
  const t = I18N[gameState.lang];
  document.documentElement.lang = gameState.lang;
  gameState.missionPhase = getCurrentMissionPhase();

  // Top Bar
  document.getElementById('lang-toggle-btn').textContent = t.switchLangBtn;
  document.getElementById('bgm-toggle-btn').textContent = gameState.bgmPlaying
    ? t.menu.bgmOn
    : t.menu.bgmBtn;
  document.getElementById('guide-btn').textContent = t.menu.guideBtn;
  const autoPlayBtn = document.getElementById('autoplay-btn');
  if (autoPlayBtn) {
    autoPlayBtn.textContent = gameState.autoPlayActive
      ? t.menu.autoPlayRunning
      : t.menu.autoPlayBtn;
  }
  document.getElementById('details-toggle-btn').textContent = t.menu.detailsBtn;
  document.getElementById('reset-cam-btn').textContent = t.menu.centerCamBtn;

  // 5-Step Progress Track (1. 설계·확인 -> 2. 3D 생성 -> 3. 장착 -> 4. 교신·송신 -> 5. 기지 귀환)
  const stage = getCurrentUiStage();
  const stepDesign = document.getElementById('step-pill-design');
  const stepGen = document.getElementById('step-pill-generate');
  const stepMount = document.getElementById('step-pill-mount');
  const stepAlign = document.getElementById('step-pill-align');
  const stepReturn = document.getElementById('step-pill-return');

  if (stepDesign) stepDesign.textContent = t.steps.design;
  if (stepGen) stepGen.textContent = t.steps.generate;
  if (stepMount) stepMount.textContent = t.steps.mount;
  if (stepAlign) stepAlign.textContent = t.steps.align;
  if (stepReturn) stepReturn.textContent = t.steps.returnBase;

  const setPillState = (el, isDone, isActive) => {
    if (!el) return;
    el.className = `step-pill${isActive ? ' active' : isDone ? ' done' : ''}`;
  };

  setPillState(stepDesign, gameState.designConfirmed || gameState.reflectorMounted, stage === 'design');
  setPillState(
    stepGen,
    Boolean(gameState.loadedReflectorObject) && (stage !== 'generate' || gameState.reflectorMounted),
    stage === 'generate'
  );
  setPillState(stepMount, gameState.reflectorMounted, stage === 'mount');
  setPillState(
    stepAlign,
    gameState.groundAckReceived,
    stage === 'align' && !gameState.groundAckReceived
  );
  setPillState(
    stepReturn,
    gameState.returnedToBase,
    stage === 'align' && gameState.groundAckReceived && !gameState.returnedToBase
  );

  // Objective Single Sentence in Top Bar
  const objText = document.getElementById('mission-phase-text');
  if (objText) {
    if (gameState.returnedToBase) {
      objText.textContent = t.objectives.completed;
    } else if (gameState.returningInProgress) {
      objText.textContent = t.objectives.returning;
    } else if (gameState.groundAckReceived) {
      objText.textContent = t.objectives.ground_ack;
    } else if (stage === 'align') {
      if (gameState.inPassWindow && gameState.receiverAligned) {
        objText.textContent = t.objectives.transmitting;
      } else if (gameState.inPassWindow) {
        objText.textContent = t.objectives.pass_window;
      } else if (gameState.passMissed) {
        objText.textContent = t.objectives.pass_missed;
      } else if (gameState.passActiveMode) {
        objText.textContent = t.objectives.pass_approaching;
      } else {
        objText.textContent = t.objectives.ready_for_pass;
      }
    } else if (stage === 'mount') {
      objText.textContent = t.objectives.mount;
    } else if (stage === 'generate') {
      objText.textContent = t.objectives.generate;
    } else if (gameState.designDrawerOpen) {
      objText.textContent = t.objectives.design;
    } else {
      objText.textContent = t.objectives.confirm;
    }
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
  const reuseBtn = document.getElementById('reuse-reflector-btn');
  if (reuseBtn) {
    const canReuse = Boolean(gameState.loadedReflectorObject && gameState.activeReflectorMeta);
    reuseBtn.style.display = canReuse ? 'inline-flex' : 'none';
    reuseBtn.textContent = t.stageCards.reuseReflectorBtn;
  }
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
  document.getElementById('ui-error-deg-label').textContent = t.stageCards.errorDegLabel;
  document.getElementById('ui-yaw-label').textContent = t.stageCards.yawSliderLabel;
  document.getElementById('ui-pitch-label').textContent = t.stageCards.pitchSliderLabel;
  document.getElementById('align-assist-btn').textContent = t.stageCards.snapOptimalBtn;
  document.getElementById('redesign-from-align-btn').textContent = t.stageCards.remountOrRedesignBtn;

  updateAngleReadout();
  updateTransmissionHudElements();

  // Completion Banner
  document.getElementById('ui-complete-badge').textContent = t.completeBanner.badge;
  document.getElementById('ui-complete-title').textContent = t.completeBanner.title;
  document.getElementById('ui-complete-sub').textContent = t.completeBanner.subtitle;
  const restartBtn = document.getElementById('restart-mission-btn');
  if (restartBtn) {
    restartBtn.textContent = t.completeBanner.restartMissionBtn;
  }
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
  const lblAirlock = document.getElementById('label-airlock');
  const lblMonitor = document.getElementById('label-orbit-monitor');
  if (lblEmitter && t.worldLabels) {
    lblEmitter.textContent = t.worldLabels.emitter;
  }
  if (lblReflector && t.worldLabels) {
    lblReflector.textContent = gameState.reflectorMounted
      ? t.worldLabels.reflectorMounted
      : t.worldLabels.reflectorDamaged;
  }
  if (lblReceiver && t.worldLabels) {
    lblReceiver.textContent = gameState.receiverAligned
      ? t.worldLabels.receiverLocked
      : t.worldLabels.receiverTarget;
    lblReceiver.classList.toggle('locked', gameState.receiverAligned);
  }
  if (lblAirlock && t.worldLabels) {
    lblAirlock.textContent = gameState.doorOpened
      ? t.worldLabels.airlockOpen
      : t.worldLabels.airlockLocked;
    lblAirlock.classList.toggle('open', gameState.doorOpened);
  }
  if (lblMonitor && t.orbitMonitor) {
    lblMonitor.textContent = t.orbitMonitor.worldTag;
  }

  // Orbit Monitor Modal Texts
  if (t.orbitMonitor) {
    const omTitle = document.getElementById('ui-orbit-modal-title');
    const omMeta = document.getElementById('ui-orbit-modal-meta');
    const omClose = document.getElementById('close-orbit-modal-btn');
    const omMarkerTitle = document.getElementById('ui-orbit-marker-title');
    const omMarkerDir = document.getElementById('ui-orbit-marker-dir');
    const omGroundLbl = document.getElementById('orbit-ground-label');
    const omLegRev = document.getElementById('ui-orbit-legend-rev');
    const omLegSpin = document.getElementById('ui-orbit-legend-spin');
    const omLegSync = document.getElementById('ui-orbit-legend-sync');
    if (omTitle) omTitle.textContent = t.orbitMonitor.modalTitle;
    if (omMeta) omMeta.textContent = t.orbitMonitor.metaBadge;
    if (omClose) omClose.textContent = t.orbitMonitor.closeBtn;
    if (omMarkerTitle) omMarkerTitle.textContent = `🛰️ ${t.orbitMonitor.markerLabel}`;
    if (omMarkerDir) omMarkerDir.textContent = t.orbitMonitor.directionLabel;
    if (omGroundLbl) omGroundLbl.textContent = t.orbitMonitor.groundStationLabel;
    if (omLegRev) omLegRev.textContent = t.orbitMonitor.legendOrbit;
    if (omLegSpin) omLegSpin.textContent = t.orbitMonitor.legendEarthSpin;
    if (omLegSync) omLegSync.textContent = t.orbitMonitor.legendSync;
    updateOrbitMonitorHudLabels();
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
  const guideDemoTitle = document.getElementById('ui-guide-demo-title');
  const guideDemoDesc = document.getElementById('ui-guide-demo-desc');
  if (guideDemoTitle && t.guide.demoTitle) guideDemoTitle.textContent = t.guide.demoTitle;
  if (guideDemoDesc && t.guide.demoDesc) guideDemoDesc.textContent = t.guide.demoDesc;

  // Lyria Music Generation Studio Modal & Top Button
  const lyriaBtn = document.getElementById('lyria-studio-btn');
  if (lyriaBtn && t.menu.lyriaStudioBtn) {
    lyriaBtn.textContent = t.menu.lyriaStudioBtn;
  }
  if (t.lyriaModal) {
    const lmTitle = document.getElementById('ui-lyria-modal-title');
    const lmMeta = document.getElementById('ui-lyria-modal-meta');
    const lmClose = document.getElementById('close-lyria-modal-btn');
    const lmModelLbl = document.getElementById('ui-lyria-model-label');
    const lmOptClip = document.getElementById('ui-lyria-opt-clip');
    const lmOptFull = document.getElementById('ui-lyria-opt-full');
    const lmPromptLbl = document.getElementById('ui-lyria-prompt-label');
    const lmPreAmb = document.getElementById('lyria-preset-ambient');
    const lmPreVoc = document.getElementById('lyria-preset-vocal');
    const lmPrePul = document.getElementById('lyria-preset-pulse');
    const lmGenBtn = document.getElementById('lyria-generate-btn');
    const lmApplyBtn = document.getElementById('lyria-apply-bgm-btn');
    const lmDlBtn = document.getElementById('lyria-download-link');
    const lmLyricsLbl = document.getElementById('ui-lyria-lyrics-label');
    if (lmTitle) lmTitle.textContent = t.lyriaModal.modalTitle;
    if (lmMeta) lmMeta.textContent = t.lyriaModal.metaBadge;
    if (lmClose) lmClose.textContent = t.lyriaModal.closeBtn;
    if (lmModelLbl) lmModelLbl.textContent = t.lyriaModal.modelLabel;
    if (lmOptClip) lmOptClip.textContent = t.lyriaModal.clipOption;
    if (lmOptFull) lmOptFull.textContent = t.lyriaModal.fullOption;
    if (lmPromptLbl) lmPromptLbl.textContent = t.lyriaModal.promptLabel;
    if (lmPreAmb) lmPreAmb.textContent = t.lyriaModal.presetAmbient;
    if (lmPreVoc) lmPreVoc.textContent = t.lyriaModal.presetVocal;
    if (lmPrePul) lmPrePul.textContent = t.lyriaModal.presetPulse;
    if (lmGenBtn) {
      lmGenBtn.textContent = gameState.lyriaGenerating
        ? t.lyriaModal.generatingBtn
        : t.lyriaModal.generateBtn;
      lmGenBtn.disabled = gameState.lyriaGenerating;
    }
    if (lmApplyBtn) lmApplyBtn.textContent = t.lyriaModal.applyBgmBtn;
    if (lmDlBtn) lmDlBtn.textContent = t.lyriaModal.downloadBtn;
    if (lmLyricsLbl) lmLyricsLbl.textContent = t.lyriaModal.lyricsLabel;
  }

  updateInSceneMonitorScreen(player.hoverTarget === 'monitor');
  updateSceneHintText();
}

// Project 3D Positions to 2D Floating Labels
const tempProjVec = new THREE.Vector3();
function updateWorldLabels() {
  camera.updateMatrixWorld();
  const items = [
    { el: document.getElementById('label-emitter'), pos: EMITTER_POS, offsetY: 0.65 },
    { el: document.getElementById('label-reflector'), pos: MOUNT_POS, offsetY: 1.45 },
    { el: document.getElementById('label-receiver'), pos: RECEIVER_POS, offsetY: 0.85 },
    { el: document.getElementById('label-airlock'), pos: GATE_POS, offsetY: 3.72 },
    { el: document.getElementById('label-orbit-monitor'), pos: ORBIT_MONITOR_POS, offsetY: 0.58 },
  ];
  for (const item of items) {
    if (!item.el) continue;
    tempProjVec.copy(item.pos);
    tempProjVec.y += item.offsetY;
    tempProjVec.project(camera);
    if (tempProjVec.z > 1) {
      item.el.style.display = 'none';
      continue;
    }
    const x = (tempProjVec.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-tempProjVec.y * 0.5 + 0.5) * window.innerHeight;
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
    gameState.userMutedBgm = false;
    await ensureBgmPlaying();
  } else {
    gameState.userMutedBgm = true;
    bgmAudio.pause();
    gameState.bgmPlaying = false;
  }
  updateHudTranslations();
});

// Gemini Lyria Music Generation Studio Handlers
const lyriaModalEl = document.getElementById('lyria-modal');
const lyriaStudioBtn = document.getElementById('lyria-studio-btn');
const closeLyriaModalBtn = document.getElementById('close-lyria-modal-btn');

function openLyriaModal() {
  gameState.lyriaModalOpen = true;
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
  bgmAudio.loop = true;
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
      body: JSON.stringify({ model, input }),
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
      badgeEl.textContent = `${gameState.lyriaModel} · ${mimeType}`;
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

// Confirm Design -> Automatically closes Design Drawer and moves to Stage 3 (Generate)
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
  return data;
}

document.getElementById('confirm-design-btn').addEventListener('click', () => {
  void confirmCurrentDesign();
});

// Cancel Design Confirmation / Re-open Design Stage
async function reopenDesignStage() {
  hideAlert();
  await fetch('/api/design/cancel', { method: 'POST' });
  gameState.designConfirmed = false;
  gameState.approvedDesignVersion = null;
  gameState.reflectorMounted = false;
  gameState.receiverAligned = false;
  gameState.commsRestored = false;
  gameState.doorOpened = false;
  gameState.reviewingAlignAfterComplete = false;
  gameState.designDrawerOpen = true;
  animateCameraToPreset('overview', 0.6);
  updateOpticalPuzzle();
  updateHudTranslations();
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
  appendDialogueMessage('argon', I18N[gameState.lang].argon.stageHints.align);
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

document.getElementById('align-assist-btn').addEventListener('click', () => {
  gameState.mountedYawRad = TARGET_YAW_RAD;
  gameState.mountedPitchRad = TARGET_PITCH_RAD;
  updateOpticalPuzzle();
  appendDialogueMessage('argon', I18N[gameState.lang].argon.stageHints.completed);
});

// Guided Auto-Play Mode (Smoothly demonstrates Design -> Confirm -> 3D Generate -> Mount -> Beam Alignment)
async function runGuidedAutoPlay() {
  if (gameState.autoPlayActive) return;
  gameState.autoPlayActive = true;
  updateHudTranslations();
  await ensureBgmPlaying();

  try {
    // 1. Confirm design if not confirmed
    if (!gameState.designConfirmed) {
      await confirmCurrentDesign();
      await new Promise((r) => setTimeout(r, 450));
    }
    // 2. Generate 3D reflector (using verified fast artifact so guided demo is smooth and instant)
    if (!gameState.loadedReflectorObject) {
      await generateActual3DReflector({ fastMode: true });
      await new Promise((r) => setTimeout(r, 450));
    }
    // 3. Mount reflector on pedestal
    if (!gameState.reflectorMounted) {
      mountActiveReflectorOnPedestal();
      await new Promise((r) => setTimeout(r, 550));
    }
    // 4. Smoothly animate reflector angle from unaligned to target lock
    const startYaw = -0.36;
    const startPitch = -0.22;
    const steps = 28;
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
      await new Promise((r) => setTimeout(r, 40));
    }
    appendDialogueMessage('argon', I18N[gameState.lang].argon.stageHints.completed);
  } finally {
    gameState.autoPlayActive = false;
    updateHudTranslations();
  }
}

document.getElementById('autoplay-btn').addEventListener('click', () => {
  void runGuidedAutoPlay();
});

// ============================================================================
// Singleton 3D Orbit Monitor Modal View (Inspired by satellitemap.space track view)
// Restricted to: 3D Earth, 1 Orbit Track, 1 Moving Marker, Direction + Label, Meta Info, Close Button
// ============================================================================
const orbitMonitorView = {
  initialized: false,
  renderer: null,
  scene: null,
  camera: null,
  earthSpinGroup: null,
  cloudMesh: null,
  orbitPlaneGroup: null,
  markerGroup: null,
  markerPulseHalo: null,
  directionArrow: null,
  nadirLineGeom: null,
  orbitRadius: 2.16,
  earthRadius: 1.56,
  markerWorldPos: new THREE.Vector3(),
  markerScreenPos: { x: 0, y: 0 },
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

  // Camera framed so entire 3D Earth, full 3D orbit ring, and current marker are 100% visible
  const omCamera = new THREE.PerspectiveCamera(42, 16 / 10, 0.1, 100);
  omCamera.position.set(0, 1.55, 5.95);
  omCamera.lookAt(0, 0, 0);

  // Background stars inside the Orbit Monitor
  const starCount = 450;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 18 + (i % 17) * 1.4;
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

  // Lighting for 3D Globe
  omScene.add(new THREE.AmbientLight(0x6488b8, 1.15));
  const omSun = new THREE.DirectionalLight(0xfff4dc, 2.8);
  omSun.position.set(8, 4, 6);
  omScene.add(omSun);
  const omRim = new THREE.DirectionalLight(0x38bdf8, 1.3);
  omRim.position.set(-7, -3, -5);
  omScene.add(omRim);

  // 1. Simple 3D Earth (Spins on its polar axis via orbitSim.earthSpinRad)
  const earthSpinGroup = new THREE.Group();
  earthSpinGroup.name = 'OrbitMonitorEarthSpinGroup';
  earthSpinGroup.rotation.z = 0.22;
  omScene.add(earthSpinGroup);

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

  // Subtle Atmosphere Halo around Monitor Globe
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
  omScene.add(atmoHalo);

  // 2. Single Inclined 3D Orbital Track Line (Tilted so the entire loop & marker are never occluded)
  const orbitPlaneGroup = new THREE.Group();
  orbitPlaneGroup.name = 'SuncatcherSingleOrbitPlane';
  orbitPlaneGroup.rotation.x = 0.54;
  orbitPlaneGroup.rotation.z = -0.34;
  omScene.add(orbitPlaneGroup);

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

  // Subtle Ground-Track Nadir Line connecting Current Station Position to Earth Surface
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

  // 3. Single Moving Current-Position Marker + Forward Velocity Direction Cone
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

  // Forward travel direction arrow cone placed just ahead of the marker along the tangent
  const arrowGeom = new THREE.ConeGeometry(0.075, 0.24, 16);
  arrowGeom.rotateX(Math.PI / 2); // Point cone tip along +Z for lookAt
  const directionArrow = new THREE.Mesh(
    arrowGeom,
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
  );
  orbitPlaneGroup.add(directionArrow);

  orbitMonitorView.initialized = true;
  orbitMonitorView.renderer = omRenderer;
  orbitMonitorView.scene = omScene;
  orbitMonitorView.camera = omCamera;
  orbitMonitorView.earthSpinGroup = earthSpinGroup;
  orbitMonitorView.cloudMesh = globeCloudMesh;
  orbitMonitorView.orbitPlaneGroup = orbitPlaneGroup;
  orbitMonitorView.markerGroup = markerGroup;
  orbitMonitorView.markerPulseHalo = markerPulseHalo;
  orbitMonitorView.directionArrow = directionArrow;
  orbitMonitorView.nadirLineGeom = nadirGeom;
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

function updateOrbitMonitorHudLabels() {
  const isEn = gameState.lang === 'en';
  const omMeta = document.getElementById('ui-orbit-modal-meta');
  const omSpeedBtn = document.getElementById('orbit-speed-btn');
  const omMarkerDir = document.getElementById('ui-orbit-marker-dir');

  const latHemi = orbitSim.latDeg >= 0 ? 'N' : 'S';
  const lonHemi = orbitSim.lonDeg >= 0 ? 'E' : 'W';
  const coordStr = `${Math.abs(orbitSim.latDeg).toFixed(2)}°${latHemi}, ${Math.abs(orbitSim.lonDeg).toFixed(2)}°${lonHemi}`;
  const speedText =
    orbitSim.timeScale === 1
      ? isEn
        ? '1× Real-Time'
        : '1× 실시간'
      : isEn
        ? `${orbitSim.timeScale}× Warp`
        : `${orbitSim.timeScale}× 배속`;

  if (omMeta) {
    omMeta.textContent = isEn
      ? `NORAD ${orbitSim.noradId} (${orbitSim.objectName}) · Alt ${orbitSim.altitudeKm}km · ${orbitSim.velocityKms} km/s · ${coordStr} · ${speedText}`
      : `NORAD ${orbitSim.noradId} (${orbitSim.objectName}) · 고도 ${orbitSim.altitudeKm}km · ${orbitSim.velocityKms} km/s · ${coordStr} · ${speedText}`;
  }
  if (omSpeedBtn) {
    omSpeedBtn.textContent = `⚡ ${speedText}`;
  }
  if (omMarkerDir) {
    omMarkerDir.textContent = isEn
      ? `Direction · ${orbitSim.velocityKms} km/s (${coordStr}) ➔`
      : `진행 방향 · ${orbitSim.velocityKms} km/s (${coordStr}) ➔`;
  }
}

// Advance Shared Orbital Simulation State & Synchronize Out-the-Window 3D Earth
function stepOrbitSimulation(dt) {
  orbitSim.simTimeSec += dt * orbitSim.timeScale;
  orbitSim.virtualTimestampMs += dt * 1000 * orbitSim.timeScale;

  // Propagate real satellite orbital elements (NORAD 100902 · PROJECT SUNCATCHER M1)
  const prop = propagateClientOrbit(orbitSim.elements, orbitSim.virtualTimestampMs);
  if (orbitSim.initialArgOfLatitudeRad === null) {
    orbitSim.initialArgOfLatitudeRad = prop.argumentOfLatitudeRad;
    orbitSim.initialGmstRad = prop.gmstRad;
  }

  // Keep 3D marker anchored on front hemisphere while advancing at exact real satellite angular velocity
  const deltaOrbRad = prop.argumentOfLatitudeRad - orbitSim.initialArgOfLatitudeRad;
  const deltaGmstRad = prop.gmstRad - orbitSim.initialGmstRad;

  orbitSim.orbitAngleRad = normalizePosAngle(0.72 + deltaOrbRad);
  orbitSim.earthSpinRad = normalizePosAngle(0.45 + deltaGmstRad);
  orbitSim.cloudDriftRad = normalizePosAngle(orbitSim.earthSpinRad * 1.28);

  orbitSim.latDeg = prop.latDeg;
  orbitSim.lonDeg = prop.lonDeg;
  orbitSim.altitudeKm = prop.altitudeKm;
  orbitSim.velocityKms = prop.velocityKms;

  // Synchronize Main Scene Out-the-Window 3D Earth with the exact same orbitSim state:
  // 1) Station's orbital revolution pitches the Earth horizon passing beneath the station
  earthLayers.orbitalTrackPitchGroup.rotation.x = -orbitSim.orbitAngleRad;
  // 2) Earth's own axial spin rotates continents & city lights around Earth's polar axis
  earthLayers.earthAxialSpinGroup.rotation.y = orbitSim.earthSpinRad;
  // 3) Atmospheric clouds drift slightly faster
  earthLayers.cloudMesh.rotation.y = orbitSim.cloudDriftRad - orbitSim.earthSpinRad;

  // Keep the in-scene 3D monitor screen canvas updated with the moving orbit dot
  updateInSceneMonitorScreen(player.hoverTarget === 'monitor');
  if (gameState.orbitMonitorOpen) {
    updateOrbitMonitorHudLabels();
  }
}

// Render 1 Frame of the 3D Orbit Monitor Modal (Called ONLY when gameState.orbitMonitorOpen === true)
const omTempWorldVec = new THREE.Vector3();
function renderOrbitMonitorFrame(nowSec = 0) {
  if (!gameState.orbitMonitorOpen) return;
  initOrbitMonitor3DView();
  if (!orbitMonitorView.initialized) return;

  const R = orbitMonitorView.orbitRadius;
  const angle = orbitSim.orbitAngleRad;

  // 1. Update Earth axial rotation inside the monitor to match orbitSim.earthSpinRad
  orbitMonitorView.earthSpinGroup.rotation.y = orbitSim.earthSpinRad;
  orbitMonitorView.cloudMesh.rotation.y =
    orbitSim.cloudDriftRad - orbitSim.earthSpinRad;

  // 2. Update Suncatcher marker position along the single 3D orbit ring
  const mx = Math.cos(angle) * R;
  const mz = Math.sin(angle) * R;
  orbitMonitorView.markerGroup.position.set(mx, 0, mz);

  const pulseScale = 1 + Math.sin(nowSec * 5.0) * 0.18;
  orbitMonitorView.markerPulseHalo.scale.setScalar(pulseScale);

  // 3. Update nadir line from Earth surface to current marker
  const posAttr = orbitMonitorView.nadirLineGeom.getAttribute('position');
  const surfR = orbitMonitorView.earthRadius;
  posAttr.setXYZ(0, Math.cos(angle) * surfR, 0, Math.sin(angle) * surfR);
  posAttr.setXYZ(1, mx, 0, mz);
  posAttr.needsUpdate = true;

  // 4. Update travel direction arrow cone just ahead of marker along the orbit tangent
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

  // 5. Render the 3D Orbit Monitor scene
  orbitMonitorView.scene.updateMatrixWorld(true);
  orbitMonitorView.renderer.render(orbitMonitorView.scene, orbitMonitorView.camera);
  orbitSim.monitorRenderFrames += 1;

  // 6. Project 3D Marker position to 2D floating label ("SUNCATCHER / 현재 위치" + "진행 방향 ➔")
  orbitMonitorView.markerGroup.getWorldPosition(omTempWorldVec);
  orbitMonitorView.markerWorldPos.copy(omTempWorldVec);
  omTempWorldVec.project(orbitMonitorView.camera);

  const vp = document.getElementById('orbit-monitor-viewport');
  const labelEl = document.getElementById('orbit-marker-label');
  if (vp && labelEl) {
    const w = vp.clientWidth || 680;
    const h = vp.clientHeight || 425;
    const sx = (omTempWorldVec.x * 0.5 + 0.5) * w;
    const sy = Math.max(32, Math.min(h - 32, (-omTempWorldVec.y * 0.5 + 0.5) * h));
    orbitMonitorView.markerScreenPos = { x: Number(sx.toFixed(1)), y: Number(sy.toFixed(1)) };
    labelEl.style.left = `${sx}px`;
    labelEl.style.top = `${sy}px`;
    // Flip label to the left of the marker when near the right viewport border so it never clips
    labelEl.style.transform =
      sx > w - 245 ? 'translate(calc(-100% - 14px), -50%)' : 'translate(14px, -50%)';
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

function openOrbitMonitor() {
  void ensureBgmPlaying();
  clearActiveInputsAndDrag();
  void syncOrbitFromApi();

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
    openOrbitMonitor();
  });
}

const orbitSpeedBtn = document.getElementById('orbit-speed-btn');
if (orbitSpeedBtn) {
  orbitSpeedBtn.addEventListener('click', () => {
    const scales = [1, 10, 30];
    const idx = scales.indexOf(orbitSim.timeScale);
    orbitSim.timeScale = scales[(idx + 1) % scales.length];
    updateOrbitMonitorHudLabels();
    updateInSceneMonitorScreen(player.hoverTarget === 'monitor');
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
  gameState.lang = s.lang || 'ko';
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

  appendDialogueMessage('argon', I18N[gameState.lang].argon.welcome);
  void syncOrbitFromApi();
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
    apiSynced: orbitSim.apiSynced,
    apiSource: orbitSim.apiSource,
    noradId: orbitSim.noradId,
    objectName: orbitSim.objectName,
    objectId: orbitSim.objectId,
    altitudeKm: orbitSim.altitudeKm,
    stationDesignAltitudeKm: orbitSim.stationDesignAltitudeKm,
    inclinationDeg: orbitSim.inclinationDeg,
    velocityKms: orbitSim.velocityKms,
    periodMin: orbitSim.periodMin,
    latDeg: orbitSim.latDeg,
    lonDeg: orbitSim.lonDeg,
    timeScale: orbitSim.timeScale,
    simTimeSec: Number(orbitSim.simTimeSec.toFixed(2)),
    orbitAngleRad: Number(orbitSim.orbitAngleRad.toFixed(4)),
    orbitAngleDeg: Number(((orbitSim.orbitAngleRad * 180) / Math.PI).toFixed(2)),
    earthSpinRad: Number(orbitSim.earthSpinRad.toFixed(4)),
    earthSpinDeg: Number(((orbitSim.earthSpinRad * 180) / Math.PI).toFixed(2)),
    outWindowEarthPitchRad: Number(earthLayers.orbitalTrackPitchGroup.rotation.x.toFixed(4)),
    outWindowEarthSpinRad: Number(earthLayers.earthAxialSpinGroup.rotation.y.toFixed(4)),
    monitorEarthSpinRad: orbitMonitorView.earthSpinGroup
      ? Number(orbitMonitorView.earthSpinGroup.rotation.y.toFixed(4))
      : null,
    markerLocalPos: orbitMonitorView.markerGroup
      ? orbitMonitorView.markerGroup.position.toArray().map((v) => Number(v.toFixed(3)))
      : null,
    markerScreenPos: orbitMonitorView.markerScreenPos,
    openCount: orbitSim.openCount,
    monitorRenderFrames: orbitSim.monitorRenderFrames,
    renderLoopCount: orbitSim.renderLoopCount,
  }),
  setOrbitTimeScale: (scale = 1) => {
    orbitSim.timeScale = Number(scale) || 1;
    updateOrbitMonitorHudLabels();
    updateInSceneMonitorScreen(player.hoverTarget === 'monitor');
    return window.__suncatcherTest.getOrbitState();
  },
  openOrbitMonitor: () => {
    openOrbitMonitor();
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

