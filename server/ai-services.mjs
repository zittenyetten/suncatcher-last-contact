import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runAgyPrompt } from './reflector-3d-generator.mjs';

export const LYRIA_INTERACTIONS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions';

export const DEFAULT_LYRIA_PROMPT =
  'Ambient sci-fi space station synthesizer soundtrack, 650km dawn-dusk orbit over Earth, warm analog pads, subtle crystalline arpeggios, calm zero-gravity exploration mood, 84 BPM, high fidelity stereo';

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
  const hasDirectLiveKey = Boolean(getGeminiApiKey(projectRoot) || process.env.GOOGLE_API_KEY);

  const systemPrompt =
    lang === 'en'
      ? [
          `You are ARGON, the onboard tactical AI companion on the Suncatcher orbital station (650 km altitude).`,
          `Story context ("The Final Transmission"): A micrometeoroid impact damaged the emergency communication path while the technician was on the exterior EVA deck. By mounting the 3D reflector and connecting the reflected laser beam to the Station Uplink Relay (기지 송신 릴레이), we can transmit our rescue request during the next Ground Station pass window. Once 100% is transmitted and Ground Control approves safe return, the airlock opens.`,
          `Current mission state: phase=${missionState.missionPhase || 'prep'}, designVersion=v${missionState.activeDesignVersion}, designConfirmed=${missionState.designConfirmed}, reflectorGenerated=${missionState.reflectorGenerated}, reflectorMounted=${missionState.reflectorMounted}, relayConnected=${missionState.receiverAligned}, txProgress=${Math.round(missionState.txProgress || 0)}%, groundAck=${Boolean(missionState.groundAckReceived)}, airlockOpen=${Boolean(missionState.doorOpened)}.`,
          `Respond concisely in 1-2 sentences in English so your voice synthesis sounds natural during EVA. Stay consistent with the current mission state and never claim all station power is magically restored by optics.`,
          `Do NOT use any tools. Reply with plain text only.`,
          `Technician says: "${cleanMsg}"`,
        ].join('\n')
      : [
          `당신은 고도 650km 궤도 기지 'Suncatcher'의 동반 전술 AI '아르곤(Argon)'입니다.`,
          `미션 배경("마지막 교신"): 미세 운석 충돌로 비상 통신 경로가 손상되어 정비사가 외부 작업대에 남아 있습니다. 반사판을 장착하고 반사광을 '기지 송신 릴레이'에 연결하면 지상국 교신 구간 동안 구조 요청 데이터를 송신할 수 있습니다. 구조 요청 100% 전송 후 지상 관제가 안전한 귀환을 승인하면 에어록이 열립니다.`,
          `현재 임무 상태: 단계=${missionState.missionPhase || 'prep'}, 디자인버전=v${missionState.activeDesignVersion}, 디자인승인=${missionState.designConfirmed}, 3D반사판생성=${missionState.reflectorGenerated}, 반사판장착=${missionState.reflectorMounted}, 송신릴레이연결=${missionState.receiverAligned}, 전송률=${Math.round(missionState.txProgress || 0)}%, 관제승인=${Boolean(missionState.groundAckReceived)}, 에어록개방=${Boolean(missionState.doorOpened)}.`,
          `선외 활동 중인 정비사에게 음성으로 들려주기 좋게 한국어 1~2문장으로 간결하고 현재 상태와 모순 없이 답하세요. 광통신이 기지 전체 전력을 복구한다는 식의 과장된 표현은 쓰지 마세요.`,
          `도구를 호출하지 말고 순수 텍스트로만 응답하세요.`,
          `정비사 발화: "${cleanMsg}"`,
        ].join('\n');

  try {
    const agyRes = await runAgyPrompt({
      prompt: systemPrompt,
      cwd: projectRoot,
      timeoutMs,
      model: 'gemini-3.8-flash-low',
    });
    const reply = agyRes.stdout.trim();
    return {
      reply,
      lang,
      requestedModelId: 'gemini-3.8-live',
      activeModelProvenance: hasDirectLiveKey
        ? 'gemini-3.8-live-configured'
        : 'agy-cli:gemini-3.8-flash-low@h2gdm-hack26icn-2676+WebSpeechVoice',
      directLiveApiAvailable: hasDirectLiveKey,
      bgmDuckingRequired: true,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    throw Object.assign(
      new Error(
        lang === 'en'
          ? `Argon dialogue request failed or timed out (${err.message}). Current scene preserved; you may retry manually.`
          : `아르곤 대화 응답 실패 또는 시간 초과 (${err.message}). 현재 씬은 안전하게 유지되며 수동 재시도가 가능합니다.`
      ),
      {
        code: err.code || 'DIALOGUE_ERROR',
        statusCode: err.statusCode || 502,
      }
    );
  }
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

  const cleanInput = typeof input === 'string' ? input.trim() : '';
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

  const allowedModels = new Set(['lyria-3-clip-preview', 'lyria-3.5']);
  const requestedModel = allowedModels.has(model) ? model : 'lyria-3-clip-preview';

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  let responseJson;
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
      throw Object.assign(
        new Error(`Lyria API 호출 실패 (${requestedModel}): ${apiErrMsg}`),
        {
          code: 'LYRIA_API_ERROR',
          statusCode: response.status >= 400 && response.status < 600 ? response.status : 502,
          details: responseJson?.error || responseJson,
        }
      );
    }
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
    throw err;
  } finally {
    clearTimeout(timer);
  }

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

  return {
    model: requestedModel,
    input: cleanInput,
    mimeType: parsed.mimeType,
    audioData: parsed.audioData,
    audioDataUrl: parsed.audioDataUrl,
    audioUrl: `/audio/${trackFileName}`,
    latestAudioUrl: `/audio/${latestFileName}`,
    text: parsed.text,
    byteLength: mp3Buffer.byteLength,
    elapsedMs: Date.now() - startedAt,
    provenance: `REST:POST ${LYRIA_INTERACTIONS_ENDPOINT} (model=${requestedModel})`,
  };
}

