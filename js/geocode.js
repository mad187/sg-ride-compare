// Address search for Singapore: OneMap primary, Nominatim fallback.
// Both allow keyless CORS requests.

const ONEMAP = 'https://www.onemap.gov.sg/api/common/elastic/search';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

function titleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

async function searchOneMap(query) {
  const url = `${ONEMAP}?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OneMap ${res.status}`);
  const data = await res.json();
  const results = data.results || [];
  const seen = new Set();
  const out = [];
  for (const r of results) {
    const lat = parseFloat(r.LATITUDE);
    const lng = parseFloat(r.LONGITUDE);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    const address = titleCase(r.ADDRESS || '');
    if (seen.has(address)) continue;
    seen.add(address);
    out.push({
      label: titleCase(r.SEARCHVAL || r.BUILDING || r.ROAD_NAME || address),
      address,
      postal: r.POSTAL && r.POSTAL !== 'NIL' ? r.POSTAL : '',
      lat,
      lng,
    });
    if (out.length >= 6) break;
  }
  return out;
}

async function searchNominatim(query) {
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=jsonv2&countrycodes=sg&limit=6`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  return data.map((r) => ({
    label: r.display_name.split(',')[0],
    address: r.display_name,
    postal: '',
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

export async function searchAddress(query) {
  query = query.trim();
  if (query.length < 3) return [];
  try {
    const results = await searchOneMap(query);
    if (results.length > 0) return results;
  } catch (e) {
    // fall through to Nominatim
  }
  try {
    return await searchNominatim(query);
  } catch (e) {
    return [];
  }
}

// Best-effort short label for coordinates; never throws.
export async function reverseLabel(lat, lng) {
  try {
    const url = `${NOMINATIM}/reverse?lat=${lat}&lon=${lng}&format=jsonv2&zoom=17`;
    const res = await fetch(url);
    const data = await res.json();
    const a = data.address || {};
    const parts = [a.house_number, a.road || a.suburb || a.neighbourhood].filter(Boolean);
    return parts.length ? parts.join(' ') : 'Current location';
  } catch (e) {
    return 'Current location';
  }
}
