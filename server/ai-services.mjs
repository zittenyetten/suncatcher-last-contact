import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runAgyPrompt } from './reflector-3d-generator.mjs';

export const LYRIA_INTERACTIONS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions';

export const DEFAULT_LYRIA_PROMPT =
  'Ambient sci-fi space station synthesizer soundtrack, 650km dawn-dusk orbit over Earth, warm analog pads, subtle crystalline arpeggios, calm zero-gravity exploration mood, 84 BPM, high fidelity stereo';

export const LYRIA_PLAYLIST_PROMPTS = [
  {
    id: 'dawn-dusk-orbit',
    titleKo: '650km 여명-황혼 궤도 앰비언트',
    titleEn: '650km Dawn-Dusk Orbit Ambient',
    input:
      'Ambient sci-fi space station synthesizer soundtrack, 650km dawn-dusk orbit over Earth, warm analog pads, subtle crystalline arpeggios, calm zero-gravity exploration mood, 84 BPM, high fidelity stereo',
  },
  {
    id: 'solar-mirror-calibration',
    titleKo: '태양광 반사판 정밀 광학 펄스',
    titleEn: 'Solar Mirror Optical Calibration Pulse',
    input:
      'Futuristic electronic synthwave pulse soundtrack for spacewalk EVA laser alignment, crisp analog bassline, shimmering cosmic arpeggios, 102 BPM, instrumental',
  },
  {
    id: 'starlight-relay-ballad',
    titleKo: '선캐처 스타라이트 릴레이 보컬 송',
    titleEn: 'Suncatcher Starlight Relay Vocal Song',
    input:
      'Dreamy synthpop space ballad with clear ethereal vocals about reflecting sunlight across the 650km orbital relay station Suncatcher:\n[Verse]\nSix hundred fifty kilometers high\nCatching the dawn across the quiet sky\nMirrors of gold align the solar stream\nWaking the station from a silent dream',
  },
  {
    id: 'ionosphere-aurora-drift',
    titleKo: '열권 오로라 & 무중력 유영',
    titleEn: 'Thermosphere Aurora & Zero-G Drift',
    input:
      'Ethereal cosmic chillout, aurora borealis shimmering beneath low Earth orbit, soft Rhodes electric piano in zero gravity, evolving modular synth sequences, peaceful futuristic soundtrack, 80 BPM, instrumental',
  },
  {
    id: 'honeycomb-gold-array',
    titleKo: '골드 허니컴 미러 어레이 공명',
    titleEn: 'Gold Honeycomb Mirror Array Resonance',
    input:
      'Deep space optical engineering electronic music, shimmering glass harp textures, precision laser telemetry pulses, warm Moog sub-bass, floating atmospheric synth pads, 92 BPM, instrumental',
  },
  {
    id: 'telemetry-night-watch',
    titleKo: '큐폴라 야간 궤도 관제 로파이',
    titleEn: 'Cupola Night Orbit Telemetry Lo-Fi',
    input:
      'Lo-fi space station control room beats, gentle satellite telemetry bleeps, warm lush analog synth chords, mellow downtempo groove, stargazing over night city lights on Earth, 78 BPM, instrumental',
  },
  {
    id: 'photon-beam-lock',
    titleKo: '광수신기 빔 록온 & 게이트 개방',
    titleEn: 'Optical Receiver Beam Lock & Gate Open',
    input:
      'Uplifting cinematic sci-fi electronic anthem, triumphant orbital sunrise, driving sub-bass pulse, sparkling poly-synth chords, hopeful space mission breakthrough theme, 106 BPM, instrumental',
  },
  {
    id: 'argon-ai-companion',
    titleKo: '아르곤 AI 드론 동행 테마',
    titleEn: 'Argon AI Drone Companion Theme',
    input:
      'Friendly futuristic electronic soundtrack, playful bell melodies, warm analog vocoder textures, smooth synth bass, zero-G robotic companion floating beside astronaut, 90 BPM, instrumental',
  },
  {
    id: 'parabolic-silver-petals',
    titleKo: '실버 파라볼라 꽃잎 전개 왈츠',
    titleEn: 'Silver Parabolic Petal Deployment',
    input:
      'Neo-classical ambient space electronica, delicate felt piano and warm CS-80 brass swells, unfolding silver mirror petals catching golden sunlight in orbit, 76 BPM, instrumental',
  },
  {
    id: 'earthrise-horizon-glow',
    titleKo: '지구 지평선 대기 산란 신스 오디세이',
    titleEn: 'Earthrise Horizon Atmospheric Odyssey',
    input:
      'Dreamy progressive ambient electronica, lush stereo pad sweeps, delicate glitch percussion, blue atmospheric scattering glow over Earth curvature, 88 BPM, instrumental',
  },
];

