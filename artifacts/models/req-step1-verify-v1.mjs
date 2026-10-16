/**
 * Procedural 3D Reflector Generator based on confirmed design specification:
 * 19-segment hexagonal gold honeycomb optical mirror array with chamfered dark
 * titanium bezel, 4 glowing blue corner alignment fiducials, and rear carbon-composite
 * truss dual-axis gimbal mount.
 */

export function buildReflector({ THREE }) {
  const root = new THREE.Group();
  root.name = 'GeneratedReflector3D';

  // -------------------------------------------------------------------------
  // MATERIALS
  // -------------------------------------------------------------------------
  const goldMirrorMat = new THREE.MeshStandardMaterial({
    color: 0xffcb3d,
    metalness: 0.98,
    roughness: 0.12,
    envMapIntensity: 2.5
  });

  const mirrorBackMat = new THREE.MeshStandardMaterial({
    color: 0x1f2327,
    metalness: 0.7,
    roughness: 0.5
  });

  const titaniumBezelMat = new THREE.MeshStandardMaterial({
    color: 0x22262c,
    metalness: 0.88,
    roughness: 0.32
  });

  const titaniumAccentMat = new THREE.MeshStandardMaterial({
    color: 0x3d434d,
    metalness: 0.82,
    roughness: 0.28
  });

  const fiducialGlowMat = new THREE.MeshStandardMaterial({
    color: 0x00c8ff,
    emissive: 0x00a2ff,
    emissiveIntensity: 3.2,
    metalness: 0.1,
    roughness: 0.2
  });

  const fiducialHousingMat = new THREE.MeshStandardMaterial({
    color: 0x15181c,
    metalness: 0.9,
    roughness: 0.35
  });

  const carbonTrussMat = new THREE.MeshStandardMaterial({
    color: 0x181a1c,
    metalness: 0.45,
    roughness: 0.6
  });

  const jointTitaniumMat = new THREE.MeshStandardMaterial({
    color: 0x6e7682,
    metalness: 0.9,
    roughness: 0.25
  });

  const motorHousingMat = new THREE.MeshStandardMaterial({
    color: 0x2c313a,
    metalness: 0.75,
    roughness: 0.4
  });

  const wiringConduitMat = new THREE.MeshStandardMaterial({
    color: 0x8a5a22,
    metalness: 0.5,
    roughness: 0.55
  });

  // -------------------------------------------------------------------------
  // PART 1: 19-SEGMENT GOLD HONEYCOMB MIRROR ARRAY (+Z Facing)
  // -------------------------------------------------------------------------
  const mirrorGroup = new THREE.Group();
  mirrorGroup.name = 'MirrorAssembly';

  const hexRadius = 0.168; // circumradius of each hexagon
  const hexThickness = 0.024;
  const hexPitch = hexRadius * Math.sqrt(3) + 0.006; // center-to-center pitch with clearance

  // Calculate 19 hex center coordinates in axial coordinates (rings 0, 1, 2)
  const hexPositions = [];
  // Ring 0: Center
  hexPositions.push(new THREE.Vector2(0, 0));

  // Ring 1: 6 segments
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    hexPositions.push(new THREE.Vector2(Math.cos(angle) * hexPitch, Math.sin(angle) * hexPitch));
  }

  // Ring 2: 12 segments (6 primary vertices + 6 edge midpoints)
  for (let i = 0; i < 6; i++) {
    const vertexAngle = (i * Math.PI) / 3;
    // 6 primary vertex neighbors
    hexPositions.push(
      new THREE.Vector2(Math.cos(vertexAngle) * hexPitch * 2, Math.sin(vertexAngle) * hexPitch * 2)
    );

    // 6 edge midpoints
    const midAngle = vertexAngle + Math.PI / 6;
    const midDist = hexPitch * Math.sqrt(3);
    hexPositions.push(
      new THREE.Vector2(Math.cos(midAngle) * midDist, Math.sin(midAngle) * midDist)
    );
  }

  const hexGeo = new THREE.CylinderGeometry(hexRadius, hexRadius, hexThickness, 6, 1, false);

  hexPositions.forEach((pos, idx) => {
    const segment = new THREE.Mesh(hexGeo, [
      mirrorBackMat,
      goldMirrorMat, // top circular cap facing +Z
      mirrorBackMat  // bottom cap
    ]);
    segment.name = `HexMirrorSegment_${idx + 1}`;
    // Cylinder is along Y; rotate so its flat top face aligns along +Z and edges nest
    segment.rotation.x = Math.PI / 2;
    segment.rotation.z = Math.PI / 6;
    segment.position.set(pos.x, pos.y, 0.012);
    mirrorGroup.add(segment);
  });
  root.add(mirrorGroup);

  // -------------------------------------------------------------------------
  // PART 2: CHAMFERED DARK TITANIUM OUTER BEZEL
  // -------------------------------------------------------------------------
  // Main hexagonal outer frame with rounded chamfer profile
  const bezelShape = new THREE.Shape();
  const bezelSides = 8; // Octagonal/hex-chamfer silhouette
  const outerR = 0.94;
  const innerR = 0.77;

  for (let i = 0; i < bezelSides; i++) {
    const theta = (i * 2 * Math.PI) / bezelSides + Math.PI / 8;
    const x = Math.cos(theta) * outerR;
    const y = Math.sin(theta) * outerR;
    if (i === 0) bezelShape.moveTo(x, y);
    else bezelShape.lineTo(x, y);
  }
  bezelShape.closePath();

  // Cutout hole for mirror array
  const bezelHole = new THREE.Path();
  for (let i = 0; i < bezelSides; i++) {
    const theta = (i * 2 * Math.PI) / bezelSides + Math.PI / 8;
    const x = Math.cos(theta) * innerR;
    const y = Math.sin(theta) * innerR;
    if (i === 0) bezelHole.moveTo(x, y);
    else bezelHole.lineTo(x, y);
  }
  bezelHole.closePath();
  bezelShape.holes.push(bezelHole);

  const bezelExtrudeSettings = {
    depth: 0.08,
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 1,
    bevelSize: 0.024,
    bevelThickness: 0.02
  };

  const bezelGeo = new THREE.ExtrudeGeometry(bezelShape, bezelExtrudeSettings);
  const outerBezelMesh = new THREE.Mesh(bezelGeo, titaniumBezelMat);
  outerBezelMesh.name = 'ChamferedTitaniumBezel';
  outerBezelMesh.position.set(0, 0, -0.065);
  root.add(outerBezelMesh);

  // Inner beveled containment lip
  const innerLipGeo = new THREE.TorusGeometry(0.78, 0.018, 8, 32);
  const innerLipMesh = new THREE.Mesh(innerLipGeo, titaniumAccentMat);
  innerLipMesh.name = 'BezelInnerContainmentLip';
  innerLipMesh.position.set(0, 0, 0.02);
  root.add(innerLipMesh);

  // -------------------------------------------------------------------------
  // PART 3: 4 GLOWING BLUE CORNER ALIGNMENT FIDUCIALS
  // -------------------------------------------------------------------------
  const fiducialDistance = 0.81;
  const fiducialAngles = [
    Math.PI / 4,
    (3 * Math.PI) / 4,
    (5 * Math.PI) / 4,
    (7 * Math.PI) / 4
  ];

  const fiducialLensGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.015, 24);
  const fiducialRingGeo = new THREE.TorusGeometry(0.042, 0.01, 12, 24);

  fiducialAngles.forEach((ang, i) => {
    const fx = Math.cos(ang) * fiducialDistance;
    const fy = Math.sin(ang) * fiducialDistance;

    // Outer dark metallic bezel ring
    const collar = new THREE.Mesh(fiducialRingGeo, fiducialHousingMat);
    collar.name = `FiducialCollar_${i + 1}`;
    collar.position.set(fx, fy, 0.036);
    root.add(collar);

    // Glowing emitter lens
    const lens = new THREE.Mesh(fiducialLensGeo, fiducialGlowMat);
    lens.name = `FiducialLens_${i + 1}`;
    lens.rotation.x = Math.PI / 2;
    lens.position.set(fx, fy, 0.038);
    root.add(lens);
  });

  // -------------------------------------------------------------------------
  // PART 4: REAR CARBON-COMPOSITE TRUSS STRUCTURAL SYSTEM (-Z)
  // -------------------------------------------------------------------------
  // Intermediate circular bulkhead mounting ring
  const rearBulkheadGeo = new THREE.TorusGeometry(0.66, 0.024, 12, 36);
  const rearBulkheadMesh = new THREE.Mesh(rearBulkheadGeo, jointTitaniumMat);
  rearBulkheadMesh.name = 'RearBulkheadMountingRing';
  rearBulkheadMesh.position.set(0, 0, -0.14);
  root.add(rearBulkheadMesh);

  // Gimbal interface baseplate ring
  const gimbalBaseRingGeo = new THREE.CylinderGeometry(0.44, 0.46, 0.03, 24);
  const gimbalBaseRing = new THREE.Mesh(gimbalBaseRingGeo, jointTitaniumMat);
  gimbalBaseRing.name = 'GimbalInterfaceRing';
  gimbalBaseRing.rotation.x = Math.PI / 2;
  gimbalBaseRing.position.set(0, 0, -0.32);
  root.add(gimbalBaseRing);

  // Triangular carbon-composite truss struts connecting bezel to gimbal base
  const strutRadius = 0.014;
  const numTrussNodes = 6;
  const trussGroup = new THREE.Group();
  trussGroup.name = 'CarbonTrussAssembly';

  for (let i = 0; i < numTrussNodes; i++) {
    const theta1 = (i * 2 * Math.PI) / numTrussNodes;
    const theta2 = ((i + 1) * 2 * Math.PI) / numTrussNodes;
    const pFore = new THREE.Vector3(Math.cos(theta1) * 0.72, Math.sin(theta1) * 0.72, -0.07);
    const pAft = new THREE.Vector3(Math.cos(theta2) * 0.44, Math.sin(theta2) * 0.44, -0.32);
    const pAftSame = new THREE.Vector3(Math.cos(theta1) * 0.44, Math.sin(theta1) * 0.44, -0.32);

    // Diagonal strut
    const vDiag = new THREE.Vector3().subVectors(pAft, pFore);
    const diagLen = vDiag.length();
    const diagGeo = new THREE.CylinderGeometry(strutRadius, strutRadius, diagLen, 12);
    const strutMesh = new THREE.Mesh(diagGeo, carbonTrussMat);
    strutMesh.position.copy(pFore).addScaledVector(vDiag, 0.5);
    strutMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vDiag.clone().normalize());
    trussGroup.add(strutMesh);

    // Longitudinal stabilizing strut
    const vLong = new THREE.Vector3().subVectors(pAftSame, pFore);
    const longLen = vLong.length();
    const longGeo = new THREE.CylinderGeometry(strutRadius, strutRadius, longLen, 12);
    const longMesh = new THREE.Mesh(longGeo, carbonTrussMat);
    longMesh.position.copy(pFore).addScaledVector(vLong, 0.5);
    longMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vLong.clone().normalize());
    trussGroup.add(longMesh);

    // Spherical node joints
    const nodeGeo = new THREE.SphereGeometry(0.025, 12, 12);
    const nodeMesh = new THREE.Mesh(nodeGeo, jointTitaniumMat);
    nodeMesh.position.copy(pFore);
    trussGroup.add(nodeMesh);
  }
  root.add(trussGroup);

  // -------------------------------------------------------------------------
  // PART 5: DUAL-AXIS GIMBAL MOUNT & ACTUATOR HOUSING (-Z Extents)
  // -------------------------------------------------------------------------
  // Outer Gimbal Yoke Ring (Pitch Axis)
  const outerYokeGeo = new THREE.TorusGeometry(0.38, 0.035, 12, 32);
  const outerYokeMesh = new THREE.Mesh(outerYokeGeo, jointTitaniumMat);
  outerYokeMesh.name = 'GimbalOuterPitchYoke';
  outerYokeMesh.position.set(0, 0, -0.42);
  root.add(outerYokeMesh);

  // Pitch Axis Bearing Trunnions (Left & Right)
  const trunnionGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.12, 16);
  const leftTrunnion = new THREE.Mesh(trunnionGeo, titaniumAccentMat);
  leftTrunnion.name = 'PitchTrunnionLeft';
  leftTrunnion.rotation.z = Math.PI / 2;
  leftTrunnion.position.set(-0.41, 0, -0.42);
  root.add(leftTrunnion);

  const rightTrunnion = new THREE.Mesh(trunnionGeo, titaniumAccentMat);
  rightTrunnion.name = 'PitchTrunnionRight';
  rightTrunnion.rotation.z = Math.PI / 2;
  rightTrunnion.position.set(0.41, 0, -0.42);
  root.add(rightTrunnion);

  // Inner Gimbal Gimbal Gimbal Ring (Yaw / Roll Axis)
  const innerGimbalGeo = new THREE.TorusGeometry(0.28, 0.028, 12, 32);
  const innerGimbalMesh = new THREE.Mesh(innerGimbalGeo, jointTitaniumMat);
  innerGimbalMesh.name = 'GimbalInnerYawRing';
  innerGimbalMesh.rotation.y = Math.PI / 4;
  innerGimbalMesh.position.set(0, 0, -0.48);
  root.add(innerGimbalMesh);

  // Central Hub Housing
  const centralHubGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.16, 24);
  const centralHubMesh = new THREE.Mesh(centralHubGeo, motorHousingMat);
  centralHubMesh.name = 'CentralGimbalHub';
  centralHubMesh.rotation.x = Math.PI / 2;
  centralHubMesh.position.set(0, 0, -0.54);
  root.add(centralHubMesh);

  // Dual Stepper / Servo Actuator Motor Blocks
  const motorBlockGeo = new THREE.BoxGeometry(0.18, 0.14, 0.18);

  const pitchActuator = new THREE.Mesh(motorBlockGeo, motorHousingMat);
  pitchActuator.name = 'PitchActuatorMotor';
  pitchActuator.position.set(0.32, 0.18, -0.52);
  pitchActuator.rotation.set(0.1, -0.2, 0.15);
  root.add(pitchActuator);

  const yawActuator = new THREE.Mesh(motorBlockGeo, motorHousingMat);
  yawActuator.name = 'YawActuatorMotor';
  yawActuator.position.set(-0.32, -0.18, -0.52);
  yawActuator.rotation.set(-0.15, 0.18, -0.1);
  root.add(yawActuator);

  // Actuator harmonic drive end caps
  const driveCapGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.05, 16);
  const pitchCap = new THREE.Mesh(driveCapGeo, titaniumAccentMat);
  pitchCap.name = 'PitchDriveHarmonicCap';
  pitchCap.rotation.z = Math.PI / 2;
  pitchCap.position.set(0.42, 0.18, -0.52);
  root.add(pitchCap);

  const yawCap = new THREE.Mesh(driveCapGeo, titaniumAccentMat);
  yawCap.name = 'YawDriveHarmonicCap';
  yawCap.rotation.z = Math.PI / 2;
  yawCap.position.set(-0.42, -0.18, -0.52);
  root.add(yawCap);

  // Rear telemetry interface plate and conduit termination (-Z deepest point)
  const rearInterfacePlateGeo = new THREE.CylinderGeometry(0.12, 0.13, 0.04, 16);
  const rearInterfacePlate = new THREE.Mesh(rearInterfacePlateGeo, jointTitaniumMat);
  rearInterfacePlate.name = 'TelemetryInterfacePlate';
  rearInterfacePlate.rotation.x = Math.PI / 2;
  rearInterfacePlate.position.set(0, 0, -0.64);
  root.add(rearInterfacePlate);

  const conduitRingGeo = new THREE.TorusGeometry(0.14, 0.015, 8, 20);
  const conduitRing = new THREE.Mesh(conduitRingGeo, wiringConduitMat);
  conduitRing.name = 'AvionicsWiringConduit';
  conduitRing.position.set(0, 0, -0.61);
  root.add(conduitRing);

  return root;
}