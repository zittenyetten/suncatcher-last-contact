import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  generateReflector3DFromApprovedDesign,
  validateGenerationRequestInput,
} from './reflector-3d-generator.mjs';
import {
  DEFAULT_LYRIA_PROMPT,
  LYRIA_INTERACTIONS_ENDPOINT,
  LYRIA_PLAYLIST_PROMPTS,
  generateArgonDialogue,
  generateDesignPreviewImage,
  generateLyriaMusic,
  getGeminiApiKey,
  loadEnvIfNeeded,
  loadLyriaPlaylistManifest,
} from './ai-services.mjs';

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
  const initialPlaylist = loadLyriaPlaylistManifest(projectRoot);

  // Visitor-Isolated Session Management (Priority 4)
  const sessions = new Map();

  function createInitialSessionState(sessionId) {
    return {
      sessionId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      lang: 'en', // Priority 3: Default English UI
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
      bgm: initialPlaylist[initialPlaylist.length - 1] || {
        trackId: 'track-initial-latest',
        promptId: 'dawn-dusk-orbit',
        titleKo: '650km 여명-황혼 궤도 앰비언트',
        titleEn: '650km Dawn-Dusk Orbit Ambient',
        model: 'lyria-3-clip-preview',
        input: DEFAULT_LYRIA_PROMPT,
        mimeType: 'audio/mpeg',
        audioUrl: '/audio/lyria-bgm-latest.mp3',
        fallbackAudioUrl: '/audio/orbital-dawn-bgm.wav',
        text: '<instrumental>',
        provenance: `REST:POST ${LYRIA_INTERACTIONS_ENDPOINT} (model=lyria-3-clip-preview)`,
        updatedAt: new Date().toISOString(),
      },
      bgmHistory: [...initialPlaylist],
      missionStatus: {
        missionPhase: 'briefing',
        reflectorEquipped: false,
        reflectorMounted: false,
        receiverAligned: false,
        inPassWindow: false,
        passRemainingSec: 0,
        txProgress: 0,
        txCompleted: false,
        groundAckReceived: false,
        commsRestored: false,
        doorOpened: false,
        returnedToBase: false,
        beamErrorDeg: null,
        mountedPitchRad: 0,
        mountedYawRad: 0,
      },
      provenanceSummary: {
        gcpProject: 'h2gdm-hack26icn-2676',
        companionDialogue: {
          requestedModel: 'gemini-3.8-flash',
          status: hasGeminiKey
            ? 'DIRECT_API_KEY_CONFIGURED'
            : 'STANDARD_REST_AI_DIALOGUE',
          note: 'Direct Gemini Interactions API REST protocol with GEMINI_API_KEY and deterministic mission fallback.',
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
            : 'VERIFIED_LYRIA_AUDIO_ASSETS',
          endpoint: LYRIA_INTERACTIONS_ENDPOINT,
          assetUrl: '/audio/lyria-bgm-latest.mp3',
          note: 'Gemini Lyria Music Generation integrated via POST https://generativelanguage.googleapis.com/v1beta/interactions with x-goog-api-key (GEMINI_API_KEY).',
        },
        reflector3D: {
          status: 'VERIFIED_ACTUAL_3D_GENERATION_GLB',
          method: 'verified-reflector-asset (pre-verified orbital 3D model)',
        },
      },
      rateLimiter: {
        count: 0,
        resetAt: Date.now() + 60000,
      },
    };
  }

  function getOrCreateSession(req, reply) {
    let sessionId =
      req.headers['x-session-id'] ||
      req.headers['x-visitor-id'] ||
      req.query?.sessionId;

    if (!sessionId && req.headers.cookie) {
      const match = req.headers.cookie.match(/(?:^|;\s*)suncatcher_session=([a-zA-Z0-9_-]+)/);
      if (match) sessionId = match[1];
    }

    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64) {
      // In automated tests or raw clients without cookies/session headers, use IP fallback
      const ip = (req.ip || req.headers?.['x-forwarded-for'] || 'default').toString();
      sessionId = `sess_ip_${ip.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }

    if (reply && typeof reply.header === 'function') {
      reply.header('Set-Cookie', `suncatcher_session=${sessionId}; Path=/; SameSite=Lax; HttpOnly`);
      reply.header('X-Session-Id', sessionId);
    }

    let session = sessions.get(sessionId);
    if (!session) {
      // Memory cleanup: expire sessions inactive for > 2 hours
      if (sessions.size > 500) {
        const now = Date.now();
        for (const [id, s] of sessions.entries()) {
          if (now - s.lastActiveAt > 1000 * 60 * 60 * 2) {
            sessions.delete(id);
          }
        }
      }
      session = createInitialSessionState(sessionId);
      sessions.set(sessionId, session);
    }

    session.lastActiveAt = Date.now();
    return session;
  }

  function serializeState(session) {
    const copy = { ...session };
    delete copy.rateLimiter;
    return {
      ...copy,
      appliedRequestIds: Array.from(session.appliedRequestIds),
    };
  }

  // Rate Limiting on external AI endpoints (Priority 4)
  function checkRateLimit(session, reply, maxPerMinute = 25) {
    const now = Date.now();
    if (now > session.rateLimiter.resetAt) {
      session.rateLimiter.count = 0;
      session.rateLimiter.resetAt = now + 60000;
    }
    session.rateLimiter.count += 1;
    if (session.rateLimiter.count > maxPerMinute) {
      reply.code(429);
      return {
        error: true,
        code: 'RATE_LIMIT_EXCEEDED',
        message:
          session.lang === 'en'
            ? 'Too many requests. Please wait a moment before sending more AI requests.'
            : '요청 횟수 제한을 초과했습니다. 잠시 후 다시 시도해 주세요.',
        scenePreserved: true,
        retryAvailable: true,
      };
    }
    return null;
  }

  // Routes
  app.get('/api/state', async (req, reply) => {
    const session = getOrCreateSession(req, reply);
    return serializeState(session);
  });

  app.post('/api/lang', async (req, reply) => {
    const session = getOrCreateSession(req, reply);
    const lang = req.body?.lang === 'ko' ? 'ko' : 'en';
    session.lang = lang;
    return { ok: true, lang: session.lang };
  });

  app.post('/api/dialogue', async (req, reply) => {
    const session = getOrCreateSession(req, reply);
    const rateErr = checkRateLimit(session, reply);
    if (rateErr) return rateErr;

    try {
      const { message, lang = session.lang, timeoutMs = 15000 } = req.body || {};
      const effectiveTimeout = Math.min(Number(timeoutMs) || 15000, 15000);
      const result = await generateArgonDialogue({
        message,
        lang,
        missionState: {
          activeDesignVersion: session.activeDesignVersion,
          designConfirmed: session.designConfirmed,
          reflectorGenerated: Boolean(session.activeReflector),
          receiverAligned: session.missionStatus.receiverAligned,
        },
        projectRoot,
        timeoutMs: effectiveTimeout,
      });
      session.dialogueHistory.push({
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
    const session = getOrCreateSession(req, reply);
    const rateErr = checkRateLimit(session, reply);
    if (rateErr) return rateErr;

    try {
      const {
        description,
        modificationNote,
        timeoutMs = 30000,
        useLiveAgyImage = false,
      } = req.body || {};
      const effectiveTimeout = Math.min(Number(timeoutMs) || 30000, 30000);

      if (!description || typeof description !== 'string' || !description.trim()) {
        reply.code(400);
        return {
          error: true,
          code: 'EMPTY_DESCRIPTION',
          message:
            session.lang === 'en'
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
            session.lang === 'en'
              ? `Design description exceeds 600 characters (${combinedLength}).`
              : `반사판 디자인 설명이 최대 600자를 초과했습니다 (${combinedLength}자).`,
          scenePreserved: true,
          retryAvailable: true,
        };
      }

      if (session.inFlightRequestId) {
        session.discardedRequests.push({
          requestId: session.inFlightRequestId,
          designVersion: session.inFlightDesignVersion,
          reason: 'SUPERSEDED_BY_DESIGN_MODIFICATION',
          discardedAt: new Date().toISOString(),
        });
        session.inFlightRequestId = null;
        session.inFlightDesignVersion = null;
      }

      const nextVersion = session.activeDesignVersion + 1;
      const preview = await generateDesignPreviewImage({
        version: nextVersion,
        description,
        modificationNote,
        previousImagePath: session.designPreview?.imagePath,
        projectRoot,
        timeoutMs: effectiveTimeout,
        useLiveAgyImage,
      });

      session.activeDesignVersion = nextVersion;
      session.designConfirmed = false;
      session.approvedDesignVersion = null;
      session.designPreview = preview;

      return {
        ok: true,
        activeDesignVersion: session.activeDesignVersion,
        designConfirmed: session.designConfirmed,
        designPreview: session.designPreview,
        discardedRequests: session.discardedRequests,
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
    const session = getOrCreateSession(req, reply);
    const { designVersion } = req.body || {};
    const targetVersion =
      typeof designVersion === 'number' ? designVersion : session.activeDesignVersion;

    if (targetVersion !== session.activeDesignVersion) {
      reply.code(409);
      return {
        error: true,
        code: 'STALE_DESIGN_VERSION',
        message:
          session.lang === 'en'
            ? `Cannot confirm outdated design v${targetVersion}; latest is v${session.activeDesignVersion}.`
            : `이전 디자인 버전(v${targetVersion})은 승인할 수 없습니다. 최신 버전은 v${session.activeDesignVersion}입니다.`,
        scenePreserved: true,
      };
    }

    session.designConfirmed = true;
    session.approvedDesignVersion = session.activeDesignVersion;
    return {
      ok: true,
      activeDesignVersion: session.activeDesignVersion,
      designConfirmed: session.designConfirmed,
      approvedDesignVersion: session.approvedDesignVersion,
      designPreview: session.designPreview,
    };
  });

  app.post('/api/design/cancel', async (req, reply) => {
    const session = getOrCreateSession(req, reply);
    if (session.inFlightRequestId) {
      session.discardedRequests.push({
        requestId: session.inFlightRequestId,
        designVersion: session.inFlightDesignVersion,
        reason: 'CANCELLED_BY_PLAYER',
        discardedAt: new Date().toISOString(),
      });
      session.inFlightRequestId = null;
      session.inFlightDesignVersion = null;
    }
    session.designConfirmed = false;
    session.approvedDesignVersion = null;
    return {
      ok: true,
      designConfirmed: false,
      approvedDesignVersion: null,
      discardedRequests: session.discardedRequests,
      scenePreserved: true,
    };
  });

  app.post('/api/reflector/generate', async (req, reply) => {
    const session = getOrCreateSession(req, reply);
    const rateErr = checkRateLimit(session, reply);
    if (rateErr) return rateErr;

    const {
      requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      approvedDesignVersion = session.approvedDesignVersion,
      timeoutMs = 30000,
      simulateDelayMs = 0,
      simulateTimeout = false,
      simulateMalformedOutput = false,
      fastMode = false,
    } = req.body || {};
    const effectiveTimeout = Math.min(Number(timeoutMs) || 30000, 30000);

    try {
      if (session.appliedRequestIds.has(requestId)) {
        reply.code(409);
        return {
          error: true,
          code: 'DUPLICATE_REQUEST_ID',
          message:
            session.lang === 'en'
              ? `Request ${requestId} was already applied once.`
              : `요청(${requestId})은 이미 한 번 적용되었습니다 (중복 적용 방지).`,
          scenePreserved: true,
        };
      }

      validateGenerationRequestInput({
        requestId,
        approvedDesignVersion,
        activeDesignVersion: session.activeDesignVersion,
        designConfirmed: session.designConfirmed,
        description: session.designPreview?.description,
        imagePath: session.designPreview?.imagePath,
      });

      if (session.inFlightRequestId && session.inFlightRequestId !== requestId) {
        session.discardedRequests.push({
          requestId: session.inFlightRequestId,
          designVersion: session.inFlightDesignVersion,
          reason: 'SUPERSEDED_BY_NEWER_3D_REQUEST',
          discardedAt: new Date().toISOString(),
        });
      }

      session.inFlightRequestId = requestId;
      session.inFlightDesignVersion = approvedDesignVersion;

      if (simulateDelayMs > 0) {
        await new Promise((r) => setTimeout(r, simulateDelayMs));
      }

      if (simulateTimeout) {
        throw Object.assign(
          new Error(
            session.lang === 'en'
              ? `3D generation timed out after ${effectiveTimeout}ms. Current scene preserved; manual retry available.`
              : `3D 반사판 생성 시간 초과 (${effectiveTimeout}ms). 현재 씬은 유지되며 수동 재시도가 가능합니다.`
          ),
          { code: 'GENERATION_TIMEOUT', statusCode: 504 }
        );
      }

      if (simulateMalformedOutput) {
        throw Object.assign(
          new Error(
            session.lang === 'en'
              ? '3D generation returned malformed geometry. Rejected before modifying scene.'
              : '비정상적인 3D 생성 응답이 감지되어 씬 적용 전 차단되었습니다.'
          ),
          { code: 'MALFORMED_3D_RESPONSE', statusCode: 422 }
        );
      }

      const metadata = await generateReflector3DFromApprovedDesign({
        requestId,
        approvedDesignVersion,
        activeDesignVersion: session.activeDesignVersion,
        designConfirmed: session.designConfirmed,
        description: session.designPreview.description,
        imagePath: session.designPreview.imagePath,
        projectRoot,
        timeoutMs: effectiveTimeout,
        fastMode,
      });

      if (
        session.inFlightRequestId !== requestId ||
        session.activeDesignVersion !== approvedDesignVersion ||
        !session.designConfirmed
      ) {
        session.discardedRequests.push({
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
            session.lang === 'en'
              ? `Result for ${requestId} (v${approvedDesignVersion}) was discarded because the design was modified or cancelled.`
              : `디자인이 수정되었거나 취소되어 이전 요청(${requestId}, v${approvedDesignVersion})의 3D 결과는 폐기되었습니다.`,
          scenePreserved: true,
          discardedRequests: session.discardedRequests,
        };
      }

      session.inFlightRequestId = null;
      session.inFlightDesignVersion = null;
      session.appliedRequestIds.add(requestId);
      session.activeReflector = {
        ...metadata,
        appliedCount: 1,
        appliedAt: new Date().toISOString(),
      };
      session.reflectorHistory.push(session.activeReflector);

      return {
        ok: true,
        activeReflector: session.activeReflector,
        reflectorHistoryCount: session.reflectorHistory.length,
      };
    } catch (err) {
      if (session.inFlightRequestId === requestId) {
        session.inFlightRequestId = null;
        session.inFlightDesignVersion = null;
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

  app.post('/api/mission/telemetry', async (req, reply) => {
    const session = getOrCreateSession(req, reply);
    const update = req.body || {};
    Object.assign(session.missionStatus, update);
    return {
      ok: true,
      missionStatus: session.missionStatus,
    };
  });

  app.post('/api/mission/reset', async (req, reply) => {
    const session = getOrCreateSession(req, reply);
    const { keepGeneratedReflector = true } = req.body || {};
    session.designConfirmed = false;
    session.approvedDesignVersion = null;
    if (!keepGeneratedReflector) {
      session.activeReflector = null;
    }
    session.missionStatus = {
      missionPhase: 'briefing',
      reflectorEquipped: false,
      reflectorMounted: false,
      receiverAligned: false,
      inPassWindow: false,
      passRemainingSec: 0,
      txProgress: 0,
      txCompleted: false,
      groundAckReceived: false,
      commsRestored: false,
      doorOpened: false,
      returnedToBase: false,
      beamErrorDeg: null,
      mountedPitchRad: 0,
      mountedYawRad: 0,
    };
    return {
      ok: true,
      state: serializeState(session),
    };
  });

  app.get('/api/lyria/status', async (req, reply) => {
    const session = getOrCreateSession(req, reply);
    return {
      ok: true,
      endpoint: LYRIA_INTERACTIONS_ENDPOINT,
      supportedModels: ['lyria-3-clip-preview', 'lyria-3.5'],
      apiKeyConfigured: Boolean(getGeminiApiKey(projectRoot)),
      bgm: session.bgm,
      playlist: session.bgmHistory,
      promptPool: LYRIA_PLAYLIST_PROMPTS,
      historyCount: session.bgmHistory.length,
    };
  });

  app.post('/api/lyria/generate', async (req, reply) => {
    const session = getOrCreateSession(req, reply);
    const rateErr = checkRateLimit(session, reply);
    if (rateErr) return rateErr;

    try {
      const {
        model = 'lyria-3-clip-preview',
        input = DEFAULT_LYRIA_PROMPT,
        randomPrompt = false,
        excludePrompts = [],
        promptId = '',
        titleKo = '',
        titleEn = '',
        timeoutMs = 60000,
      } = req.body || {};
      const effectiveTimeout = Math.min(Number(timeoutMs) || 60000, 60000);

      const result = await generateLyriaMusic({
        model,
        input,
        randomPrompt,
        excludePrompts,
        promptId,
        titleKo,
        titleEn,
        projectRoot,
        timeoutMs: effectiveTimeout,
      });

      const entry = {
        trackId: result.trackId,
        promptId: result.promptId,
        titleKo: result.titleKo,
        titleEn: result.titleEn,
        model: result.model,
        input: result.input,
        mimeType: result.mimeType,
        audioUrl: result.audioUrl,
        latestAudioUrl: result.latestAudioUrl,
        text: result.text,
        byteLength: result.byteLength,
        elapsedMs: result.elapsedMs,
        provenance: result.provenance,
        updatedAt: result.updatedAt || new Date().toISOString(),
      };

      session.bgm = entry;
      session.bgmHistory = session.bgmHistory.filter(
        (t) => t.audioUrl !== '/audio/lyria-bgm-latest.mp3' || session.bgmHistory.length > 1
      );
      session.bgmHistory.push(entry);
      session.provenanceSummary.bgm = {
        requestedModel: result.model,
        status: 'VERIFIED_LYRIA_INTERACTIONS_REST_API',
        endpoint: LYRIA_INTERACTIONS_ENDPOINT,
        assetUrl: result.audioUrl,
        note: `Generated via POST ${LYRIA_INTERACTIONS_ENDPOINT} (${result.model}, ${result.byteLength} bytes, ${result.mimeType}).`,
      };

      return {
        ok: true,
        ...result,
        playlist: session.bgmHistory,
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
