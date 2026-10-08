import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeId, ThemeColors, THEME_PRESETS } from '../theme';
import { secureGet, secureSet } from '../secureStorage';

type ThemeCtx = {
  themeId: ThemeId;
  colors: ThemeColors;
  setThemeId: (id: ThemeId) => void;
};

const ThemeContext = createContext<ThemeCtx>({
  themeId: 'medicalBlue',
  colors: THEME_PRESETS.medicalBlue.colors,
  setThemeId: () => undefined,
});

const KEY = 'medmetric_theme_id';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>('medicalBlue');

  useEffect(() => {
    secureGet(KEY).then((v) => {
      if (v && v in THEME_PRESETS) setThemeIdState(v as ThemeId);
    });
  }, []);

  const setThemeId = (id: ThemeId) => {
    setThemeIdState(id);
    void secureSet(KEY, String(id));
  };

  const value = useMemo(
    () => ({
      themeId,
      colors: THEME_PRESETS[themeId].colors,
      setThemeId,
    }),
    [themeId]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
