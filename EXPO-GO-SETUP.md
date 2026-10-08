# MedMetric CMMS - Expo Go Setup Guide
## Run on your phone in 5 minutes!

---

## STEP 1: Get GLPI App Token (Do This First!)

1. Go to: https://tech.medmetrichealthcare.com
2. Login as Super Admin
3. Go to: Setup → General → API
4. Enable REST API: YES ✅
5. Scroll to "API clients" section
6. Click: + Add API client
7. Fill:
   - Name: MedMetric Mobile App
   - Active: YES
   - IP: * (allow all)
8. Click Save
9. COPY the App Token shown

---

## STEP 2: Paste App Token Into Code

Open: `src/config/settings.ts`

Change this line:
```
export const DEFAULT_APP_TOKEN = 'PASTE_YOUR_APP_TOKEN_HERE';
```

To your actual token:
```
export const DEFAULT_APP_TOKEN = 'your-actual-token-here';
```

Save the file.

---

## STEP 3: Install Dependencies (On Your PC)

Open terminal in the medmetric-app folder:

```bash
npm install
npx expo install expo-font @expo/vector-icons expo-secure-store expo-print expo-sharing
```

---

## STEP 4: Start Expo Go Server

```bash
npx expo start -c
```

You will see a QR code in the terminal.

---

## STEP 5: Open on Phone

1. Install **Expo Go** from Play Store / App Store
2. Open Expo Go
3. Tap: "Scan QR Code"
4. Scan the QR code from terminal
5. App loads on your phone!

---

## STEP 6: Login

On the login screen:
- **Username:** your GLPI username
- **Password:** your GLPI password
- Tap: Sign In

(URL and App Token are pre-configured!)

---

## TROUBLESHOOTING

### Error: "expo-font not found"
```bash
npm install expo-font @expo/vector-icons
npx expo start -c
```

### Error: "App-Token missing"
- Make sure you pasted the token in `settings.ts`
- Check Setup → General → API in GLPI

### Error: "Login failed"
- Check username/password in GLPI
- Check API is enabled in GLPI

### App not loading on phone
- Make sure phone and PC are on same WiFi
- Try: npx expo start --tunnel

---

## YOUR SETTINGS (Pre-configured)

```
Server URL: https://tech.medmetrichealthcare.com/public
App Token:  (paste in settings.ts)
API Path:   /apirest.php
```

---

## LOGIN CREDENTIALS (Your Team)

| Name | Username | Role |
|------|----------|------|
| Yahya Mohammed | yahya | Technician |
| Yared Shimeles | yared | Supervisor |
| Yohanes Getachew | yohanes | Technician |
| Super Admin | admin | Super Admin |

---

## WHAT THE APP DOES

✅ View all tickets — newest first, searchable by # or title
✅ Create new tickets
✅ View equipment (Hemodialysis, Water Treatment, CT) — grouped by
   location, searchable by name / serial number / location
✅ Update ticket status
✅ Tasks shown first on a ticket, most recent first
✅ Add followups/comments
✅ View assigned technician
✅ Link equipment to tickets
✅ Export a ticket as a PDF report and share it
✅ Username + profile photo shown in the header and Profile tab

---

## ADMIN: CHANGING THE SERVER / APP TOKEN

Field technicians never see server URL or App Token fields — login
only ever asks for username and password.

To change them (e.g. pointing the app at a different GLPI server),
**long-press the version label** at the bottom of the login screen
for 2 seconds. This reveals the Server URL / App Token fields for
that session only.

---

**Time to run: 5 minutes after setup!** 🚀
