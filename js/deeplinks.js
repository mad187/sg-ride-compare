// Launch provider apps: trip-prefilled deep link where supported,
// plain scheme otherwise. Detects (roughly) whether the app opened by
// watching for the page being backgrounded within a short window.

function fillTemplate(template, trip) {
  return template
    .replace('{plat}', trip.from.lat.toFixed(6))
    .replace('{plng}', trip.from.lng.toFixed(6))
    .replace('{paddr}', encodeURIComponent(trip.from.address || trip.from.label))
    .replace('{dlat}', trip.to.lat.toFixed(6))
    .replace('{dlng}', trip.to.lng.toFixed(6))
    .replace('{daddr}', encodeURIComponent(trip.to.address || trip.to.label));
}

export function buildLaunchUrl(provider, trip) {
  if (provider.prefill && trip) return fillTemplate(provider.prefill, trip);
  return provider.scheme;
}

// Resolves { opened } ~2s after the launch attempt. If the page was
// hidden in that window, the app almost certainly opened.
export function launchApp(provider, trip) {
  return new Promise((resolve) => {
    let hidden = false;
    const onVis = () => {
      if (document.visibilityState === 'hidden') hidden = true;
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onVis);
    window.location.href = buildLaunchUrl(provider, trip);
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onVis);
      resolve({ opened: hidden || document.visibilityState === 'hidden' });
    }, 2000);
  });
}

// Clipboard write; must be called from a user gesture. Never throws.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}
