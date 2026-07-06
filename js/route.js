// Trip distance/duration: OSRM demo server, haversine fallback.

const OSRM = 'https://router.project-osrm.org/route/v1/driving';

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const URBAN_DETOUR = 1.3; // straight-line to road-distance factor
const CITY_SPEED_KMH = 28;

export async function getRoute(from, to) {
  try {
    const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.code || 'no route');
    const r = data.routes[0];
    return { km: r.distance / 1000, min: r.duration / 60, approx: false };
  } catch (e) {
    const km = haversineKm(from, to) * URBAN_DETOUR;
    return { km, min: (km / CITY_SPEED_KMH) * 60, approx: true };
  }
}
