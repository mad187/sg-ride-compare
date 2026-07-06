# SG Ride Compare

A home-screen web app (PWA) for iPhone that compares Singapore ride-hailing fares —
**Grab, Gojek, TADA, CDG Zig** — and hands you into the cheapest app to book.

**Use it:** open https://mad187.github.io/sg-ride-compare/ in Safari → Share → **Add to Home Screen**.

## How it works

- Type pickup and destination once (OneMap autocomplete: postal codes, buildings, streets).
- **Quick Book**: instantly ranks providers by estimated fare (route distance/time × each
  provider's fare table) blended with prices it remembers from your past checks. One tap
  opens the best app with your trip pre-filled (Grab) or the destination copied to your
  clipboard (the rest).
- **Check all live prices**: opens each enabled app in turn; you glance at the live quote,
  flip back, tap it in. The app ranks the results and remembers them for next time.
- **Settings**: toggle which apps you have installed.

No accounts, no server — everything (recents, remembered quotes, settings) stays in your
phone's browser storage.

## Why it can't book for you

None of the providers offer public price or booking APIs, and iOS does not let any app
read or control another app's screen. So estimates + fast handoff is the ceiling; the
final price and booking always happen in the provider's own app.

## Tweaking

- `fares.json` — per-provider fare tables, peak windows, airport surcharges. Edit and push.
- `providers.json` — provider list, deep-link schemes, App Store links.
