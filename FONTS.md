# Adding the IBM Plex Sans font (optional)

The app already looks right with the phone's own font. To use IBM Plex Sans like the reference design:

1. Download "IBM Plex Sans" from https://fonts.google.com/specimen/IBM+Plex+Sans (Download family).
2. From the zip, copy these two files into `assets/fonts/`:
   - `IBMPlexSans-Regular.ttf`
   - `IBMPlexSans-SemiBold.ttf`
3. Open `src/fonts.ts`:
   - change `FONTS_ENABLED = false` to `true`
   - remove the `//` in front of the two `require(...)` lines
4. Open `app/_layout.tsx` and make sure the `loadAppFonts()` effect is present (it is in 1.0.25).
5. Rebuild: `npx expo start -c` for testing, or a new EAS build for the APK.

Notes
- Bold text still uses the Regular file with faux-bold (custom fonts have one file per weight).
  If you want true bold, add `IBMPlexSans-Bold.ttf` the same way and use it in the styles you care about.
- If a file is missing the build fails at the `require` line — that is why the lines are commented out by default.
- To go back, set `FONTS_ENABLED = false` again.
