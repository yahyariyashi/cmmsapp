import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { GlpiTicketDetails } from '../api/glpiClient';
import { useTheme } from '../context/ThemeContext';
import { tr } from '../i18n';
import { shortDate } from '../uiHelpers';

type Entry = {
  key: string;
  kind: 'opened' | 'followup' | 'task' | 'solution' | 'document';
  label: string;
  date?: string;
  author?: string;
  body: string;
  taskId?: number;
  taskDone?: boolean;
  docId?: number;
};

const ICON: Record<Entry['kind'], string> = {
  opened: '▤',
  followup: '✎',
  task: '☐',
  solution: '✓',
  document: '⎘',
};

/** One "Process" timeline: opened → follow-ups → tasks → solution → documents, oldest first. */
export function ProcessTimeline({
  ticket,
  canEditTasks,
  onToggleTask,
  onOpenDocument,
}: {
  ticket: GlpiTicketDetails;
  canEditTasks: boolean;
  onToggleTask: (taskId: number, done: boolean) => void;
  onOpenDocument: (docId: number, name: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    out.push({
      key: 'opened',
      kind: 'opened',
      label: tr('TICKET OPENED'),
      date: ticket.date,
      author: ticket.requester_name,
      body: ticket.content || '',
    });
    (ticket.followups || []).forEach((f, i) =>
      out.push({ key: `f${f.id ?? i}`, kind: 'followup', label: tr('FOLLOW-UP'), date: f.date, author: f.author, body: f.content })
    );
    (ticket.tasks || []).forEach((t) =>
      out.push({
        key: `t${t.id}`,
        kind: 'task',
        label: `${tr('TASK')} · ${t.state === 2 ? tr('DONE') : tr('TO DO')}`,
        date: t.date,
        author: t.author,
        body: t.content,
        taskId: t.id,
        taskDone: t.state === 2,
      })
    );
    (ticket.solutionRows || []).forEach((s) =>
      out.push({ key: `s${s.id}`, kind: 'solution', label: tr('SOLUTION'), date: s.date, author: s.author, body: s.content })
    );
    (ticket.documents || []).forEach((d) =>
      out.push({ key: `d${d.id}`, kind: 'document', label: tr('DOCUMENT'), date: d.date, body: d.name, docId: d.id })
    );
    const first = out[0];
    const rest = out.slice(1);
    rest.sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
    return [first, ...rest];
  }, [ticket]);

  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={styles.section}>{tr('Process')}</Text>
      <View style={styles.wrap}>
        <View style={styles.line} />
        {entries.map((e) => (
          <View key={e.key} style={styles.item}>
            <View style={styles.iconWrap}>
              <Text style={styles.icon}>{ICON[e.kind]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{e.label}</Text>
              <Text style={styles.meta}>
                {shortDate(e.date)}
                {e.author ? ` · ${e.author}` : ''}
              </Text>
              {e.kind === 'document' ? (
                <Pressable onPress={() => e.docId && onOpenDocument(e.docId, e.body)}>
                  <Text style={[styles.body, { color: colors.accent, fontWeight: '600' }]}>{e.body}</Text>
                </Pressable>
              ) : e.body ? (
                <Text style={styles.body}>{e.body}</Text>
              ) : null}
              {e.kind === 'task' && canEditTasks && e.taskId ? (
                <Pressable
                  hitSlop={8}
                  onPress={() => onToggleTask(e.taskId!, !e.taskDone)}
                  style={styles.action}
                >
                  <Text style={styles.actionText}>
                    {e.taskDone ? `✓ ${tr('Mark to do')}` : `○ ${tr('Mark done')}`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    section: { color: colors.accent, fontSize: 15, fontWeight: '700', marginTop: 18, marginBottom: 10 },
    wrap: { paddingLeft: 2 },
    line: { position: 'absolute', left: 12, top: 12, bottom: 12, width: 1, backgroundColor: colors.border },
    item: { flexDirection: 'row', gap: 12, marginBottom: 16 },
    iconWrap: {
      width: 24, height: 24, borderRadius: 12, backgroundColor: colors.bgCard,
      borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    },
    icon: { color: colors.accent, fontSize: 12 },
    label: { color: colors.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
    meta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    body: { color: colors.text, fontSize: 14, marginTop: 4, lineHeight: 20 },
    action: { marginTop: 6, alignSelf: 'flex-start' },
    actionText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  });
}
