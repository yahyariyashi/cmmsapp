# medMETRIC CMMS Mobile

Cross-platform **Android + iOS** app (Expo / React Native) connected to **medMETRIC CMMS**.

## Product roadmap

| Phase | Module | Status in this scaffold |
|-------|--------|-------------------------|
| 1 | **CMMS** — login, tickets, follow-ups, medical equipment | Implemented |
| 2 | **Field service** (Office Ninja–style) — tasks, checklists, offline queue | Planned |
| 3 | **Tender notifier + ERP** — tender alerts, technical & financial packs | Planned (feature flags off) |
| 4 | **AI analysis** — same AI API family as PDF reports | Planned |

## Prerequisites (CMMS server)

1. **Setup → General → API** → enable **Active REST API**
2. Optional: create an **App-Token** and put it in app Settings later
3. User accounts must be allowed to use the API
4. Hospital CMMS plugin active for equipment endpoints
5. HTTPS recommended (`https://yamin.medmetrichealthcare.com`)

## Run locally

```bash
cd medmetric-app
npm install
npx expo start
```

- Press `a` for Android emulator / device  
- Press `i` for iOS simulator (macOS)  
- Scan QR with **Expo Go** for a quick device test  

Default server URL: `https://yamin.medmetrichealthcare.com` (change on the login screen → Server settings).

## Build store installs (EAS)

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android
eas build --platform ios
```

## Architecture

- `src/api/cmmsClient.ts` — CMMS REST API (`apirest.php`) (initSession, Ticket, plugin equipment)
- `src/context/AuthContext.tsx` — session + SecureStore
- `app/(tabs)/` — Home, Tickets, Equipment, More
- Feature flags in `src/config/settings.ts`

## Note on “Office Ninja”

Field workflows will mirror typical mobile CMMS / ops apps: assigned work list, on-site notes, photos, checklist completion, and sync to CMMS tickets — not a clone of a third-party product.

## ERP & tenders (later)

Will need either:

- CMMS plugins / custom itemtypes for tenders, or  
- A small medMETRIC backend that stores tender documents and pushes notifications  

The mobile app will consume that API the same way it consumes the CMMS API today.
