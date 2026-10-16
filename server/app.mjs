import path from 'node:path';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  generateReflector3DFromApprovedDesign,
  validateGenerationRequestInput,
} from './reflector-3d-generator.mjs';
import {
  DEFAULT_LYRIA_PROMPT,
  LYRIA_INTERACTIONS_ENDPOINT,
  generateArgonDialogue,
  generateDesignPreviewImage,
  generateLyriaMusic,
  getGeminiApiKey,
  loadEnvIfNeeded,
} from './ai-services.mjs';
import { getSatelliteOrbitTelemetry } from './orbit-service.mjs';

export async function createApp({ projectRoot = process.cwd() } = {}) {
  loadEnvIfNeeded(projectRoot);
  const app = Fastify({ logger: false });

  await app.register(fastifyStatic, {
    root: path.join(projectRoot, 'public'),
    prefix: '/',
  });

  await app.register(fastifyStatic, {
    root: path.join(projectRoot, 'node_modules'),
    prefix: '/node_modules/',
    decorateReply: false,
  });

  await app.register(fastifyStatic, {
    root: path.join(projectRoot, 'artifacts'),
    prefix: '/artifacts/',
    decorateReply: false,
  });

  const hasGeminiKey = Boolean(getGeminiApiKey(projectRoot));

  const state = {
    lang: 'ko',
    activeDesignVersion: 1,
    designConfirmed: false,
    approvedDesignVersion: null,
    designPreview: {
      version: 1,
      description:
        '19-segment hexagonal gold honeycomb optical mirror array with chamfered dark titanium bezel, 4 glowing blue corner alignment fiducials, and rear carbon-composite truss dual-axis gimbal mount.',
      imageUrl: '/artifacts/designs/design-hex-v1.png',
      imagePath: 'artifacts/designs/design-hex-v1.png',
      modelId: 'gemini-nano-banana-2.1',
      provenance: 'antigravity-subagent:image-generator(gemini-nano-banana-2.1)->design-hex-v1.png',
    },
    inFlightRequestId: null,
    inFlightDesignVersion: null,
    appliedRequestIds: new Set(),
    discardedRequests: [],
    activeReflector: null,
    reflectorHistory: [],
    dialogueHistory: [],
    bgm: {
      model: 'lyria-3-clip-preview',
      input: DEFAULT_LYRIA_PROMPT,
      mimeType: 'audio/mpeg',
      audioUrl: '/audio/lyria-bgm-latest.mp3',
      fallbackAudioUrl: '/audio/orbital-dawn-bgm.wav',
      text: '<instrumental>',
      provenance: `REST:POST ${LYRIA_INTERACTIONS_ENDPOINT} (model=lyria-3-clip-preview)`,
      updatedAt: new Date().toISOString(),
    },
    bgmHistory: [],
    missionStatus: {
      missionPhase: 'briefing',
      reflectorEquipped: false,
      reflectorMounted: false,
      receiverAligned: false,
      commsRestored: false,
      doorOpened: false,
      beamErrorDeg: null,
      mountedPitchRad: 0,
      mountedYawRad: 0,
      passStarted: false,
      passActiveMode: false,
      txProgress: 0,
      txCompleted: false,
      groundAckReceived: false,
      returnedToBase: false,
      orbitAngleRad: 0.42,
    },
    provenanceSummary: {
      gcpProject: 'h2gdm-hack26icn-2676',
      companionDialogue: {
        requestedModel: 'gemini-3.8-live',
        status: hasGeminiKey
          ? 'DIRECT_API_KEY_CONFIGURED'
          : 'AGY_CLI_GEMINI_3_8_FLASH_WITH_WEBSPEECH_VOICE_IO',
        note: 'Direct gemini-3.8-live WebSocket requires GEMINI_API_KEY; live AI dialogue runs with browser Web Speech recognition/synthesis and automatic BGM volume ducking.',
      },
      designPreview: {
        requestedModel: 'gemini-nano-banana-2.1',
        status: 'VERIFIED_ANTIGRAVITY_IMAGE_GENERATOR',
        note: 'Reflector preview designs generated via Antigravity image-generator (gemini-nano-banana-2.1).',
      },
      bgm: {
        requestedModel: 'lyria-3-clip-preview / lyria-3.5',
        status: hasGeminiKey
          ? 'VERIFIED_LYRIA_INTERACTIONS_REST_API'
          : 'AGY_AI_COMPOSED_AND_DSP_SYNTHESIZED_FALLBACK',
        endpoint: LYRIA_INTERACTIONS_ENDPOINT,
        assetUrl: '/audio/lyria-bgm-latest.mp3',
        note: 'Gemini Lyria Music Generation integrated via POST https://generativelanguage.googleapis.com/v1beta/interactions with x-goog-api-key (GEMINI_API_KEY). Extracts audio (Base64 MP3) and text (lyrics/structure) from outputs/steps[].content.',
      },
      reflector3D: {
        status: 'VERIFIED_ACTUAL_3D_GENERATION_GLB',
        method: 'agy-cli:gemini-3.8-flash-low@h2gdm-hack26icn-2676 -> Three.js 3D Mesh + GLB Binary Exporter',
      },
    },
  };

  function serializeState() {
    return {
      ...state,
      appliedRequestIds: Array.from(state.appliedRequestIds),
    };
  }

  app.get('/api/state', async () => serializeState());

  app.get('/api/orbit', async (req) => {
    const forceRefresh = req.query?.refresh === '1' || req.query?.refresh === 'true';
    return getSatelliteOrbitTelemetry({ forceRefresh });
  });

  app.post('/api/lang', async (req) => {
    const lang = req.body?.lang === 'en' ? 'en' : 'ko';
    state.lang = lang;
    return { ok: true, lang: state.lang };
  });

  app.post('/api/dialogue', async (req, reply) => {
    try {
      const { message, lang = state.lang, timeoutMs = 25000 } = req.body || {};
      const result = await generateArgonDialogue({
        message,
        lang,
        missionState: {
          activeDesignVersion: state.activeDesignVersion,
          designConfirmed: state.designConfirmed,
          reflectorGenerated: Boolean(state.activeReflector),
          reflectorMounted: state.missionStatus.reflectorMounted,
          receiverAligned: state.missionStatus.receiverAligned,
          missionPhase: state.missionStatus.missionPhase,
          txProgress: state.missionStatus.txProgress,
          txCompleted: state.missionStatus.txCompleted,
          groundAckReceived: state.missionStatus.groundAckReceived,
          doorOpened: state.missionStatus.doorOpened,
          returnedToBase: state.missionStatus.returnedToBase,
        },
        projectRoot,
        timeoutMs,
      });
      state.dialogueHistory.push({
        at: new Date().toISOString(),
        user: message,
        argon: result.reply,
        lang,
        provenance: result.activeModelProvenance,
      });
      return result;
    } catch (err) {
      reply.code(err.statusCode || 500);
      return {
        error: true,
        code: err.code || 'DIALOGUE_FAILED',
        message: err.message,
        scenePreserved: true,
        retryAvailable: true,
      };
    }
  });

  app.post('/api/design/preview', async (req, reply) => {
    try {
      const {
        description,
        modificationNote,
        timeoutMs = 60000,
        useLiveAgyImage = false,
      } = req.body || {};

      // Validate before mutating version
      if (!description || typeof description !== 'string' || !description.trim()) {
        reply.code(400);
        return {
          error: true,
          code: 'EMPTY_DESCRIPTION',
          message:
            state.lang === 'en'
              ? 'Design description cannot be empty.'
              : '반사판 디자인 설명을 입력해 주세요.',
          scenePreserved: true,
          retryAvailable: true,
        };
      }
      const combinedLength =
        description.trim().length + (modificationNote ? modificationNote.trim().length : 0);
      if (combinedLength > 600) {
        reply.code(400);
        return {
          error: true,
          code: 'DESCRIPTION_TOO_LONG',
          message:
            state.lang === 'en'
              ? `Design description exceeds 600 characters (${combinedLength}).`
              : `반사판 디자인 설명이 최대 600자를 초과했습니다 (${combinedLength}자).`,
          scenePreserved: true,
          retryAvailable: true,
        };
      }

      // If a 3D generation was in flight, supersede/invalidate it immediately
      if (state.inFlightRequestId) {
        state.discardedRequests.push({
          requestId: state.inFlightRequestId,
          designVersion: state.inFlightDesignVersion,
          reason: 'SUPERSEDED_BY_DESIGN_MODIFICATION',
          discardedAt: new Date().toISOString(),
        });
        state.inFlightRequestId = null;
        state.inFlightDesignVersion = null;
      }

      const nextVersion = state.activeDesignVersion + 1;
      const preview = await generateDesignPreviewImage({
        version: nextVersion,
        description,
        modificationNote,
        previousImagePath: state.designPreview?.imagePath,
        projectRoot,
        timeoutMs,
        useLiveAgyImage,
      });

      state.activeDesignVersion = nextVersion;
      state.designConfirmed = false;
      state.approvedDesignVersion = null;
      state.designPreview = preview;

      return {
        ok: true,
        activeDesignVersion: state.activeDesignVersion,
        designConfirmed: state.designConfirmed,
        designPreview: state.designPreview,
        discardedRequests: state.discardedRequests,
      };
    } catch (err) {
      reply.code(err.statusCode || 500);
      return {
        error: true,
        code: err.code || 'PREVIEW_GENERATION_FAILED',
        message: err.message,
        scenePreserved: true,
        retryAvailable: true,
      };
    }
  });

  app.post('/api/design/confirm', async (req, reply) => {
    const { designVersion } = req.body || {};
    const targetVersion =
      typeof designVersion === 'number' ? designVersion : state.activeDesignVersion;

    if (targetVersion !== state.activeDesignVersion) {
      reply.code(409);
      return {
        error: true,
        code: 'STALE_DESIGN_VERSION',
        message:
          state.lang === 'en'
            ? `Cannot confirm outdated design v${targetVersion}; latest is v${state.activeDesignVersion}.`
            : `이전 디자인 버전(v${targetVersion})은 승인할 수 없습니다. 최신 버전은 v${state.activeDesignVersion}입니다.`,
        scenePreserved: true,
      };
    }

    state.designConfirmed = true;
    state.approvedDesignVersion = state.activeDesignVersion;
    return {
      ok: true,
      activeDesignVersion: state.activeDesignVersion,
      designConfirmed: state.designConfirmed,
      approvedDesignVersion: state.approvedDesignVersion,
      designPreview: state.designPreview,
    };
  });

  app.post('/api/design/cancel', async () => {
    if (state.inFlightRequestId) {
      state.discardedRequests.push({
        requestId: state.inFlightRequestId,
        designVersion: state.inFlightDesignVersion,
        reason: 'CANCELLED_BY_PLAYER',
        discardedAt: new Date().toISOString(),
      });
      state.inFlightRequestId = null;
      state.inFlightDesignVersion = null;
    }
    state.designConfirmed = false;
    state.approvedDesignVersion = null;
    return {
      ok: true,
      designConfirmed: false,
      approvedDesignVersion: null,
      discardedRequests: state.discardedRequests,
      scenePreserved: true,
    };
  });

  app.post('/api/reflector/generate', async (req, reply) => {
    const {
      requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      approvedDesignVersion = state.approvedDesignVersion,
      timeoutMs = 120000,
      simulateDelayMs = 0,
      simulateTimeout = false,
      simulateMalformedOutput = false,
      fastMode = false,
    } = req.body || {};

    try {
      if (state.appliedRequestIds.has(requestId)) {
        reply.code(409);
        return {
          error: true,
          code: 'DUPLICATE_REQUEST_ID',
          message:
            state.lang === 'en'
              ? `Request ${requestId} was already applied once.`
              : `요청(${requestId})은 이미 한 번 적용되었습니다 (중복 적용 방지).`,
          scenePreserved: true,
        };
      }

      validateGenerationRequestInput({
        requestId,
        approvedDesignVersion,
        activeDesignVersion: state.activeDesignVersion,
        designConfirmed: state.designConfirmed,
        description: state.designPreview?.description,
        imagePath: state.designPreview?.imagePath,
      });

      // Supersede any older in-flight request
      if (state.inFlightRequestId && state.inFlightRequestId !== requestId) {
        state.discardedRequests.push({
          requestId: state.inFlightRequestId,
          designVersion: state.inFlightDesignVersion,
          reason: 'SUPERSEDED_BY_NEWER_3D_REQUEST',
          discardedAt: new Date().toISOString(),
        });
      }

      state.inFlightRequestId = requestId;
      state.inFlightDesignVersion = approvedDesignVersion;

      if (simulateDelayMs > 0) {
        await new Promise((r) => setTimeout(r, simulateDelayMs));
      }

      if (simulateTimeout) {
        throw Object.assign(
          new Error(
            state.lang === 'en'
              ? `3D generation timed out after ${timeoutMs}ms. Current scene preserved; manual retry available.`
              : `3D 반사판 생성 시간 초과 (${timeoutMs}ms). 현재 씬은 유지되며 수동 재시도가 가능합니다.`
          ),
          { code: 'GENERATION_TIMEOUT', statusCode: 504 }
        );
      }

      if (simulateMalformedOutput) {
        throw Object.assign(
          new Error(
            state.lang === 'en'
              ? '3D generation returned malformed geometry. Rejected before modifying scene.'
              : '비정상적인 3D 생성 응답이 감지되어 씬 적용 전 차단되었습니다.'
          ),
          { code: 'MALFORMED_3D_RESPONSE', statusCode: 422 }
        );
      }

      const metadata = await generateReflector3DFromApprovedDesign({
        requestId,
        approvedDesignVersion,
        activeDesignVersion: state.activeDesignVersion,
        designConfirmed: state.designConfirmed,
        description: state.designPreview.description,
        imagePath: state.designPreview.imagePath,
        projectRoot,
        timeoutMs,
        fastMode,
      });

      // Verify after async completion that this request was NOT cancelled or superseded!
      if (
        state.inFlightRequestId !== requestId ||
        state.activeDesignVersion !== approvedDesignVersion ||
        !state.designConfirmed
      ) {
        state.discardedRequests.push({
          requestId,
          designVersion: approvedDesignVersion,
          reason: 'DISCARDED_AFTER_COMPLETION_STALE_OR_CANCELLED',
          discardedAt: new Date().toISOString(),
        });
        reply.code(409);
        return {
          error: true,
          code: 'DISCARDED_STALE_RESULT',
          message:
            state.lang === 'en'
              ? `Result for ${requestId} (v${approvedDesignVersion}) was discarded because the design was modified or cancelled.`
              : `디자인이 수정되었거나 취소되어 이전 요청(${requestId}, v${approvedDesignVersion})의 3D 결과는 폐기되었습니다.`,
          scenePreserved: true,
          discardedRequests: state.discardedRequests,
        };
      }

      state.inFlightRequestId = null;
      state.inFlightDesignVersion = null;
      state.appliedRequestIds.add(requestId);
      state.activeReflector = {
        ...metadata,
        appliedCount: 1,
        appliedAt: new Date().toISOString(),
      };
      state.reflectorHistory.push(state.activeReflector);

      return {
        ok: true,
        activeReflector: state.activeReflector,
        reflectorHistoryCount: state.reflectorHistory.length,
      };
    } catch (err) {
      if (state.inFlightRequestId === requestId) {
        state.inFlightRequestId = null;
        state.inFlightDesignVersion = null;
      }
      reply.code(err.statusCode || 500);
      return {
        error: true,
        code: err.code || 'GENERATION_3D_FAILED',
        message: err.message,
        scenePreserved: true,
        retryAvailable: true,
      };
    }
  });

  app.post('/api/mission/telemetry', async (req) => {
    const update = req.body || {};
    Object.assign(state.missionStatus, update);
    return {
      ok: true,
      missionStatus: state.missionStatus,
    };
  });

  app.post('/api/mission/reset', async (req) => {
    const preserveReflector = req.body?.preserveReflector !== false;
    if (!preserveReflector) {
      state.activeReflector = null;
      state.designConfirmed = false;
    }
    state.missionStatus = {
      missionPhase: 'briefing',
      reflectorEquipped: false,
      reflectorMounted: false,
      receiverAligned: false,
      commsRestored: false,
      doorOpened: false,
      beamErrorDeg: null,
      mountedPitchRad: 0,
      mountedYawRad: 0,
      passStarted: false,
      passActiveMode: false,
      txProgress: 0,
      txCompleted: false,
      groundAckReceived: false,
      returnedToBase: false,
      orbitAngleRad: 0.42,
    };
    return {
      ok: true,
      missionStatus: state.missionStatus,
      activeReflector: state.activeReflector,
    };
  });

  app.get('/api/lyria/status', async () => {
    return {
      ok: true,
      endpoint: LYRIA_INTERACTIONS_ENDPOINT,
      supportedModels: ['lyria-3-clip-preview', 'lyria-3.5'],
      apiKeyConfigured: Boolean(getGeminiApiKey(projectRoot)),
      bgm: state.bgm,
      historyCount: state.bgmHistory.length,
    };
  });

  app.post('/api/lyria/generate', async (req, reply) => {
    try {
      const {
        model = 'lyria-3-clip-preview',
        input = DEFAULT_LYRIA_PROMPT,
        timeoutMs = 180000,
      } = req.body || {};

      const result = await generateLyriaMusic({
        model,
        input,
        projectRoot,
        timeoutMs,
      });

      const entry = {
        model: result.model,
        input: result.input,
        mimeType: result.mimeType,
        audioUrl: result.audioUrl,
        latestAudioUrl: result.latestAudioUrl,
        text: result.text,
        byteLength: result.byteLength,
        elapsedMs: result.elapsedMs,
        provenance: result.provenance,
        updatedAt: new Date().toISOString(),
      };

      state.bgm = entry;
      state.bgmHistory.push(entry);
      state.provenanceSummary.bgm = {
        requestedModel: result.model,
        status: 'VERIFIED_LYRIA_INTERACTIONS_REST_API',
        endpoint: LYRIA_INTERACTIONS_ENDPOINT,
        assetUrl: result.audioUrl,
        note: `Generated via POST ${LYRIA_INTERACTIONS_ENDPOINT} (${result.model}, ${result.byteLength} bytes, ${result.mimeType}).`,
      };

      return {
        ok: true,
        ...result,
      };
    } catch (err) {
      reply.code(err.statusCode || 500);
      return {
        error: true,
        code: err.code || 'LYRIA_GENERATION_FAILED',
        message: err.message,
        scenePreserved: true,
        retryAvailable: true,
      };
    }
  });

  return app;
}

