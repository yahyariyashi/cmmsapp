/**
 * Optional custom font (IBM Plex Sans, like the reference design).
 * Off by default so the app always builds. To turn it on, follow FONTS.md.
 */
import { Text } from 'react-native';

/** Set to true after you add the .ttf files and uncomment the require() lines below. */
export const FONTS_ENABLED = false;

export const FONT_REGULAR = 'IBMPlexSans-Regular';

export async function loadAppFonts(): Promise<boolean> {
  if (!FONTS_ENABLED) return false;
  try {
    const Font = await import('expo-font');
    await Font.loadAsync({
      // Uncomment these two lines after copying the files into assets/fonts/ :
      // [FONT_REGULAR]: require('../assets/fonts/IBMPlexSans-Regular.ttf'),
      // 'IBMPlexSans-SemiBold': require('../assets/fonts/IBMPlexSans-SemiBold.ttf'),
    });
    // Make every <Text> use the font unless a screen sets its own family.
    const T = Text as unknown as { render?: (...a: unknown[]) => any };
    if (typeof T.render === 'function' && !(T as { __patched?: boolean }).__patched) {
      const orig = T.render;
      T.render = function patched(this: unknown, ...args: unknown[]) {
        const el = orig.apply(this, args);
        if (!el || !el.props) return el;
        const { cloneElement } = require('react');
        return cloneElement(el, { style: [{ fontFamily: FONT_REGULAR }, el.props.style] });
      };
      (T as { __patched?: boolean }).__patched = true;
    }
    return true;
  } catch {
    return false; // never block the app because of a font
  }
}
