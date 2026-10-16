export function buildReflector({ THREE }) {
  const root = new THREE.Group();
  root.name = "GeneratedReflector3D";

  // --- Shared Materials ---
  const mirrorMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f8fc,
    metalness: 0.98,
    roughness: 0.06,
    envMapIntensity: 1.5
  });

  const bezelMaterial = new THREE.MeshStandardMaterial({
    color: 0x9fa8b3,
    metalness: 0.88,
    roughness: 0.28
  });

  const darkTitaniumMaterial = new THREE.MeshStandardMaterial({
    color: 0x24282f,
    metalness: 0.82,
    roughness: 0.45
  });

  const glowingLaserRingMaterial = new THREE.MeshStandardMaterial({
    color: 0xff7b00,
    emissive: 0xff6600,
    emissiveIntensity: 3.2,
    roughness: 0.2,
    metalness: 0.1
  });

  const clampMaterial = new THREE.MeshStandardMaterial({
    color: 0xb4bec8,
    metalness: 0.9,
    roughness: 0.22
  });

  const actuatorHousingMaterial = new THREE.MeshStandardMaterial({
    color: 0x8a929a,
    metalness: 0.85,
    roughness: 0.32
  });

  const motorBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c1e22,
    metalness: 0.7,
    roughness: 0.5
  });

  const conduitMaterial = new THREE.MeshStandardMaterial({
    color: 0x6e7680,
    metalness: 0.92,
    roughness: 0.38
  });

  // ==========================================
  // Part 1: Outer Machined Perimeter Bezel Ring
  // ==========================================
  const bezelGeometry = new THREE.CylinderGeometry(0.88, 0.88, 0.038, 72, 1, true);
  const bezelRim = new THREE.Mesh(bezelGeometry, bezelMaterial);
  bezelRim.name = "OuterBezelRim";
  bezelRim.rotation.x = Math.PI / 2;
  bezelRim.position.z = -0.019;
  root.add(bezelRim);

  const bezelFlangeGeo = new THREE.RingGeometry(0.80, 0.89, 72);
  const bezelFlange = new THREE.Mesh(bezelFlangeGeo, bezelMaterial);
  bezelFlange.name = "BezelFrontFlange";
  bezelFlange.position.z = 0.0;
  root.add(bezelFlange);

  // ==========================================
  // Part 2: Laser Calibration Glowing Ring
  // ==========================================
  const laserRingGeo = new THREE.TorusGeometry(0.78, 0.012, 16, 80);
  const laserRing = new THREE.Mesh(laserRingGeo, glowingLaserRingMaterial);
  laserRing.name = "LaserCalibrationRing";
  laserRing.position.z = 0.012;
  root.add(laserRing);

  // ==========================================
  // Part 3: Inner Recessed Graduation Track
  // ==========================================
  const graduationTrackGeo = new THREE.RingGeometry(0.75, 0.80, 72);
  const graduationTrack = new THREE.Mesh(graduationTrackGeo, darkTitaniumMaterial);
  graduationTrack.name = "GraduationTrack";
  graduationTrack.position.z = 0.005;
  root.add(graduationTrack);

  // ==========================================
  // Part 4: Central Optical Aperture Collar & Hub
  // ==========================================
  const hubGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.05, 36);
  const hubMesh = new THREE.Mesh(hubGeo, darkTitaniumMaterial);
  hubMesh.name = "CentralApertureHub";
  hubMesh.rotation.x = Math.PI / 2;
  hubMesh.position.z = -0.02;
  root.add(hubMesh);

  const innerApertureHoleGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.06, 36);
  const innerAperture = new THREE.Mesh(innerApertureHoleGeo, darkTitaniumMaterial);
  innerAperture.name = "OpticalBoreAperture";
  innerAperture.rotation.x = Math.PI / 2;
  innerAperture.position.z = -0.02;
  root.add(innerAperture);

  // ==========================================
  // Part 5: 8-Petal Parabolic Silver Dish Segments
  // ==========================================
  const petalCount = 8;
  const petalGroup = new THREE.Group();
  petalGroup.name = "EightPetalParabolicAssembly";

  // Procedural aerodynamic curved blade shape
  const petalShape = new THREE.Shape();
  petalShape.moveTo(0.12, 0.0);
  petalShape.bezierCurveTo(0.35, 0.08, 0.58, 0.28, 0.74, 0.14);
  petalShape.bezierCurveTo(0.68, 0.42, 0.42, 0.48, 0.14, 0.18);
  petalShape.lineTo(0.12, 0.0);

  const petalExtrudeSettings = {
    depth: 0.016,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.006,
    bevelThickness: 0.006
  };
  const petalGeo = new THREE.ExtrudeGeometry(petalShape, petalExtrudeSettings);

  for (let i = 0; i < petalCount; i++) {
    const angle = (i * 2 * Math.PI) / petalCount;
    const petalMesh = new THREE.Mesh(petalGeo, mirrorMaterial);
    petalMesh.name = `ReflectorPetal_${i + 1}`;
    petalMesh.rotation.z = angle;
    // Slight forward/dished parabolic tilt towards +Z
    petalMesh.rotation.x = 0.035;
    petalMesh.rotation.y = -0.025;
    petalMesh.position.set(0, 0, 0.008);
    petalGroup.add(petalMesh);
  }
  root.add(petalGroup);

  // ==========================================
  // Part 6: 3 Triangular Perimeter Clamps & Retainers
  // ==========================================
  const clampTriangleShape = new THREE.Shape();
  clampTriangleShape.moveTo(-0.065, -0.045);
  clampTriangleShape.lineTo(0.065, -0.045);
  clampTriangleShape.lineTo(0.0, 0.085);
  clampTriangleShape.closePath();

  // Cutout aperture inside triangle
  const clampHole = new THREE.Path();
  clampHole.moveTo(-0.028, -0.025);
  clampHole.lineTo(0.028, -0.025);
  clampHole.lineTo(0.0, 0.042);
  clampHole.closePath();
  clampTriangleShape.holes.push(clampHole);

  const clampGeo = new THREE.ExtrudeGeometry(clampTriangleShape, {
    depth: 0.024,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.004,
    bevelThickness: 0.004
  });

  const clampAngles = [
    Math.PI / 2,                  // Top (12 o'clock)
    Math.PI / 2 + (2 * Math.PI / 3), // ~7 o'clock
    Math.PI / 2 + (4 * Math.PI / 3)  // ~4 o'clock
  ];

  clampAngles.forEach((ang, idx) => {
    const clampAssembly = new THREE.Group();
    clampAssembly.name = `PerimeterClamp_${idx + 1}`;

    const clampMesh = new THREE.Mesh(clampGeo, clampMaterial);
    clampMesh.position.set(0, 0, 0.015);
    clampAssembly.add(clampMesh);

    // Clamp rear retention jaw block
    const jawBlockGeo = new THREE.BoxGeometry(0.08, 0.09, 0.06);
    const jawMesh = new THREE.Mesh(jawBlockGeo, darkTitaniumMaterial);
    jawMesh.position.set(0, 0.02, -0.02);
    clampAssembly.add(jawMesh);

    // Fastener pins / fiducials
    const boltGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.03, 12);
    const bolt1 = new THREE.Mesh(boltGeo, clampMaterial);
    bolt1.rotation.x = Math.PI / 2;
    bolt1.position.set(-0.04, -0.03, 0.03);
    const bolt2 = bolt1.clone();
    bolt2.position.set(0.04, -0.03, 0.03);
    clampAssembly.add(bolt1);
    clampAssembly.add(bolt2);

    clampAssembly.rotation.z = ang - Math.PI / 2;
    const radius = 0.84;
    clampAssembly.position.set(
      Math.cos(ang) * radius,
      Math.sin(ang) * radius,
      0.0
    );
    root.add(clampAssembly);
  });

  // ==========================================
  // Part 7: Rear Structural Backing Truss & Struts
  // ==========================================
  const rearTrussGroup = new THREE.Group();
  rearTrussGroup.name = "RearBackingTruss";

  const backingHubGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.06, 36);
  const backingHub = new THREE.Mesh(backingHubGeo, darkTitaniumMaterial);
  backingHub.rotation.x = Math.PI / 2;
  backingHub.position.z = -0.08;
  rearTrussGroup.add(backingHub);

  // 6 Radial reinforcement struts connecting center to bezel
  const strutGeo = new THREE.BoxGeometry(0.022, 0.62, 0.028);
  for (let s = 0; s < 6; s++) {
    const sAng = (s * Math.PI) / 3;
    const strutMesh = new THREE.Mesh(strutGeo, bezelMaterial);
    strutMesh.rotation.z = sAng;
    strutMesh.position.set(
      Math.cos(sAng + Math.PI / 2) * 0.42,
      Math.sin(sAng + Math.PI / 2) * 0.42,
      -0.05
    );
    rearTrussGroup.add(strutMesh);
  }
  root.add(rearTrussGroup);

  // ==========================================
  // Part 8: Dual-Axis Gimbal Housing & Actuators
  // ==========================================
  const gimbalAssembly = new THREE.Group();
  gimbalAssembly.name = "DualAxisGimbalAssembly";

  // Heavy primary cylindrical actuator drum (positioned at -Z, slightly offset on Y/X axis)
  const mainActuatorGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.26, 40);
  const mainActuator = new THREE.Mesh(mainActuatorGeo, actuatorHousingMaterial);
  mainActuator.name = "PrimaryGimbalDrum";
  mainActuator.rotation.z = Math.PI / 2;
  mainActuator.position.set(0.38, 0.42, -0.28);
  gimbalAssembly.add(mainActuator);

  // Secondary inner concentric gimbal ring
  const innerGimbalRingGeo = new THREE.TorusGeometry(0.18, 0.025, 20, 48);
  const innerGimbalRing = new THREE.Mesh(innerGimbalRingGeo, bezelMaterial);
  innerGimbalRing.position.set(0.38, 0.42, -0.28);
  gimbalAssembly.add(innerGimbalRing);

  // Gimbal mounting yoke arms extending to the dish frame
  const yokeArmGeo = new THREE.BoxGeometry(0.045, 0.36, 0.06);
  const leftYoke = new THREE.Mesh(yokeArmGeo, darkTitaniumMaterial);
  leftYoke.position.set(0.22, 0.42, -0.20);
  leftYoke.rotation.y = 0.25;
  const rightYoke = leftYoke.clone();
  rightYoke.position.set(0.54, 0.42, -0.20);
  rightYoke.rotation.y = -0.25;
  gimbalAssembly.add(leftYoke);
  gimbalAssembly.add(rightYoke);

  // Stepper drive motor canisters
  const motorGeo = new THREE.BoxGeometry(0.11, 0.11, 0.14);
  const motor1 = new THREE.Mesh(motorGeo, motorBodyMaterial);
  motor1.name = "ElevationStepperMotor";
  motor1.position.set(0.18, 0.62, -0.32);
  const motor2 = new THREE.Mesh(motorGeo, motorBodyMaterial);
  motor2.name = "AzimuthStepperMotor";
  motor2.position.set(0.58, 0.22, -0.32);
  gimbalAssembly.add(motor1);
  gimbalAssembly.add(motor2);

  // Motor end-bells and harness connectors
  const capGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.04, 20);
  const cap1 = new THREE.Mesh(capGeo, actuatorHousingMaterial);
  cap1.rotation.x = Math.PI / 2;
  cap1.position.set(0.18, 0.62, -0.40);
  const cap2 = cap1.clone();
  cap2.position.set(0.58, 0.22, -0.40);
  gimbalAssembly.add(cap1);
  gimbalAssembly.add(cap2);

  // Braided conduits / harness tubes connecting gimbal to backing truss
  const cableCurve1 = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0.18, 0.62, -0.40),
    new THREE.Vector3(0.10, 0.50, -0.48),
    new THREE.Vector3(0.04, 0.30, -0.30),
    new THREE.Vector3(0.0, 0.10, -0.10)
  );
  const cableGeo1 = new THREE.TubeGeometry(cableCurve1, 32, 0.012, 10, false);
  const cableMesh1 = new THREE.Mesh(cableGeo1, conduitMaterial);
  cableMesh1.name = "BraidedPowerConduit_Alpha";
  gimbalAssembly.add(cableMesh1);

  const cableCurve2 = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0.58, 0.22, -0.40),
    new THREE.Vector3(0.48, 0.05, -0.45),
    new THREE.Vector3(0.24, -0.05, -0.28),
    new THREE.Vector3(0.08, -0.04, -0.10)
  );
  const cableGeo2 = new THREE.TubeGeometry(cableCurve2, 32, 0.012, 10, false);
  const cableMesh2 = new THREE.Mesh(cableGeo2, conduitMaterial);
  cableMesh2.name = "BraidedPowerConduit_Beta";
  gimbalAssembly.add(cableMesh2);

  // Rear gimbal mounting frame interface plate (extreme -Z terminus)
  const interfacePlateGeo = new THREE.BoxGeometry(0.44, 0.44, 0.04);
  const interfacePlate = new THREE.Mesh(interfacePlateGeo, darkTitaniumMaterial);
  interfacePlate.name = "GimbalInterfacePylonPlate";
  interfacePlate.position.set(0.40, 0.44, -0.45);
  gimbalAssembly.add(interfacePlate);

  root.add(gimbalAssembly);

  return root;
}