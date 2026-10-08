import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { usePrefs, setPrefs } from '../preferences';
import { LANGUAGES, tr } from '../i18n';

/** Language selector: tap to open the list (English · አማርኛ · Afaan Oromoo). The choice is saved. */
export function LanguageDropdown({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find((l) => l.id === prefs.language) || LANGUAGES[0];

  return (
    <View
      style={{
        backgroundColor: colors.bgCard,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{ flexDirection: 'row', alignItems: 'center', padding: compact ? 10 : 14 }}
        accessibilityRole="button"
        accessibilityLabel={tr('Language')}
      >
        <Text style={{ fontSize: 20, marginRight: 10 }}>🌐</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.textDim, fontSize: 11 }}>{tr('Language')}</Text>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{current.label}</Text>
        </View>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open
        ? LANGUAGES.map((l) => {
            const active = l.id === prefs.language;
            return (
              <Pressable
                key={l.id}
                onPress={() => {
                  setOpen(false);
                  void setPrefs({ language: l.id });
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                  backgroundColor: active ? colors.bgCardAlt : 'transparent',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: active ? '800' : '600' }}>{l.label}</Text>
                  {l.label !== l.english ? (
                    <Text style={{ color: colors.textDim, fontSize: 11 }}>{l.english}</Text>
                  ) : null}
                </View>
                {active ? <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 16 }}>✓</Text> : null}
              </Pressable>
            );
          })
        : null}
    </View>
  );
}
