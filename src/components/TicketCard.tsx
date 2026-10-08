import { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import type { GlpiTicket } from '../types/glpi';
import { statusUi } from '../theme';
import { useTheme } from '../context/ThemeContext';
import { tr } from '../i18n';
import { priorityLabel, priorityColor, shortDate, assignedLine } from '../uiHelpers';

/** Card used by the Tickets list and the Dashboard (same look as the reference design). */
export const TicketCard = memo(function TicketCard({ item }: { item: GlpiTicket }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const ui = statusUi[item.status] || statusUi[1];
  const pc = priorityColor(item.priority, colors);
  return (
    <Pressable
      style={styles.card}
      onPress={() => item.id && router.push({ pathname: '/ticket/[id]', params: { id: String(item.id) } })}
    >
      <View style={styles.cardTop}>
        <Text style={styles.id}>#{item.id}</Text>
        <View style={[styles.badge, { backgroundColor: ui.color + '1F', borderColor: ui.color + '66' }]}>
          <Text style={[styles.badgeText, { color: ui.color }]}>{tr(ui.label).toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {item.name}
      </Text>
      <View style={styles.metaRow}>
        <View style={[styles.dot, { backgroundColor: pc }]} />
        <Text style={[styles.metaStrong, { color: colors.textMuted }]}>{tr(priorityLabel(item.priority))}</Text>
        {item.location_name ? (
          <Text style={styles.meta} numberOfLines={1}>
            {item.location_name.split('>').pop()?.trim()}
          </Text>
        ) : null}
        {item.date ? <Text style={styles.meta}>{shortDate(item.date)}</Text> : null}
      </View>
      <Text style={styles.assigned}>{assignedLine(item.assigned_label)}</Text>
    </Pressable>
  );
});

function makeStyles(colors: any) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.bgCard,
      borderRadius: 16,
      marginTop: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: colors.border,
      elevation: 1,
      shadowColor: '#0B2A44',
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    id: { color: colors.textDim, fontSize: 12 },
    badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
    badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
    name: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 4 },
    metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 8, gap: 10 },
    dot: { width: 8, height: 8, borderRadius: 4, marginRight: -4 },
    metaStrong: { fontSize: 11, fontWeight: '700' },
    meta: { color: colors.textMuted, fontSize: 11, flexShrink: 1 },
    assigned: { color: colors.textDim, fontSize: 11, marginTop: 8 },
  });
}
