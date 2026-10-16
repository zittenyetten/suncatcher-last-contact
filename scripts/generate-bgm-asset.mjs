import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_LYRIA_PROMPT,
  LYRIA_INTERACTIONS_ENDPOINT,
  generateLyriaMusic,
  getGeminiApiKey,
} from '../server/ai-services.mjs';

const projectRoot = process.cwd();
const audioDir = path.join(projectRoot, 'public', 'audio');
const verifyDir = path.join(projectRoot, 'artifacts', 'verification');
await mkdir(audioDir, { recursive: true });
await mkdir(verifyDir, { recursive: true });

// AI-Composed 4-Bar Orbital Sci-Fi Score ("Orbital Sunrise") generated via
// agy.exe --project h2gdm-hack26icn-2676 --model gemini-3.8-flash-low
const score = {
  piece_title: 'Orbital Sunrise',
  tempo_bpm: 60,
  bars: [
    {
      chord: 'Dsus2',
      pad_frequencies_hz: [73.42, 146.83, 220.0, 293.66, 329.63],
      arpeggio_pattern: [293.66, 329.63, 440.0, 659.25, 587.33, 440.0, 329.63, 220.0],
    },
    {
      chord: 'Bbmaj7#11',
      pad_frequencies_hz: [58.27, 116.54, 233.08, 293.66, 370.0, 440.0],
      arpeggio_pattern: [293.66, 329.63, 369.99, 440.0, 587.33, 659.25, 440.0, 369.99],
    },
    {
      chord: 'Csus2/E',
      pad_frequencies_hz: [82.41, 130.81, 196.0, 261.63, 293.66, 392.0],
      arpeggio_pattern: [196.0, 261.63, 293.66, 392.0, 587.33, 659.25, 587.33, 392.0],
    },
    {
      chord: 'Asus4(add9)',
      pad_frequencies_hz: [55.0, 110.0, 220.0, 293.66, 329.63, 440.0],
      arpeggio_pattern: [220.0, 246.94, 293.66, 329.63, 440.0, 493.88, 659.25, 587.33],
    },
  ],
};

const apiKey = getGeminiApiKey(projectRoot);
const hasApiKey = Boolean(apiKey);
const requestedModel = process.env.LYRIA_MODEL || 'lyria-3-clip-preview';
const requestedPrompt = process.env.LYRIA_PROMPT || DEFAULT_LYRIA_PROMPT;
let lyriaResult = null;
if (hasApiKey) {
  try {
    lyriaResult = await generateLyriaMusic({
      model: requestedModel,
      input: requestedPrompt,
      projectRoot,
      apiKey,
    });
    console.log(
      `Generated Lyria MP3 via ${LYRIA_INTERACTIONS_ENDPOINT}:`,
      lyriaResult.latestAudioUrl,
      `(${lyriaResult.byteLength} bytes, model=${lyriaResult.model})`
    );
  } catch (err) {
    console.warn('Lyria API call failed during asset build, keeping fallback WAV:', err.message);
  }
}

const lyriaCheck = {
  requestedModelId: requestedModel,
  endpoint: LYRIA_INTERACTIONS_ENDPOINT,
  gcpProject: 'h2gdm-hack26icn-2676',
  directApiKeyPresent: hasApiKey,
  lyriaDirectStatus: lyriaResult
    ? 'VERIFIED_LYRIA_INTERACTIONS_REST_API'
    : 'FALLBACK_WAV_SYNTHESIS',
  lyriaGeneratedAsset: lyriaResult ? 'public/audio/lyria-bgm-latest.mp3' : null,
  lyriaMimeType: lyriaResult ? lyriaResult.mimeType : null,
  lyriaByteLength: lyriaResult ? lyriaResult.byteLength : null,
  lyriaExtractedText: lyriaResult ? lyriaResult.text : null,
  fallbackAssetGenerated: 'public/audio/orbital-dawn-bgm.wav',
  generatedAt: new Date().toISOString(),
};

const sampleRate = 44100;
const barDurationSec = 4;
const durationSec = score.bars.length * barDurationSec; // 16s seamless loop
const numSamples = sampleRate * durationSec;
const numChannels = 2;
const bytesPerSample = 2;
const dataSize = numSamples * numChannels * bytesPerSample;
const buffer = Buffer.alloc(44 + dataSize);

buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(numChannels, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(dataSize, 40);

for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  const barIdx = Math.floor(t / barDurationSec) % score.bars.length;
  const bar = score.bars[barIdx];
  const localBarT = t % barDurationSec;

  // Smooth cross-fade envelope per 4s bar
  const padEnv =
    Math.sin((Math.min(localBarT, barDurationSec - localBarT) / 1.8) * (Math.PI / 2)) * 0.8 + 0.2;

  let left = 0;
  let right = 0;

  // Warm stereo chorus pad voices
  for (let c = 0; c < bar.pad_frequencies_hz.length; c++) {
    const freq = bar.pad_frequencies_hz[c];
    const amp = c === 0 ? 0.16 : 0.1 / Math.sqrt(c);
    const detuneL = 1 - 0.0014 * (c + 1);
    const detuneR = 1 + 0.0014 * (c + 1);
    left += Math.sin(2 * Math.PI * freq * detuneL * t) * amp * padEnv;
    right += Math.sin(2 * Math.PI * freq * detuneR * t) * amp * padEnv;
  }

  // Crystalline eighth-note space arpeggio (0.5s per step)
  const stepDur = barDurationSec / bar.arpeggio_pattern.length;
  const stepIdx = Math.floor(localBarT / stepDur) % bar.arpeggio_pattern.length;
  const stepT = localBarT % stepDur;
  const arpFreq = bar.arpeggio_pattern[stepIdx];
  const arpEnv = Math.exp(-stepT * 5.2) * Math.min(1, stepT * 80);
  const pan = 0.5 + 0.35 * Math.sin(stepIdx * 1.3);
  const arpSignal =
    (Math.sin(2 * Math.PI * arpFreq * t) * 0.11 +
      Math.sin(2 * Math.PI * arpFreq * 2 * t) * 0.03) *
    arpEnv;

  left += arpSignal * pan;
  right += arpSignal * (1 - pan);

  const sampleL = Math.max(-0.95, Math.min(0.95, left));
  const sampleR = Math.max(-0.95, Math.min(0.95, right));

  const offset = 44 + i * 4;
  buffer.writeInt16LE(Math.round(sampleL * 32767), offset);
  buffer.writeInt16LE(Math.round(sampleR * 32767), offset + 2);
}

const wavPath = path.join(audioDir, 'orbital-dawn-bgm.wav');
await writeFile(wavPath, buffer);
await writeFile(
  path.join(verifyDir, 'bgm-provenance.json'),
  JSON.stringify(lyriaCheck, null, 2),
  'utf8'
);

console.log('Generated AI-composed Orbital Sunrise BGM WAV:', wavPath, `(${buffer.length} bytes)`);
