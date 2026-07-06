// Ballpark fare estimation from editable fares.json tables.
// Estimates ignore live surge; shown as a range and always labelled as estimates.

import { haversineKm } from './route.js';

let FARES = null;

export async function loadFares() {
  if (!FARES) {
    const res = await fetch('./fares.json');
    FARES = await res.json();
  }
  return FARES;
}

function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Multiplier for the current time from peak windows (windows may cross midnight).
export function peakMultiplier(date = new Date()) {
  const day = date.getDay();
  const now = date.getHours() * 60 + date.getMinutes();
  let best = { multiplier: 1, label: '' };
  for (const w of FARES.peak) {
    if (!w.days.includes(day)) continue;
    const start = minutesOfDay(w.start);
    const end = minutesOfDay(w.end);
    const inWindow = start <= end ? now >= start && now < end : now >= start || now < end;
    if (inWindow && w.multiplier > best.multiplier) best = w;
  }
  return best;
}

function locationSurcharges(from) {
  const hits = [];
  for (const s of FARES.surcharges) {
    if (s.appliesTo !== 'pickup') continue;
    if (haversineKm(from, { lat: s.lat, lng: s.lng }) <= s.radiusKm) hits.push(s);
  }
  return hits;
}

// Returns { low, mid, high, notes } for one provider id, or null if no table.
export function estimate(providerId, km, min, from, date = new Date()) {
  const p = FARES.products[providerId];
  if (!p) return null;
  const peak = peakMultiplier(date);
  const surcharges = locationSurcharges(from);
  const metered = (p.base + p.perKm * km + p.perMin * min) * peak.multiplier;
  const extras = p.bookingFee + surcharges.reduce((sum, s) => sum + s.amount, 0);
  const mid = metered + extras;
  const u = FARES.uncertainty;
  const notes = [];
  if (peak.label) notes.push(peak.label);
  for (const s of surcharges) notes.push(s.name);
  return { low: mid * (1 - u), mid, high: mid * (1 + u), notes };
}

export function fmtSGD(n) {
  return `$${n.toFixed(2)}`;
}

export function fmtRange(est) {
  return `$${est.low.toFixed(0)}–${Math.ceil(est.high)}`;
}
