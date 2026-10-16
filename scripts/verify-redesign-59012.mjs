import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const projectRoot = process.cwd();
const verifyDir = path.join(projectRoot, 'artifacts', 'verification');
await mkdir(verifyDir, { recursive: true });

const baseUrl = process.env.VERIFY_URL || 'http://127.0.0.1:59012/';
console.log(`=== Verifying Live Redesigned Suncatcher at ${baseUrl} ===`);

const browser = await chromium.launch({ channel: 'msedge', headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__suncatcherTest));
  await page.waitForTimeout(400);

  // 1. First Screen (Initial State) Verification
  const stage1Layout = await page.evaluate(() => {
    const vpArea = window.innerWidth * window.innerHeight;
    const topBar = document.getElementById('top-bar').getBoundingClientRect();
    const stageCard = document.getElementById('stage-card').getBoundingClientRect();
    const argonBar = document.getElementById('argon-bar').getBoundingClientRect();
    const uiArea =
      topBar.width * topBar.height +
      stageCard.width * stageCard.height +
      argonBar.width * argonBar.height;
    const sceneSharePct = Number(((1 - uiArea / vpArea) * 100).toFixed(1));

    const visibleButtons = Array.from(document.querySelectorAll('button')).filter((b) => {
      const s = window.getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });
    const clippedButtons = visibleButtons
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight;
      })
      .map((b) => b.id || b.textContent.trim());

    return {
      sceneSharePct,
      clippedButtons,
      uiStage: window.__suncatcherTest.getState().uiStage,
      designDrawerOpen: window.__suncatcherTest.getState().designDrawerOpen,
      detailsDrawerOpen: document.getElementById('details-drawer').classList.contains('open'),
      chatDrawerOpen: document.getElementById('argon-chat-drawer').classList.contains('open'),
      objectiveText: document.getElementById('mission-phase-text').textContent.trim(),
    };
  });

  console.log('1. Initial Screen Metrics:', stage1Layout);
  assert.ok(
    stage1Layout.sceneSharePct >= 80,
    `3D scene must occupy >= 80% of screen (got ${stage1Layout.sceneSharePct}%)`
  );
  assert.equal(stage1Layout.clippedButtons.length, 0, 'No visible buttons clipped outside viewport');
  assert.equal(stage1Layout.detailsDrawerOpen, false, 'Details drawer collapsed by default');
  assert.equal(stage1Layout.chatDrawerOpen, false, 'Chat history collapsed by default');

  const shot1 = path.join(verifyDir, 'after-1-initial.png');
  await page.screenshot({ path: shot1 });

  // 2. Design Stage Verification (Expand Design Drawer & Customize to v2 8-Petal Silver Dish)
  await page.click('#toggle-design-drawer-btn');
  await page.waitForTimeout(250);
  await page.click('#preset-petal-btn');
  await page.waitForFunction(() => window.__suncatcherTest.getState().activeDesignVersion >= 2);
  await page.waitForTimeout(300);

  const stage2State = await page.evaluate(() => ({
    uiStage: window.__suncatcherTest.getState().uiStage,
    designDrawerOpen: window.__suncatcherTest.getState().designDrawerOpen,
    activeDesignVersion: window.__suncatcherTest.getState().activeDesignVersion,
    objectiveText: document.getElementById('mission-phase-text').textContent.trim(),
  }));
  console.log('2. Design Stage Metrics:', stage2State);
  assert.equal(stage2State.designDrawerOpen, true, 'Design drawer open during design customization');

  const shot2 = path.join(verifyDir, 'after-2-design.png');
  await page.screenshot({ path: shot2 });

  // 3. Confirm Design -> Generate 3D Reflector -> Mount -> Alignment Stage Verification
  await page.click('#confirm-design-btn');
  await page.waitForFunction(() => window.__suncatcherTest.getState().designConfirmed === true);

  // Verify design drawer automatically closed after confirmation
  const afterConfirm = await page.evaluate(() => ({
    uiStage: window.__suncatcherTest.getState().uiStage,
    designDrawerVisible:
      window.getComputedStyle(document.getElementById('design-editor-drawer')).display !== 'none',
  }));
  assert.equal(afterConfirm.uiStage, 'generate');
  assert.equal(afterConfirm.designDrawerVisible, false, 'Design drawer closes after confirmation');

  // Generate 3D Reflector (using verified fastMode for immediate check, or loadAndMount)
  const genRes = await page.evaluate(async () => {
    const r = await fetch('/api/reflector/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approvedDesignVersion: window.__suncatcherTest.getState().approvedDesignVersion,
        fastMode: true,
      }),
    });
    return r.json();
  });
  assert.equal(genRes.ok, true, '3D reflector generated');

  // Load & mount the generated 3D reflector and set a near-aligned angle so the user can see the active alignment stage
  await page.evaluate(async (meta) => {
    await window.__suncatcherTest.loadAndMountGLBDirect(meta);
    window.__suncatcherTest.setReflectorAngles(-0.18, -0.11);
    // Finish camera tween to Alignment Focus View
    window.__suncatcherTest.stepPhysics(0.05, 20);
  }, genRes.activeReflector);
  await page.waitForTimeout(350);

  const stage3State = await page.evaluate(() => ({
    uiStage: window.__suncatcherTest.getState().uiStage,
    reflectorMounted: window.__suncatcherTest.getState().reflectorMounted,
    beamAngleErrorDeg: window.__suncatcherTest.getState().beamAngleErrorDeg,
    receiverAligned: window.__suncatcherTest.getState().receiverAligned,
    designSectionVisible: document
      .getElementById('stage-section-design')
      .classList.contains('active'),
    alignSectionVisible: document
      .getElementById('stage-section-align')
      .classList.contains('active'),
    objectiveText: document.getElementById('mission-phase-text').textContent.trim(),
  }));
  console.log('3. Alignment Stage Metrics:', stage3State);
  assert.equal(stage3State.uiStage, 'align');
  assert.equal(stage3State.designSectionVisible, false, 'Design panel closed during alignment');
  assert.equal(stage3State.alignSectionVisible, true, 'Alignment controls visible');

  const shot3 = path.join(verifyDir, 'after-3-align.png');
  await page.screenshot({ path: shot3 });

  // 4. Mission Complete Stage Verification (Align Beam to Receiver -> Comms Restored -> Gate Opens -> UI Minimized)
  await page.click('#align-assist-btn');
  await page.evaluate(() => {
    const s = window.__suncatcherTest.getState();
    window.__suncatcherTest.setReflectorAngles(s.targetYawRad, s.targetPitchRad);
    window.__suncatcherTest.stepPhysics(0.05, 25);
  });
  await page.waitForTimeout(450);

  const stage4State = await page.evaluate(() => ({
    uiStage: window.__suncatcherTest.getState().uiStage,
    receiverAligned: window.__suncatcherTest.getState().receiverAligned,
    commsRestored: window.__suncatcherTest.getState().commsRestored,
    doorOpened: window.__suncatcherTest.getState().doorOpened,
    doorOpenProgress: window.__suncatcherTest.getState().doorOpenProgress,
    stageCardDisplay: window.getComputedStyle(document.getElementById('stage-card')).display,
    completionBannerVisible: document
      .getElementById('completion-banner')
      .classList.contains('visible'),
    objectiveText: document.getElementById('mission-phase-text').textContent.trim(),
  }));
  console.log('4. Mission Complete Metrics:', stage4State);
  assert.equal(stage4State.uiStage, 'completed');
  assert.equal(stage4State.receiverAligned, true);
  assert.equal(stage4State.commsRestored, true);
  assert.equal(stage4State.doorOpened, true);
  assert.equal(stage4State.stageCardDisplay, 'none', 'Control card minimized on completion');
  assert.equal(stage4State.completionBannerVisible, true, 'Completion banner displayed');

  const shot4 = path.join(verifyDir, 'after-4-complete.png');
  await page.screenshot({ path: shot4 });

  // Reset server state back to clean initial v1 state so the user opening http://127.0.0.1:59012/ starts fresh
  await page.click('#complete-new-design-btn');
  await page.click('#preset-hex-btn');
  await page.waitForTimeout(200);

  assert.equal(consoleErrors.length, 0, `No console errors: ${consoleErrors.join('; ')}`);
  console.log('=== ALL 4 REDESIGN STAGES VERIFIED SUCCESSFULLY ===');
} finally {
  await browser.close();
}