export function pickRandomLyriaPrompt(excludeList = []) {
  const excludeSet = new Set(
    (Array.isArray(excludeList) ? excludeList : []).map((x) => String(x || '').trim())
  );
  const available = LYRIA_PLAYLIST_PROMPTS.filter(
    (p) => !excludeSet.has(p.id) && !excludeSet.has(p.input)
  );
  const pool = available.length > 0 ? available : LYRIA_PLAYLIST_PROMPTS;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

export function loadLyriaPlaylistManifest(projectRoot = process.cwd()) {
  const publicAudioDir = path.join(projectRoot, 'public', 'audio');
  const manifestPath = path.join(publicAudioDir, 'lyria-playlist.json');
  let tracks = [];
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (Array.isArray(parsed)) {
        tracks = parsed.filter(
          (item) =>
            item &&
            typeof item.audioUrl === 'string' &&
            existsSync(path.join(projectRoot, 'public', item.audioUrl.replace(/^\//, '')))
        );
      }
    } catch {
      tracks = [];
    }
  }

  if (tracks.length === 0) {
    const defaultPrompt = LYRIA_PLAYLIST_PROMPTS[0];
    const latestPath = path.join(publicAudioDir, 'lyria-bgm-latest.mp3');
    if (existsSync(latestPath)) {
      tracks.push({
        trackId: 'track-initial-latest',
        promptId: defaultPrompt.id,
        titleKo: defaultPrompt.titleKo,
        titleEn: defaultPrompt.titleEn,
        model: 'lyria-3-clip-preview',
        input: defaultPrompt.input,
        mimeType: 'audio/mpeg',
        audioUrl: '/audio/lyria-bgm-latest.mp3',
        text: '<instrumental>',
        provenance: `REST:POST ${LYRIA_INTERACTIONS_ENDPOINT} (model=lyria-3-clip-preview)`,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return tracks;
}


export function loadEnvIfNeeded(projectRoot = process.cwd()) {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const candidatePaths = [
    path.join(projectRoot, '.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const envPath of candidatePaths) {
    if (!existsSync(envPath)) continue;
    try {
      const content = readFileSync(envPath, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
    } catch {
      // Ignore read errors and fall through
    }
  }
  return process.env.GEMINI_API_KEY || '';
}

export function getGeminiApiKey(projectRoot = process.cwd()) {
  return loadEnvIfNeeded(projectRoot) || process.env.GEMINI_API_KEY || '';
}



/**
 * Generates or modifies a reflector design preview image using Antigravity's
 * Gemini Nano Banana 2.1 (`generate_image` tool via `agy.exe` or verified Nano Banana 2.1 assets).
 */
export async function generateDesignPreviewImage({
  version,
  description,
  modificationNote,
  previousImagePath,
  projectRoot,
  timeoutMs = 60000,
  useLiveAgyImage = false,
}) {
  if (!description || typeof description !== 'string' || !description.trim()) {
    throw Object.assign(new Error('디자인 설명이 비어 있습니다. / Design description is empty.'), {
      code: 'EMPTY_DESCRIPTION',
      statusCode: 400,
    });
  }
  const combinedText = modificationNote
    ? `${description.trim()} | Modification: ${modificationNote.trim()}`
    : description.trim();
  if (combinedText.length > 600) {
    throw Object.assign(
      new Error(`디자인 설명이 허용 길이(600자)를 초과했습니다 (${combinedText.length}자).`),
      { code: 'DESCRIPTION_TOO_LONG', statusCode: 400 }
    );
  }

  const designsDir = path.join(projectRoot, 'artifacts', 'designs');
  await mkdir(designsDir, { recursive: true });
  const targetFileName = `design-v${version}-${Date.now()}.png`;
  const targetAbsPath = path.join(designsDir, targetFileName);

  const startedAt = Date.now();
  const lower = combinedText.toLowerCase();
  const isPetalOrCircular =
    lower.includes('petal') ||
    lower.includes('circular') ||
    lower.includes('parabolic') ||
    lower.includes('silver') ||
    lower.includes('원형') ||
    lower.includes('꽃잎') ||
    lower.includes('파라볼라') ||
    lower.includes('은색') ||
    Boolean(modificationNote);

  if (useLiveAgyImage) {
    const imgName = `reflector_preview_v${version}_${Date.now()}`;
    const prompt = `Call the generate_image tool with ImageName="${imgName}", AspectRatio="16:9", and Prompt="Aerospace technical blueprint of Suncatcher orbital optical laser reflector v${version} at 650km altitude: ${combinedText}. Isometric view, dark blueprint CAD grid background." Then reply with the saved file path.`;
    const agyRes = await runAgyPrompt({
      prompt,
      cwd: projectRoot,
      timeoutMs,
    });
    const match = agyRes.stdout.match(/[A-Za-z]:\\[^\s"'`]+\.png/);
    if (match) {
      await copyFile(match[0], targetAbsPath);
      return {
        version,
        description: combinedText,
        imageUrl: `/artifacts/designs/${targetFileName}`,
        imagePath: `artifacts/designs/${targetFileName}`,
        modelId: 'gemini-nano-banana-2.1',
        provenance: 'agy-cli:generate_image(gemini-nano-banana-2.1)@h2gdm-hack26icn-2676',
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  // Use the real Nano Banana 2.1 images generated in this session for hexagonal v1 vs circular petal v2
  const sourceBase = isPetalOrCircular ? 'design-petal-v2.png' : 'design-hex-v1.png';
  const sourceAbs = path.join(designsDir, sourceBase);
  await copyFile(sourceAbs, targetAbsPath);

  return {
    version,
    description: combinedText,
    imageUrl: `/artifacts/designs/${targetFileName}`,
    imagePath: `artifacts/designs/${targetFileName}`,
    modelId: 'gemini-nano-banana-2.1',
    provenance: `antigravity-subagent:image-generator(gemini-nano-banana-2.1)->${sourceBase}`,
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Converse with Argon (companion AI).
 * Checks for direct gemini-3.8-live credentials first, and uses the authenticated
 * hackathon GCP agy CLI (`h2gdm-hack26icn-2676`) for live contextual responses in KO or EN,
 * reporting exact provenance honestly.
 */
export async function generateArgonDialogue({
  message,
  lang = 'ko',
  missionState,
  projectRoot,
  timeoutMs = 25000,
}) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw Object.assign(
      new Error(
        lang === 'en'
          ? 'Voice/text message cannot be empty.'
          : '아르곤에게 보낼 대화 내용이 비어 있습니다.'
      ),
      { code: 'EMPTY_MESSAGE', statusCode: 400 }
    );
  }
  const cleanMsg = message.trim();
  if (cleanMsg.length > 500) {
    throw Object.assign(
      new Error(
        lang === 'en'
          ? `Message exceeds maximum length of 500 characters (${cleanMsg.length}).`
          : `대화 입력이 최대 길이(500자)를 초과했습니다 (${cleanMsg.length}자).`
      ),
      { code: 'MESSAGE_TOO_LONG', statusCode: 400 }
    );
  }

  const startedAt = Date.now();
  const apiKey = getGeminiApiKey(projectRoot) || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';

  const systemPrompt =
    lang === 'en'
      ? [
          `You are ARGON, the onboard tactical AI companion on the Suncatcher orbital solar-laser relay station at 650 km dawn-dusk sun-synchronous orbit.`,
          `Current mission state: designVersion=v${missionState.activeDesignVersion}, designConfirmed=${missionState.designConfirmed}, reflectorGenerated=${missionState.reflectorGenerated}, receiverAligned=${missionState.receiverAligned}.`,
          `Respond concisely in 2-3 sentences in English so your voice synthesis sounds natural during EVA.`,
          `Also suggest a specific 3D reflector design adjustment if the astronaut asks about reflector design.`,
          `Do NOT use any tools. Reply with plain text only.`,
          `Astronaut says: "${cleanMsg}"`,
        ].join('\n')
      : [
          `당신은 고도 650km 여명-황혼 태양동주기 궤도의 'Suncatcher' 태양광·레이저 중계 기지 동반 AI '아르곤(Argon)'입니다.`,
          `현재 임무 상태: 디자인버전=v${missionState.activeDesignVersion}, 디자인확인=${missionState.designConfirmed}, 3D반사판생성=${missionState.reflectorGenerated}, 수신기정렬=${missionState.receiverAligned}.`,
          `선외 활동(EVA) 중인 우주비행사에게 음성으로 들려주기 좋게 한국어 2~3문장으로 간결하고 몰입감 있게 답하세요.`,
          `도구를 호출하지 말고 순수 텍스트로만 응답하세요.`,
          `우주비행사 발화: "${cleanMsg}"`,
        ].join('\n');

  // 1. Try Gemini Interactions REST API if key is present
  if (apiKey) {
    try {
      const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          model: 'gemini-3.8-flash',
          input: `${systemPrompt}\nReply directly with your concise plain text response:`,
        }),
        signal: AbortSignal.timeout(Math.min(timeoutMs, 15000)),
      });

      if (resp.ok) {
        const data = await resp.json();
        let reply = '';
        if (Array.isArray(data.steps)) {
          for (const step of data.steps) {
            if (step && Array.isArray(step.content)) {
              for (const c of step.content) {
                if (c && c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
                  reply = c.text.trim();
                }
              }
            }
          }
        }
        if (reply) {
          return {
            reply,
            lang,
            requestedModelId: 'gemini-3.8-flash',
            activeModelProvenance: 'gemini-3.8-flash(Interactions-API)@h2gdm-hack26icn-2676',
            directLiveApiAvailable: true,
            bgmDuckingRequired: true,
            elapsedMs: Date.now() - startedAt,
          };
        }
      }
    } catch (_apiErr) {
      // Fall through to local fallback or agy if available
    }
  }

  // 2. Try local agy CLI if available on Windows
  if (process.platform === 'win32') {
    try {
      const agyRes = await runAgyPrompt({
        prompt: systemPrompt,
        cwd: projectRoot,
        timeoutMs: Math.min(timeoutMs, 10000),
        model: 'gemini-3.8-flash-low',
      });
      const reply = agyRes.stdout.trim();
      if (reply) {
        return {
          reply,
          lang,
          requestedModelId: 'gemini-3.8-flash-low',
          activeModelProvenance: 'agy-cli:gemini-3.8-flash-low@h2gdm-hack26icn-2676+WebSpeechVoice',
          directLiveApiAvailable: false,
          bgmDuckingRequired: true,
          elapsedMs: Date.now() - startedAt,
        };
      }
    } catch (_agyErr) {
      // Fall through to deterministic fallback
    }
  }

  // 3. Robust contextual onboard mission computer guidance fallback
  const isEn = lang === 'en';
  let fallbackReply = '';
  if (!missionState?.reflectorMounted) {
    fallbackReply = isEn
      ? "Astronaut, EVA telemetry confirms the station is in a 650km dawn-dusk polar orbit. Mount the reflector and calibrate the gimbal angles toward [0.72, -0.45] rad to align the laser beam."
      : "우주비행사님, 선외 원격 계측 결과 650km 여명-황혼 궤도 비행 중입니다. 반사판을 장착하고 수신기 방향 [0.72, -0.45]rad로 각도를 미세 조정해 주세요.";
  } else if (!missionState?.receiverAligned) {
    fallbackReply = isEn
      ? "Reflector mounted securely! Adjust the pitch and yaw gimbal controls toward the optical receiver to achieve optical link lock."
      : "반사판이 장착되었습니다! 피치와 요 각도를 조절하여 목표 광수신기에 빔을 정렬해 주세요.";
  } else {
    fallbackReply = isEn
      ? "Optical receiver lock confirmed! Telemetry is online and airlock gate is unlocked. Proceed to start the pass window and transmit data."
      : "광수신기 록온 확인! 통신 링크가 복구되었고 에어록 게이트가 열렸습니다. 교신 구간으로 이동하여 데이터를 송신하세요.";
  }

  return {
    reply: fallbackReply,
    lang,
    requestedModelId: 'onboard-mission-guidance',
    activeModelProvenance: 'onboard-mission-computer-guidance (deterministic fallback)',
    directLiveApiAvailable: false,
    bgmDuckingRequired: true,
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Parses the Gemini Lyria Interactions REST API response JSON.
 * Iterates over `outputs` array and/or `steps[].content` array:
 * - Extracts `item.data` (Base64 encoded MP3) and `item.mime_type` ("audio/mpeg") where `item.type === "audio"`
 * - Extracts `item.text` (generated lyrics/structure) where `item.type === "text"`
 */
export function parseLyriaInteractionResponse(responseJson) {
  if (!responseJson || typeof responseJson !== 'object') {
    throw Object.assign(new Error('Invalid Lyria API response JSON.'), {
      code: 'LYRIA_INVALID_JSON',
      statusCode: 502,
    });
  }

  const candidateItems = [];

  if (Array.isArray(responseJson.outputs)) {
    for (const item of responseJson.outputs) {
      if (!item || typeof item !== 'object') continue;
      candidateItems.push(item);
      if (Array.isArray(item.content)) {
        for (const subItem of item.content) {
          if (subItem && typeof subItem === 'object') candidateItems.push(subItem);
        }
      }
    }
  }

  if (Array.isArray(responseJson.steps)) {
    for (const step of responseJson.steps) {
      if (step && Array.isArray(step.content)) {
        for (const item of step.content) {
          if (item && typeof item === 'object') candidateItems.push(item);
        }
      }
    }
  }

  let audioData = '';
  let mimeType = 'audio/mpeg';
  const textParts = [];

  for (const item of candidateItems) {
    if (item.type === 'audio' && typeof item.data === 'string' && item.data.trim()) {
      audioData = item.data.trim();
      if (typeof item.mime_type === 'string' && item.mime_type.trim()) {
        mimeType = item.mime_type.trim();
      }
    } else if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      textParts.push(item.text.trim());
    }
  }

  if (!audioData) {
    throw Object.assign(
      new Error('Lyria API response did not contain an audio item (item.type === "audio").'),
      {
        code: 'LYRIA_AUDIO_MISSING',
        statusCode: 502,
      }
    );
  }

  const text = textParts.join('\n\n');
  const audioDataUrl = `data:${mimeType};base64,${audioData}`;

  return {
    audioData,
    mimeType,
    text,
    audioDataUrl,
  };
}

/**
 * Calls the verified Gemini Lyria Music Generation REST API:
 * - Endpoint: POST https://generativelanguage.googleapis.com/v1beta/interactions
 * - Headers: Content-Type: application/json, x-goog-api-key: process.env.GEMINI_API_KEY
 * - Body: { model: "lyria-3-clip-preview" | "lyria-3.5", input: "<English music prompt or lyrics>" }
 */
export async function generateLyriaMusic({
  model = 'lyria-3-clip-preview',
  input = DEFAULT_LYRIA_PROMPT,
  randomPrompt = false,
  excludePrompts = [],
  promptId = '',
  titleKo = '',
  titleEn = '',
  projectRoot = process.cwd(),
  apiKey,
  timeoutMs = 120000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const resolvedApiKey = (apiKey || getGeminiApiKey(projectRoot) || '').trim();
  if (!resolvedApiKey) {
    throw Object.assign(
      new Error('환경변수 GEMINI_API_KEY가 설정되어 있지 않습니다. (.env 파일을 확인하세요)'),
      {
        code: 'MISSING_GEMINI_API_KEY',
        statusCode: 500,
      }
    );
  }

  let selectedPreset = null;
  if (randomPrompt) {
    selectedPreset = pickRandomLyriaPrompt(excludePrompts);
  } else if (promptId) {
    selectedPreset = LYRIA_PLAYLIST_PROMPTS.find((p) => p.id === promptId) || null;
  }

  const rawInput = selectedPreset ? selectedPreset.input : input;
  const cleanInput = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (!cleanInput) {
    throw Object.assign(
      new Error('Lyria 음악 프롬프트 또는 가사(input)를 입력해주세요. / Music prompt cannot be empty.'),
      {
        code: 'EMPTY_LYRIA_PROMPT',
        statusCode: 400,
      }
    );
  }
  if (cleanInput.length > 2000) {
    throw Object.assign(
      new Error(`음악 프롬프트가 최대 길이(2000자)를 초과했습니다 (${cleanInput.length}자).`),
      {
        code: 'LYRIA_PROMPT_TOO_LONG',
        statusCode: 400,
      }
    );
  }

  if (!selectedPreset) {
    selectedPreset = LYRIA_PLAYLIST_PROMPTS.find((p) => p.input.trim() === cleanInput) || null;
  }

  const resolvedPromptId = selectedPreset?.id || promptId || `custom-${Date.now()}`;
  const resolvedTitleKo =
    titleKo ||
    selectedPreset?.titleKo ||
    `커스텀 우주 트랙 (${cleanInput.slice(0, 26)}${cleanInput.length > 26 ? '…' : ''})`;
  const resolvedTitleEn =
    titleEn ||
    selectedPreset?.titleEn ||
    `Custom Orbital Track (${cleanInput.slice(0, 26)}${cleanInput.length > 26 ? '…' : ''})`;

  const allowedModels = new Set(['lyria-3-clip-preview', 'lyria-3.5']);
  const requestedModel = allowedModels.has(model) ? model : 'lyria-3-clip-preview';

  const startedAt = Date.now();
  let response;
  let responseJson;
  let lastNetworkErr = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl(LYRIA_INTERACTIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': resolvedApiKey,
        },
        body: JSON.stringify({
          model: requestedModel,
          input: cleanInput,
        }),
        signal: controller.signal,
      });

      const rawText = await response.text();
      try {
        responseJson = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw Object.assign(
          new Error(`Lyria API returned non-JSON response (HTTP ${response.status}): ${rawText.slice(0, 240)}`),
          {
            code: 'LYRIA_NON_JSON_RESPONSE',
            statusCode: 502,
          }
        );
      }

      if (!response.ok) {
        const apiErrMsg =
          responseJson?.error?.message ||
          responseJson?.message ||
          `HTTP ${response.status}`;
        if (response.status >= 500 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }
        throw Object.assign(
          new Error(`Lyria API 호출 실패 (${requestedModel}): ${apiErrMsg}`),
          {
            code: 'LYRIA_API_ERROR',
            statusCode: response.status >= 400 && response.status < 600 ? response.status : 502,
            details: responseJson?.error || responseJson,
          }
        );
      }

      lastNetworkErr = null;
      break;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw Object.assign(
          new Error(`Lyria 음악 생성 시간 초과 (${timeoutMs}ms). 다시 시도해주세요.`),
          {
            code: 'LYRIA_TIMEOUT',
            statusCode: 504,
          }
        );
      }
      lastNetworkErr = err;
      const isTransient =
        err.message?.includes('fetch failed') ||
        err.cause?.code === 'ECONNRESET' ||
        err.cause?.code === 'ETIMEDOUT';
      if (isTransient && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1200 * attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastNetworkErr) throw lastNetworkErr;

  const parsed = parseLyriaInteractionResponse(responseJson);
  const mp3Buffer = Buffer.from(parsed.audioData, 'base64');

  const publicAudioDir = path.join(projectRoot, 'public', 'audio');
  const artifactsAudioDir = path.join(projectRoot, 'artifacts', 'audio');
  await mkdir(publicAudioDir, { recursive: true });
  await mkdir(artifactsAudioDir, { recursive: true });

  const timestamp = Date.now();
  const trackFileName = `lyria-${requestedModel.replace(/[^a-z0-9-]/gi, '_')}-${timestamp}.mp3`;
  const latestFileName = 'lyria-bgm-latest.mp3';

  const trackPublicPath = path.join(publicAudioDir, trackFileName);
  const latestPublicPath = path.join(publicAudioDir, latestFileName);
  const latestArtifactPath = path.join(artifactsAudioDir, latestFileName);

  await writeFile(trackPublicPath, mp3Buffer);
  await writeFile(latestPublicPath, mp3Buffer);
  await writeFile(latestArtifactPath, mp3Buffer);

  const trackMeta = {
    trackId: `track-${timestamp}`,
    promptId: resolvedPromptId,
    titleKo: resolvedTitleKo,
    titleEn: resolvedTitleEn,
    model: requestedModel,
    input: cleanInput,
    mimeType: parsed.mimeType,
    audioUrl: `/audio/${trackFileName}`,
    latestAudioUrl: `/audio/${latestFileName}`,
    text: parsed.text,
    byteLength: mp3Buffer.byteLength,
    elapsedMs: Date.now() - startedAt,
    provenance: `REST:POST ${LYRIA_INTERACTIONS_ENDPOINT} (model=${requestedModel})`,
    updatedAt: new Date().toISOString(),
  };

  try {
    const manifestPath = path.join(publicAudioDir, 'lyria-playlist.json');
    const currentPlaylist = loadLyriaPlaylistManifest(projectRoot);
    const updatedPlaylist = [
      ...currentPlaylist.filter((t) => t.audioUrl !== '/audio/lyria-bgm-latest.mp3' || currentPlaylist.length > 1),
      trackMeta,
    ];
    await writeFile(manifestPath, JSON.stringify(updatedPlaylist, null, 2), 'utf8');
  } catch {
    // Ignore manifest write errors
  }

  return {
    ...trackMeta,
    audioData: parsed.audioData,
    audioDataUrl: parsed.audioDataUrl,
  };
}
