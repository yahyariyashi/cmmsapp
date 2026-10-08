export type ThemeColors = {
  bg: string; bgCard: string; bgCardAlt: string; header: string;
  primary: string; accent: string; accentSoft: string;
  danger: string; warning: string; success: string;
  text: string; textMuted: string; textDim: string;
  border: string; chip: string; chipOn: string; chipOnText: string; white: string;
};

export type ThemeId = 'medicalBlue' | 'clinicalWhite' | 'fieldDark' | 'venomDark';

export const THEME_PRESETS: Record<ThemeId, { label: string; description: string; colors: ThemeColors }> = {
  medicalBlue: {
    label: 'Medical Blue',
    description: 'Classic hospital blue',
    colors: {
      bg:          '#F0F5FA',
      bgCard:      '#FFFFFF',
      bgCardAlt:   '#E3EDF5',
      header:      '#154360',
      primary:     '#2471A3',
      accent:      '#2E86C1',
      accentSoft:  '#5DADE2',
      danger:      '#E74C3C',
      warning:     '#F39C12',
      success:     '#27AE60',
      text:        '#1C1C1C',
      textMuted:   '#5A6C7D',
      textDim:     '#85929E',
      border:      '#D5DBDB',
      chip:        '#EBF5FB',
      chipOn:      '#2E86C1',
      chipOnText:  '#FFFFFF',
      white:       '#FFFFFF',
    },
  },
  clinicalWhite: {
    label: 'Clinical White',
    description: 'Clean hospital white & teal',
    colors: {
      bg:          '#F5FAFA',
      bgCard:      '#FFFFFF',
      bgCardAlt:   '#E8F5F5',
      header:      '#006D6D',
      primary:     '#008080',
      accent:      '#00A0A0',
      accentSoft:  '#40C0C0',
      danger:      '#DC143C',
      warning:     '#FF8C00',
      success:     '#228B22',
      text:        '#1A1A1A',
      textMuted:   '#666666',
      textDim:     '#999999',
      border:      '#CCCCCC',
      chip:        '#E0F2F1',
      chipOn:      '#00A0A0',
      chipOnText:  '#FFFFFF',
      white:       '#FFFFFF',
    },
  },
  fieldDark: {
    label: 'Field Dark',
    description: 'Dark with amber highlights',
    colors: {
      bg:          '#1E1E1E',
      bgCard:      '#2D2D2D',
      bgCardAlt:   '#3A3A3A',
      header:      '#0D0D0D',
      primary:     '#FF9800',
      accent:      '#FFB74D',
      accentSoft:  '#FFD54F',
      danger:      '#FF6B6B',
      warning:     '#FFA500',
      success:     '#4CAF50',
      text:        '#E5E5E5',
      textMuted:   '#A0A0A0',
      textDim:     '#707070',
      border:      '#4A4A4A',
      chip:        '#2D2D2D',
      chipOn:      '#FFB74D',
      chipOnText:  '#000000',
      white:       '#FFFFFF',
    },
  },
  venomDark: {
    label: 'Dark Venom',
    description: 'Pure black with toxic-green glow',
    colors: {
      bg:          '#000000',
      bgCard:      '#0A0A0A',
      bgCardAlt:   '#141414',
      header:      '#050505',
      primary:     '#39E75F',
      accent:      '#39E75F',
      accentSoft:  '#8CF7A6',
      danger:      '#FF5566',
      warning:     '#FFAA00',
      success:     '#39E75F',
      text:        '#FFFFFF',
      textMuted:   '#AAAAAA',
      textDim:     '#666666',
      border:      '#222222',
      chip:        '#0F0F0F',
      chipOn:      '#39E75F',
      chipOnText:  '#000000',
      white:       '#FFFFFF',
    },
  },
};

export const colors = THEME_PRESETS.medicalBlue.colors;

export const statusUi: Record<number, { label: string; color: string; filter: string }> = {
  1: { label: 'New',         color: '#1565C0', filter: 'New' },
  2: { label: 'Assigned',    color: '#E65100', filter: 'In progress' },
  3: { label: 'Planned',     color: '#6A1B9A', filter: 'Planned' },
  4: { label: 'Pending',     color: '#F57F17', filter: 'Pending' },
  5: { label: 'Solved',      color: '#00796B', filter: 'Solved' },
  6: { label: 'Closed',      color: '#424242', filter: 'Closed' },
};
