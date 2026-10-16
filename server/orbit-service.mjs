const CELESTRAK_GP_URL =
  'https://celestrak.org/NORAD/elements/gp.php?CATNR=100902&FORMAT=json';
const SATELLITEMAP_API_URL =
  'https://api2.satellitemap.space/satellites?norads=100902';

const MU_EARTH_KM3_S2 = 398600.4418;
const EARTH_RADIUS_KM = 6378.137;
const SECONDS_PER_DAY = 86400;
const EARTH_SIDEREAL_RAD_PER_SEC = (2 * Math.PI) / 86164.0905;

// Verified CelesTrak GP record for NORAD 100902 (PROJECT SUNCATCHER M1) as offline fallback
const FALLBACK_GP_RECORD = {
  OBJECT_NAME: 'PROJECT SUNCATCHER M1',
  OBJECT_ID: '2026-227V',
  EPOCH: '2026-10-15T22:17:51.238464',
  MEAN_MOTION: 15.17120308,
  ECCENTRICITY: 0.00023159,
  INCLINATION: 97.4423,
  RA_OF_ASC_NODE: 358.1937,
  ARG_OF_PERICENTER: 82.7922,
  MEAN_ANOMALY: 277.3574,
  NORAD_CAT_ID: 100902,
  REV_AT_EPOCH: 215,
  BSTAR: 0.00020289218,
  MEAN_MOTION_DOT: 3.956e-5,
};

