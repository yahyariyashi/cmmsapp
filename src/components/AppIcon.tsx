import { Text, StyleSheet, View } from 'react-native';

type Props = {
  name?: string;
  size?: number;
  color: string;
  fallback: string;
};

/** Text-only icons — never blank squares, no font loading required. */
export function AppIcon({ size = 22, color, fallback }: Props) {
  return (
    <View
      style={{
        width: size + 6,
        height: size + 6,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontSize: Math.round(size * 0.95),
          color,
          fontWeight: '700',
          textAlign: 'center',
        }}
      >
        {fallback}
      </Text>
    </View>
  );
}

export function ActionIconCircle({
  fallback,
  color,
  bg,
}: {
  name?: string;
  fallback: string;
  color: string;
  bg: string;
}) {
  return (
    <View style={[styles.wrap, { backgroundColor: bg }]}>
      <Text style={{ fontSize: 26, color, fontWeight: '700' }}>{fallback}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
});
