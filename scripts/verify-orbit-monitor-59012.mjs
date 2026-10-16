import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://127.0.0.1:59012/';
const OUT_DIR = path.resolve('artifacts', 'verification');
fs.mkdirSync(OUT_DIR, { recursive: true });

const assert = (cond, msg) => {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
};

(async () => {
  // 0. Verify Backend Satellite Orbit API (/api/orbit) for NORAD 100902 (PROJECT SUNCATCHER M1)
  const orbitApiRes = await fetch(`${BASE_URL}api/orbit`);
  assert(orbitApiRes.ok, 'GET /api/orbit should return 200 OK');
  const orbitApiJson = await orbitApiRes.json();
  assert(orbitApiJson.ok === true, 'GET /api/orbit should return ok: true');
  assert(
    orbitApiJson.elements?.noradId === 100902 &&
      orbitApiJson.elements?.objectName === 'PROJECT SUNCATCHER M1',
    `Expected NORAD 100902 PROJECT SUNCATCHER M1, got ${JSON.stringify(orbitApiJson.elements)}`
  );

  // Reset server state first so we start cleanly
  await fetch(`${BASE_URL}api/design/cancel`, { method: 'POST' });
  await fetch(`${BASE_URL}api/lang`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: 'ko' }),
  });

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__suncatcherTest?.getOrbitState));
  await page.waitForTimeout(500);

  // 1. Verify In-Scene Monitor Placement & Hover Feedback
  const monitorTagBox = await page.locator('#label-orbit-monitor').boundingBox();
  assert(monitorTagBox && monitorTagBox.width > 40, 'In-scene monitor tag #label-orbit-monitor should be visible');
  const monitorTagText = await page.locator('#label-orbit-monitor').textContent();
  assert(monitorTagText.includes('궤도 보기'), `Monitor tag should contain "궤도 보기", got: ${monitorTagText}`);

  // Hover over the 3D monitor in the scene (just below the floating tag)
  const monitorClickX = monitorTagBox.x + monitorTagBox.width / 2;
  const monitorClickY = monitorTagBox.y + monitorTagBox.height + 28;
  await page.mouse.move(monitorClickX, monitorClickY);
  await page.waitForTimeout(200);

  const hoverHint = await page.locator('#mouse-hint-pill').textContent();
  const cursorStyle = await page.evaluate(() => document.getElementById('orbital-canvas').style.cursor);
  assert(cursorStyle === 'pointer', `Expected pointer cursor when hovering 3D monitor, got: ${cursorStyle}`);
  assert(hoverHint.includes('궤도'), `Expected monitor hover hint, got: ${hoverHint}`);

  await page.screenshot({ path: path.join(OUT_DIR, 'orbit-1-inscene-monitor.png') });

  // 2. Click 3D Monitor in Scene -> Opens Orbit Monitor Window (#orbit-modal) at 1x Real-Time Speed
  const beforeOpenOrbit = await page.evaluate(() => window.__suncatcherTest.getOrbitState());
  assert(beforeOpenOrbit.orbitMonitorOpen === false, 'Orbit monitor should start closed');
  assert(beforeOpenOrbit.timeScale === 1, `Default timeScale must be 1 (real-time), got ${beforeOpenOrbit.timeScale}`);
  assert(beforeOpenOrbit.noradId === 100902, `Expected NORAD 100902, got ${beforeOpenOrbit.noradId}`);

  await page.mouse.click(monitorClickX, monitorClickY);
  await page.waitForTimeout(300);

  const openState1 = await page.evaluate(() => window.__suncatcherTest.getOrbitState());
  assert(openState1.orbitMonitorOpen === true, 'Clicking 3D monitor should open Orbit Monitor window');
  assert(openState1.apiSynced === true, 'Orbit monitor should be synced with /api/orbit');

  // Verify the core elements inside Orbit Monitor Window
  const modalMetaText = await page.locator('#ui-orbit-modal-meta').textContent();
  const speedBtnText1 = await page.locator('#orbit-speed-btn').textContent();
  const markerTitleText = await page.locator('#ui-orbit-marker-title').textContent();
  const markerDirText = await page.locator('#ui-orbit-marker-dir').textContent();
  const closeBtnVisible = await page.locator('#close-orbit-modal-btn').isVisible();
  const canvasBox = await page.locator('#orbit-monitor-canvas').boundingBox();

  assert(
    modalMetaText.includes('NORAD 100902') &&
      modalMetaText.includes('PROJECT SUNCATCHER M1') &&
      modalMetaText.includes('km/s') &&
      modalMetaText.includes('1× 실시간'),
    `Meta text missing required API telemetry fields: ${modalMetaText}`
  );
  assert(
    speedBtnText1.includes('1×'),
    `Speed button should show 1x by default, got: ${speedBtnText1}`
  );
  assert(
    markerTitleText.includes('SUNCATCHER') && markerTitleText.includes('현재 위치'),
    `Marker label missing SUNCATCHER / 현재 위치: ${markerTitleText}`
  );
  assert(markerDirText.includes('진행 방향') && markerDirText.includes('km/s'), `Direction label missing 진행 방향 / km/s: ${markerDirText}`);
  assert(closeBtnVisible, 'Close button must be visible');
  assert(canvasBox && canvasBox.width >= 400 && canvasBox.height >= 260, '3D Orbit canvas must have readable size');

  await page.screenshot({ path: path.join(OUT_DIR, 'orbit-2-modal-t0.png') });

  // 3. Verify 1x Real-Time Speed is calm and NOT overly fast (~0.063 deg/sec)
  await page.waitForTimeout(2000);
  const openStateAfter2sRealTime = await page.evaluate(() => window.__suncatcherTest.getOrbitState());
  const realTimeDelta2s =
    (openStateAfter2sRealTime.orbitAngleDeg - openState1.orbitAngleDeg + 360) % 360;
  assert(
    realTimeDelta2s > 0.05 && realTimeDelta2s < 0.5,
    `At 1x real-time speed, 2s orbital movement should be ~0.12-0.15 deg (not overly fast), got ${realTimeDelta2s.toFixed(3)} deg`
  );

  // 4. Verify Speed Toggle Button (#orbit-speed-btn: 1x -> 10x -> 30x -> 1x) & Orbital Progression
  await page.locator('#orbit-speed-btn').click();
  let tScale = await page.evaluate(() => window.__suncatcherTest.getOrbitState().timeScale);
  assert(tScale === 10, `Expected timeScale 10 after first click, got ${tScale}`);

  await page.locator('#orbit-speed-btn').click();
  tScale = await page.evaluate(() => window.__suncatcherTest.getOrbitState().timeScale);
  assert(tScale === 30, `Expected timeScale 30 after second click, got ${tScale}`);

  // Advance 15 seconds at 30x (= 450 seconds of orbital flight, ~28.4 deg) to capture clear movement in screenshot t6
  const openStateAfterAdvance = await page.evaluate(() =>
    window.__suncatcherTest.advanceOrbitSim(1.0, 15)
  );
  const deltaOrbitDeg =
    (openStateAfterAdvance.orbitAngleDeg - openState1.orbitAngleDeg + 360) % 360;
  const deltaEarthSpinDeg =
    (openStateAfterAdvance.earthSpinDeg - openState1.earthSpinDeg + 360) % 360;

  assert(
    deltaOrbitDeg > 20 && deltaOrbitDeg < 40,
    `Expected ~28.5 deg orbital movement after 450s of Keplerian propagation, got ${deltaOrbitDeg.toFixed(2)} deg`
  );
  assert(
    deltaEarthSpinDeg > 1 && deltaEarthSpinDeg < 5 && Math.abs(deltaOrbitDeg - deltaEarthSpinDeg) > 15,
    `Expected distinct Earth axial rotation vs station orbital revolution: orbit=${deltaOrbitDeg.toFixed(2)}, spin=${deltaEarthSpinDeg.toFixed(2)}`
  );
  assert(
    openStateAfterAdvance.latDeg !== openState1.latDeg ||
      openStateAfterAdvance.lonDeg !== openState1.lonDeg,
    'Sub-satellite latitude/longitude must update along the propagated orbit'
  );
  assert(
    Math.abs(openStateAfterAdvance.outWindowEarthPitchRad + openStateAfterAdvance.orbitAngleRad) < 0.01,
    'Out-the-window Earth orbital pitch must be synchronized with orbitSim.orbitAngleRad'
  );
  assert(
    Math.abs(openStateAfterAdvance.outWindowEarthSpinRad - openStateAfterAdvance.earthSpinRad) < 0.01 &&
      Math.abs(openStateAfterAdvance.monitorEarthSpinRad - openStateAfterAdvance.earthSpinRad) < 0.01,
    'Out-the-window Earth spin and Monitor Earth spin must match orbitSim.earthSpinRad'
  );

  await page.screenshot({ path: path.join(OUT_DIR, 'orbit-3-modal-t6.png') });

  // Click #orbit-speed-btn once more to return to 1x Real-Time default
  await page.locator('#orbit-speed-btn').click();
  tScale = await page.evaluate(() => window.__suncatcherTest.getOrbitState().timeScale);
  assert(tScale === 1, `Expected timeScale to cycle back to 1, got ${tScale}`);

  // 5. Verify Input Isolation while Orbit Monitor is Open (Character & Reflector must NOT move)
  const stateBeforeInput = await page.evaluate(() => window.__suncatcherTest.getState());
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyF');
  await page.keyboard.press('KeyG');
  await page.mouse.move(700, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(820, 520, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(250);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');

  const stateAfterInput = await page.evaluate(() => window.__suncatcherTest.getState());
  assert(
    stateBeforeInput.player.position[0] === stateAfterInput.player.position[0] &&
      stateBeforeInput.player.position[2] === stateAfterInput.player.position[2],
    'Player position must NOT change while Orbit Monitor is open'
  );
  assert(
    stateBeforeInput.mountedYawRad === stateAfterInput.mountedYawRad &&
      stateBeforeInput.mountedPitchRad === stateAfterInput.mountedPitchRad,
    'Reflector angles must NOT change while Orbit Monitor is open'
  );

  // 6. Close via Close Button -> Verify Monitor Rendering Pauses while Simulation Time Continues,
  // and Reopening Preserves Advanced Position (Never Resets to 0)
  await page.locator('#close-orbit-modal-btn').click();
  await page.waitForTimeout(150);

  const closedState1 = await page.evaluate(() => window.__suncatcherTest.getOrbitState());
  assert(closedState1.orbitMonitorOpen === false, 'Close button should close Orbit Monitor');
  const framesAtClose = closedState1.monitorRenderFrames;
  const angleAtClose = closedState1.orbitAngleRad;

  await page.waitForTimeout(1200);
  const closedState2 = await page.evaluate(() => window.__suncatcherTest.getOrbitState());
  assert(
    closedState2.monitorRenderFrames === framesAtClose,
    `Monitor WebGL rendering must pause while closed (${framesAtClose} vs ${closedState2.monitorRenderFrames})`
  );
  assert(
    closedState2.orbitAngleRad !== angleAtClose && closedState2.simTimeSec > closedState1.simTimeSec,
    'Simulation time and orbital progression must continue advancing while monitor is closed'
  );

  // Reopen via floating tag #label-orbit-monitor and close via Escape key
  await page.locator('#label-orbit-monitor').click();
  await page.waitForTimeout(200);
  const reopenedState = await page.evaluate(() => window.__suncatcherTest.getOrbitState());
  assert(reopenedState.orbitMonitorOpen === true, 'Reopening via #label-orbit-monitor should succeed');
  assert(
    reopenedState.simTimeSec >= closedState2.simTimeSec,
    'Reopening must preserve advanced orbital position and never reset to start'
  );

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const afterEscState = await page.evaluate(() => window.__suncatcherTest.getOrbitState());
  assert(afterEscState.orbitMonitorOpen === false, 'Escape key should close Orbit Monitor');

  const pointerLockActive = await page.evaluate(() => Boolean(document.pointerLockElement));
  assert(pointerLockActive === false, 'Closing Orbit Monitor must NOT auto-lock pointer');

  // Switch to English briefly to capture English screenshot of Orbit Monitor
  await page.locator('#lang-toggle-btn').click();
  await page.waitForTimeout(150);
  await page.locator('#label-orbit-monitor').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, 'orbit-4-english.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.locator('#lang-toggle-btn').click();
  await page.waitForTimeout(150);

  // 7. Stress-test Opening & Closing 10 times -> Ensure zero duplicate render loops
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.__suncatcherTest.openOrbitMonitor());
    await page.waitForTimeout(30);
    await page.evaluate(() => window.__suncatcherTest.closeOrbitMonitor());
    await page.waitForTimeout(30);
  }
  const loopCheck = await page.evaluate(() => window.__suncatcherTest.getOrbitState());
  assert(
    loopCheck.renderLoopCount === 1,
    `Expected exactly 1 main render loop after 10 open/close cycles, got ${loopCheck.renderLoopCount}`
  );

  // 8. Verify Full Reflector Puzzle (Confirm -> 3D Generate -> Mount -> Manual Align -> Comms Restored)
  // and confirm orbital progression does NOT alter alignment lock
  await page.locator('#confirm-design-btn').click();
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    const st = window.__suncatcherTest.getState();
    const res = await fetch('/api/reflector/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedDesignVersion: st.approvedDesignVersion, fastMode: true }),
    });
    const data = await res.json();
    await window.__suncatcherTest.loadAndMountGLBDirect(data.activeReflector);
  });
  await page.waitForTimeout(300);

  // Align reflector to optimal target
  await page.locator('#align-assist-btn').click();
  await page.waitForTimeout(800);

  const alignedBeforeOrbit = await page.evaluate(() => window.__suncatcherTest.getState());
  assert(alignedBeforeOrbit.receiverAligned === true, 'Receiver should be aligned');
  assert(alignedBeforeOrbit.commsRestored === true, 'Optical comms should be restored');
  assert(alignedBeforeOrbit.doorOpened === true, 'Gate should be opened');

  // Advance orbit by 60 seconds and verify alignment lock does not break
  await page.evaluate(() => window.__suncatcherTest.advanceOrbitSim(1.0, 60));
  const alignedAfterOrbit = await page.evaluate(() => window.__suncatcherTest.getState());
  assert(
    alignedAfterOrbit.receiverAligned === true &&
      alignedAfterOrbit.commsRestored === true &&
      alignedAfterOrbit.beamAngleErrorDeg === alignedBeforeOrbit.beamAngleErrorDeg,
    'Orbital progression must never break reflector alignment or alter beam error'
  );

  // Reset server state back to initial Stage 1 (Design) for clean interactive play
  await fetch(`${BASE_URL}api/design/cancel`, { method: 'POST' });

  assert(consoleErrors.length === 0, `Console errors detected: ${consoleErrors.join('; ')}`);

  const summary = {
    passed: true,
    apiSource: openState1.apiSource,
    noradId: openState1.noradId,
    objectName: openState1.objectName,
    defaultTimeScale: openState1.timeScale,
    realTime2sDeltaDeg: Number(realTimeDelta2s.toFixed(4)),
    initialCoords: { latDeg: openState1.latDeg, lonDeg: openState1.lonDeg },
    advancedCoords: { latDeg: openStateAfterAdvance.latDeg, lonDeg: openStateAfterAdvance.lonDeg },
    deltaOrbitDegAt30x15s: Number(deltaOrbitDeg.toFixed(2)),
    deltaEarthSpinDegAt30x15s: Number(deltaEarthSpinDeg.toFixed(2)),
    openCloseCyclesTested: loopCheck.openCount,
    renderLoopCount: loopCheck.renderLoopCount,
    puzzleAlignedAfterOrbitAdvance: alignedAfterOrbit.receiverAligned,
    consoleErrorCount: consoleErrors.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
})();