let cachedOrbitData = null;
let lastFetchMs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function parseUtcEpochMs(epochStr) {
  if (!epochStr) return Date.now();
  const normalized = epochStr.endsWith('Z') ? epochStr : `${epochStr}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeAnglePositive(rad) {
  const twoPi = Math.PI * 2;
  return ((rad % twoPi) + twoPi) % twoPi;
}

function wrapDeg180(deg) {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  return d;
}

export function propagateOrbitAtMs(elements, timestampMs = Date.now()) {
  const nRadPerSec = (elements.meanMotionRevPerDay * 2 * Math.PI) / SECONDS_PER_DAY;
  const semiMajorAxisKm = Math.cbrt(MU_EARTH_KM3_S2 / (nRadPerSec * nRadPerSec));
  const dtSec = (timestampMs - elements.epochMs) / 1000;

  const m0Rad = (elements.meanAnomalyDeg * Math.PI) / 180;
  const meanAnomalyRad = normalizeAnglePositive(m0Rad + nRadPerSec * dtSec);

  const e = elements.eccentricity;
  let E = meanAnomalyRad;
  for (let i = 0; i < 4; i++) {
    E = E - (E - e * Math.sin(E) - meanAnomalyRad) / (1 - e * Math.cos(E));
  }

  const trueAnomalyRad =
    2 *
    Math.atan2(
      Math.sqrt(1 + e) * Math.sin(E / 2),
      Math.sqrt(1 - e) * Math.cos(E / 2)
    );
  const argPericenterRad = (elements.argOfPericenterDeg * Math.PI) / 180;
  const argumentOfLatitudeRad = normalizeAnglePositive(argPericenterRad + trueAnomalyRad);

  const radiusKm = semiMajorAxisKm * (1 - e * Math.cos(E));
  const altitudeKm = radiusKm - EARTH_RADIUS_KM;
  const velocityKms = Math.sqrt(MU_EARTH_KM3_S2 * (2 / radiusKm - 1 / semiMajorAxisKm));

  const incRad = (elements.inclinationDeg * Math.PI) / 180;
  const raanRad = (elements.raanDeg * Math.PI) / 180;

  const xOrb = Math.cos(argumentOfLatitudeRad);
  const yOrb = Math.sin(argumentOfLatitudeRad);

  const xEci = xOrb * Math.cos(raanRad) - yOrb * Math.cos(incRad) * Math.sin(raanRad);
  const yEci = xOrb * Math.sin(raanRad) + yOrb * Math.cos(incRad) * Math.cos(raanRad);
  const zEci = yOrb * Math.sin(incRad);

  // Greenwich Mean Sidereal Time
  const jd = timestampMs / 86400000 + 2440587.5;
  const gmstDeg = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
  const gmstRad = normalizeAnglePositive((gmstDeg * Math.PI) / 180);

  const latRad = Math.asin(Math.max(-1, Math.min(1, zEci)));
  const lonRad = Math.atan2(yEci, xEci) - gmstRad;

  const latDeg = Number(((latRad * 180) / Math.PI).toFixed(4));
  const lonDeg = Number(wrapDeg180((lonRad * 180) / Math.PI).toFixed(4));

  return {
    timestampMs,
    argumentOfLatitudeRad,
    argumentOfLatitudeDeg: Number(((argumentOfLatitudeRad * 180) / Math.PI).toFixed(2)),
    latDeg,
    lonDeg,
    altitudeKm: Number(altitudeKm.toFixed(1)),
    velocityKms: Number(velocityKms.toFixed(2)),
    gmstRad,
  };
}

export async function getSatelliteOrbitTelemetry({ forceRefresh = false } = {}) {
  const now = Date.now();
  let gpRecord = FALLBACK_GP_RECORD;
  let source = 'celestrak-gp-fallback';
  let satMapMeta = null;

  if (!forceRefresh && cachedOrbitData && now - lastFetchMs < CACHE_TTL_MS) {
    gpRecord = cachedOrbitData.gpRecord;
    source = `${cachedOrbitData.source}-cached`;
    satMapMeta = cachedOrbitData.satMapMeta;
  } else {
    try {
      const res = await fetch(CELESTRAK_GP_URL, {
        signal: AbortSignal.timeout(3500),
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr) && arr.length > 0 && arr[0].MEAN_MOTION) {
          gpRecord = arr[0];
          source = 'celestrak-gp-live';
        }
      }
    } catch {
      // Fallback to verified NORAD 100902 GP record
    }

    try {
      const smRes = await fetch(SATELLITEMAP_API_URL, {
        signal: AbortSignal.timeout(2500),
        headers: { Accept: 'application/json' },
      });
      if (smRes.ok) {
        const smJson = await smRes.json();
        if (smJson?.data?.[0]) {
          satMapMeta = {
            satName: smJson.data[0].sat_name,
            launchDate: smJson.data[0].launch_date,
            status: smJson.data[0].status,
          };
        }
      }
    } catch {
      // Optional metadata enrichment
    }

    cachedOrbitData = { gpRecord, source, satMapMeta };
    lastFetchMs = now;
  }

  const epochMs = parseUtcEpochMs(gpRecord.EPOCH);
  const elements = {
    noradId: Number(gpRecord.NORAD_CAT_ID || 100902),
    objectName: gpRecord.OBJECT_NAME || 'PROJECT SUNCATCHER M1',
    objectId: gpRecord.OBJECT_ID || '2026-227V',
    epoch: gpRecord.EPOCH,
    epochMs,
    meanMotionRevPerDay: Number(gpRecord.MEAN_MOTION),
    eccentricity: Number(gpRecord.ECCENTRICITY),
    inclinationDeg: Number(gpRecord.INCLINATION),
    raanDeg: Number(gpRecord.RA_OF_ASC_NODE),
    argOfPericenterDeg: Number(gpRecord.ARG_OF_PERICENTER),
    meanAnomalyDeg: Number(gpRecord.MEAN_ANOMALY),
    revAtEpoch: Number(gpRecord.REV_AT_EPOCH || 215),
  };

  const nRadPerSec = (elements.meanMotionRevPerDay * 2 * Math.PI) / SECONDS_PER_DAY;
  const semiMajorAxisKm = Math.cbrt(MU_EARTH_KM3_S2 / (nRadPerSec * nRadPerSec));
  const meanAltitudeKm = semiMajorAxisKm - EARTH_RADIUS_KM;
  const periodSec = SECONDS_PER_DAY / elements.meanMotionRevPerDay;
  const meanVelocityKms = Math.sqrt(MU_EARTH_KM3_S2 / semiMajorAxisKm);

  const currentState = propagateOrbitAtMs(elements, now);

  return {
    ok: true,
    source,
    apiUrl: CELESTRAK_GP_URL,
    referenceUrl: 'https://satellitemap.space/vis/satellite/norad/100902/track',
    satMapMeta,
    elements,
    derived: {
      semiMajorAxisKm: Number(semiMajorAxisKm.toFixed(2)),
      altitudeKm: Number(meanAltitudeKm.toFixed(1)),
      periodSec: Number(periodSec.toFixed(1)),
      periodMin: Number((periodSec / 60).toFixed(2)),
      velocityKms: Number(meanVelocityKms.toFixed(2)),
      angularRateRadPerSec: nRadPerSec,
      earthRotationRateRadPerSec: EARTH_SIDEREAL_RAD_PER_SEC,
    },
    currentState,
  };
}
