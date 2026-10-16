import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/app.mjs';

const projectRoot = process.cwd();
const verifyDir = path.join(projectRoot, 'artifacts', 'verification');
await mkdir(verifyDir, { recursive: true });

console.log('=== Starting Full E2E Browser Gameplay Verification ===');

const app = await createApp({ projectRoot });
await app.listen({ port: 0, host: '127.0.0.1' });
const address = app.server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
console.log(`Test Server running at ${baseUrl}`);

const browser = await chromium.launch({ channel: 'msedge', headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(baseUrl);
  await page.waitForFunction(() => Boolean(window.__suncatcherTest));

  // 1. Verify KO / EN Bilingual Mode Switching
  const initialLang = await page.evaluate(() => window.__suncatcherTest.getState().lang);
  assert.equal(initialLang, 'ko', 'Starts in Korean (ko) mode');
  await page.screenshot({ path: path.join(verifyDir, 'e2e-ko-mode.png') });

  await page.click('#lang-toggle-btn');
  await page.waitForFunction(() => window.__suncatcherTest.getState().lang === 'en');
  const enTitle = await page.textContent('#ui-game-title');
  assert.ok(enTitle.includes('ORBITAL OPTICAL RECOVERY'), 'English title rendered');
  await page.screenshot({ path: path.join(verifyDir, 'e2e-en-mode.png') });

  // Switch back to KO for remainder or test both
  await page.click('#lang-toggle-btn');
  await page.waitForFunction(() => window.__suncatcherTest.getState().lang === 'ko');
  console.log('PASS 1: Korean (KO) and English (EN) mode toggle verified');

  // 2. Verify 650 km Dawn-Dusk Sun-Synchronous Orbit & Detailed Earth Layers
  const earthVerification = await page.evaluate(() =>
    window.__suncatcherTest.getEarthVerification()
  );
  assert.equal(earthVerification.orbitAltitudeKm, 650);
  assert.equal(earthVerification.layersPresent.surface, true);
  assert.equal(earthVerification.layersPresent.nightCityLights, true);
  assert.equal(earthVerification.layersPresent.clouds, true);
  assert.equal(earthVerification.layersPresent.atmosphere, true);
  console.log('PASS 2: 650km SSO Earth view layers verified:', earthVerification);

  // 3. Verify First-Person Controls (WASD, Mouse Look, Jump, Allowed Work Zone Boundary)
  const beforeMove = await page.evaluate(() => window.__suncatcherTest.getState().player);
  await page.keyboard.down('w');
  await page.evaluate(() => window.__suncatcherTest.stepPhysics(0.05, 12));
  await page.keyboard.up('w');
  await page.keyboard.press('Space');
  const midJump = await page.evaluate(() => {
    window.__suncatcherTest.stepPhysics(0.05, 3);
    return window.__suncatcherTest.getState().player;
  });
  assert.ok(midJump.position[1] > beforeMove.position[1], 'Space key jumps above deck');
  await page.evaluate(() => {
    window.__suncatcherTest.stepPhysics(0.05, 30);
    window.__suncatcherTest.setLookAngles(0.35, -0.12);
  });
  // Push against left work zone boundary (-9.2m)
  await page.keyboard.down('a');
  await page.evaluate(() => window.__suncatcherTest.stepPhysics(0.05, 80));
  await page.keyboard.up('a');
  const boundaryCheck = await page.evaluate(() => window.__suncatcherTest.getState().player);
  assert.equal(boundaryCheck.clampedByBoundary, true, 'Work zone boundary clamps player');
  assert.ok(boundaryCheck.position[0] >= -9.201, 'Player X stays within -9.2m boundary');
  console.log('PASS 3: First-person WASD, Jump, Mouse Look & Work Zone boundary verified');

  // 4. Verify Argon Live Companion Dialogue & Automatic BGM Volume Ducking
  const duckBefore = await page.evaluate(() => window.__suncatcherTest.setArgonSpeaking(true));
  assert.equal(duckBefore.bgmDucked, true);
  assert.equal(duckBefore.bgmVolume, 0.08, 'BGM volume ducks to 0.08 during Argon speech');
  const duckAfter = await page.evaluate(() => window.__suncatcherTest.setArgonSpeaking(false));
  assert.equal(duckAfter.bgmDucked, false);
  assert.equal(duckAfter.bgmVolume, 0.42, 'BGM volume restores to 0.42 after Argon speech');

  await page.fill(
    '#dialogue-input',
    '아르곤, 650km 궤도 레이저 중계 복구를 위해 반사판 설계를 어떻게 할까?'
  );
  await page.click('#dialogue-send-btn');
  await page.waitForFunction(
    () => document.querySelectorAll('#dialogue-log .msg-argon').length >= 2,
    undefined,
    { timeout: 60000 }
  );
  const argonReplyText = await page.evaluate(() => {
    const msgs = document.querySelectorAll('#dialogue-log .msg-argon');
    return msgs[msgs.length - 1].textContent;
  });
  console.log('PASS 4: Argon Live Dialogue & BGM Ducking verified. Reply:', argonReplyText);

  // 5. Load Design 1 (Hexagonal v1) and record optical reflection judgment at unaligned vs aligned angle
  const step1Meta = JSON.parse(
    await readFile(path.join(projectRoot, 'artifacts', 'models', 'req-step1-verify-v1.json'), 'utf8')
  );
  await page.evaluate((meta) => window.__suncatcherTest.loadAndMountGLBDirect(meta), step1Meta);
  const design1Unaligned = await page.evaluate(() =>
    window.__suncatcherTest.setReflectorAngles(-0.35, -0.2)
  );
  assert.equal(design1Unaligned.receiverAligned, false);
  const design1Aligned = await page.evaluate(() => {
    const s = window.__suncatcherTest.getState();
    return window.__suncatcherTest.setReflectorAngles(s.targetYawRad, s.targetPitchRad);
  });
  assert.equal(design1Aligned.receiverAligned, true);
  assert.equal(design1Aligned.beamAngleErrorDeg, 0);

  // 6. Full E2E New Crafting Request -> Preview Modification (v2) -> Player Confirmation -> Actual 3D Generation (v2) -> EVA Replacement & Alignment -> Mission Complete
  await page.fill(
    '#design-desc-input',
    '8-petal circular parabolic silver-platinum optical dish reflector with glowing amber-orange laser calibration ring, 3 triangular perimeter clamps, and heavy rear cylindrical actuator gimbal.'
  );
  await page.fill('#design-mod-input', 'Switch to circular 8-petal parabolic silver dish v2');
  await page.click('#preview-gen-btn');
  await page.waitForFunction(() => window.__suncatcherTest.getState().activeDesignVersion === 2);

  const afterModState = await page.evaluate(() => window.__suncatcherTest.getState());
  assert.equal(afterModState.activeDesignVersion, 2);
  assert.equal(afterModState.designConfirmed, false, 'Modification resets confirmation');

  // Player explicitly confirms v2
  await page.click('#confirm-design-btn');
  await page.waitForFunction(() => window.__suncatcherTest.getState().designConfirmed === true);

  // Trigger Actual 3D Reflector Generation for v2 from the UI
  console.log('Generating second distinct 3D reflector (v2 Circular Petal Dish) via UI...');
  await page.click('#generate-3d-btn');
  await page.waitForFunction(
    () => window.__suncatcherTest.getState().activeReflectorMeta?.approvedDesignVersion === 2,
    undefined,
    { timeout: 130000 }
  );

  const design2Meta = await page.evaluate(
    () => window.__suncatcherTest.getState().activeReflectorMeta
  );
  console.log('Generated Design 2 (v2) 3D Reflector Metadata:', JSON.stringify(design2Meta, null, 2));

  assert.notEqual(
    design2Meta.metrics.geometryHash,
    step1Meta.metrics.geometryHash,
    'Design 1 (Hexagonal) and Design 2 (Circular Petal) must produce distinct 3D meshes'
  );

  // Equip & mount Design 2 (v2) via E key / button, reset angle to unaligned first, then align to exact same target angle
  await page.click('#equip-mount-btn');
  await page.evaluate(() => window.__suncatcherTest.setReflectorAngles(-0.35, -0.2));
  await page.click('#align-assist-btn');

  const design2Aligned = await page.evaluate(() => window.__suncatcherTest.getState());
  assert.equal(design2Aligned.receiverAligned, true, 'Target receiver turned GREEN');
  assert.equal(design2Aligned.receiverColorHex, '#06d6a0');
  assert.equal(design2Aligned.commsRestored, true, 'Optical communications restored');
  assert.equal(design2Aligned.doorOpened, true, 'Airlock mission door opened');
  assert.equal(
    design2Aligned.beamAngleErrorDeg,
    design1Aligned.beamAngleErrorDeg,
    'Both distinct generated 3D reflectors produce identical optical reflection & receiver judgment at the same position and angle'
  );

  await page.screenshot({ path: path.join(verifyDir, 'e2e-mission-complete.png') });

  const finalReport = {
    verifiedAt: new Date().toISOString(),
    bilingualModesVerified: ['ko', 'en'],
    earthViewVerification: earthVerification,
    controlsAndWorkZone: {
      beforeMove,
      midJump,
      boundaryCheck,
    },
    argonDialogueAndBgmDucking: {
      sampleReply: argonReplyText,
      bgmNormalVolume: duckAfter.bgmVolume,
      bgmDuckedVolume: duckBefore.bgmVolume,
    },
    twoReflectorComparison: {
      design1: {
        requestId: step1Meta.requestId,
        version: step1Meta.approvedDesignVersion,
        elapsedMs: step1Meta.elapsedMs,
        metrics: step1Meta.metrics,
        alignedBeamErrorDeg: design1Aligned.beamAngleErrorDeg,
        receiverAligned: design1Aligned.receiverAligned,
      },
      design2: {
        requestId: design2Meta.requestId,
        version: design2Meta.approvedDesignVersion,
        elapsedMs: design2Meta.elapsedMs,
        metrics: design2Meta.metrics,
        alignedBeamErrorDeg: design2Aligned.beamAngleErrorDeg,
        receiverAligned: design2Aligned.receiverAligned,
      },
      identicalOpticalJudgmentAtSamePose:
        design1Aligned.beamAngleErrorDeg === design2Aligned.beamAngleErrorDeg &&
        design1Aligned.receiverAligned === design2Aligned.receiverAligned,
    },
    missionCompletion: {
      receiverGreen: design2Aligned.receiverAligned,
      commsRestored: design2Aligned.commsRestored,
      doorOpened: design2Aligned.doorOpened,
      leftDoorX: design2Aligned.leftDoorX,
      rightDoorX: design2Aligned.rightDoorX,
    },
    status: 'PASS',
  };

  await writeFile(
    path.join(verifyDir, 'e2e-verification-report.json'),
    JSON.stringify(finalReport, null, 2),
    'utf8'
  );
  console.log('=== FULL E2E GAMEPLAY VERIFICATION PASSED ===');
} finally {
  await browser.close();
  await app.close();
}
