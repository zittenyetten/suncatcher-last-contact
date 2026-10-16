import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';
import {
  extractAndValidateCode,
  evaluateAndVerifyReflector3D,
} from '../server/reflector-3d-generator.mjs';
import { parseLyriaInteractionResponse } from '../server/ai-services.mjs';

test('QA Boundary & State Machine Verification (seed.qa.txt)', async (t) => {
  const app = await createApp({ projectRoot: process.cwd() });
  await app.ready();

  t.after(async () => {
    await app.close();
  });

  await t.test('1. Rejects empty and over-limit inputs for dialogue and design preview', async () => {
    const emptyDlg = await app.inject({
      method: 'POST',
      url: '/api/dialogue',
      payload: { message: '   ' },
    });
    assert.equal(emptyDlg.statusCode, 400);
    assert.equal(emptyDlg.json().code, 'EMPTY_MESSAGE');

    const longDlg = await app.inject({
      method: 'POST',
      url: '/api/dialogue',
      payload: { message: 'A'.repeat(505) },
    });
    assert.equal(longDlg.statusCode, 400);
    assert.equal(longDlg.json().code, 'MESSAGE_TOO_LONG');

    const emptyPreview = await app.inject({
      method: 'POST',
      url: '/api/design/preview',
      payload: { description: '' },
    });
    assert.equal(emptyPreview.statusCode, 400);
    assert.equal(emptyPreview.json().code, 'EMPTY_DESCRIPTION');

    const longPreview = await app.inject({
      method: 'POST',
      url: '/api/design/preview',
      payload: { description: 'B'.repeat(605) },
    });
    assert.equal(longPreview.statusCode, 400);
    assert.equal(longPreview.json().code, 'DESCRIPTION_TOO_LONG');
  });

  await t.test('2. Blocks 3D generation before player explicitly confirms latest design', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/reflector/generate',
      payload: { requestId: 'req-unconfirmed', approvedDesignVersion: 1 },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'DESIGN_NOT_CONFIRMED');
  });

  await t.test('3. Rejects stale design version confirmation and invalidates prior confirmation on modification', async () => {
    // Confirm v1
    const conf1 = await app.inject({
      method: 'POST',
      url: '/api/design/confirm',
      payload: { designVersion: 1 },
    });
    assert.equal(conf1.statusCode, 200);
    assert.equal(conf1.json().designConfirmed, true);

    // Modify design -> increments to v2 and invalidates v1 confirmation
    const mod = await app.inject({
      method: 'POST',
      url: '/api/design/preview',
      payload: {
        description: '8-petal circular parabolic silver dish reflector',
        modificationNote: 'Add orange calibration ring',
      },
    });
    assert.equal(mod.statusCode, 200);
    assert.equal(mod.json().activeDesignVersion, 2);
    assert.equal(mod.json().designConfirmed, false);

    // Attempting to confirm stale v1 fails with 409
    const staleConf = await app.inject({
      method: 'POST',
      url: '/api/design/confirm',
      payload: { designVersion: 1 },
    });
    assert.equal(staleConf.statusCode, 409);
    assert.equal(staleConf.json().code, 'STALE_DESIGN_VERSION');

    // Attempting 3D generation with stale v1 fails
    const staleGen = await app.inject({
      method: 'POST',
      url: '/api/reflector/generate',
      payload: { requestId: 'req-stale-v1', approvedDesignVersion: 1 },
    });
    assert.equal(staleGen.statusCode, 400);
  });

  await t.test('4. Enforces finite timeout and malformed 3D response rejection while preserving scene', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/design/confirm',
      payload: { designVersion: 2 },
    });

    const timeoutRes = await app.inject({
      method: 'POST',
      url: '/api/reflector/generate',
      payload: {
        requestId: 'req-timeout-test',
        approvedDesignVersion: 2,
        timeoutMs: 1200,
        simulateTimeout: true,
      },
    });
    assert.equal(timeoutRes.statusCode, 504);
    assert.equal(timeoutRes.json().code, 'GENERATION_TIMEOUT');
    assert.equal(timeoutRes.json().scenePreserved, true);
    assert.equal(timeoutRes.json().retryAvailable, true);

    const malformedRes = await app.inject({
      method: 'POST',
      url: '/api/reflector/generate',
      payload: {
        requestId: 'req-malformed-test',
        approvedDesignVersion: 2,
        simulateMalformedOutput: true,
      },
    });
    assert.equal(malformedRes.statusCode, 422);
    assert.equal(malformedRes.json().code, 'MALFORMED_3D_RESPONSE');
    assert.equal(malformedRes.json().scenePreserved, true);
  });

  await t.test('5. AST & 3D Volume Validator rejects 2D planes and TextureLoader replacements', () => {
    assert.throws(
      () =>
        extractAndValidateCode(`
          export function buildReflector({ THREE }) {
            const tex = new THREE.TextureLoader().load('fake.png');
            return new THREE.Group();
          }
        `),
      /TextureLoader/
    );

    const flatPlaneCode = `
      export function buildReflector({ THREE }) {
        const g = new THREE.Group();
        for (let i = 0; i < 6; i++) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5, 8, 8), new THREE.MeshStandardMaterial());
          g.add(m);
        }
        return g;
      }
    `;
    assert.throws(() => evaluateAndVerifyReflector3D(flatPlaneCode), /평면\(2D\) 대체 거부/);
  });

  await t.test('6. Lyria Interactions API parser & /api/lyria endpoints validate outputs and steps[].content', async () => {
    const fromOutputs = parseLyriaInteractionResponse({
      outputs: [
        { type: 'text', text: '[Intro]\nWarm ambient synth pads' },
        { type: 'audio', mime_type: 'audio/mpeg', data: 'SUQzBAAAAAA=' },
      ],
    });
    assert.equal(fromOutputs.audioData, 'SUQzBAAAAAA=');
    assert.equal(fromOutputs.mimeType, 'audio/mpeg');
    assert.equal(fromOutputs.text, '[Intro]\nWarm ambient synth pads');
    assert.equal(fromOutputs.audioDataUrl, 'data:audio/mpeg;base64,SUQzBAAAAAA=');

    const fromSteps = parseLyriaInteractionResponse({
      steps: [
        {
          content: [
            { type: 'text', text: '[Verse 1]\nMirror the sun' },
            { type: 'audio', mime_type: 'audio/mpeg', data: 'UklGRg==' },
          ],
        },
      ],
    });
    assert.equal(fromSteps.audioData, 'UklGRg==');
    assert.equal(fromSteps.mimeType, 'audio/mpeg');
    assert.equal(fromSteps.text, '[Verse 1]\nMirror the sun');

    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/lyria/status',
    });
    assert.equal(statusRes.statusCode, 200);
    const statusJson = statusRes.json();
    assert.equal(
      statusJson.endpoint,
      'https://generativelanguage.googleapis.com/v1beta/interactions'
    );
    assert.deepEqual(statusJson.supportedModels, ['lyria-3-clip-preview', 'lyria-3.5']);

    const emptyPromptRes = await app.inject({
      method: 'POST',
      url: '/api/lyria/generate',
      payload: { model: 'lyria-3-clip-preview', input: '   ' },
    });
    assert.equal(emptyPromptRes.statusCode, 400);
    assert.equal(emptyPromptRes.json().code, 'EMPTY_LYRIA_PROMPT');
  });
});

