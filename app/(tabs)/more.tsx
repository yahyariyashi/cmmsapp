import { tr } from '../../src/i18n';
import { View, Text, StyleSheet, Pressable, Image, ScrollView, TextInput, Alert, Linking, Switch } from 'react-native';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState, useEffect } from 'react';
import {
  requestNotificationPermission,
  getNotificationPermissionStatus,
} from '../../src/notifications';
import { router } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { THEME_PRESETS, ThemeId } from '../../src/theme';
import { usePrefs, setPrefs, type UploadQuality } from '../../src/preferences';
import { cache } from '../../src/cache';
import { LanguageDropdown } from '../../src/components/LanguageDropdown';
import { diag } from '../../src/diagnostics';
import { clearQueue, flushQueue, pendingCount } from '../../src/offlineQueue';

const APP_VERSION = Constants.expoConfig?.version || '1.0.29';

type Health = { state: 'checking' | 'ok' | 'bad'; ms?: number; error?: string };

export default function MoreScreen() {
  const { signOut, config, loginName, realName, userPicture, clearServerConfig, client, userId } = useAuth();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [notifStatus, setNotifStatus] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');

  const prefs = usePrefs();
  const [health, setHealth] = useState<Health>({ state: 'checking' });
  const [queued, setQueued] = useState(0);
  const [themeOpen, setThemeOpen] = useState(false);
  const [stockHealth, setStockHealth] = useState<{ state: 'idle' | 'checking' | 'ok' | 'bad'; text?: string }>({ state: 'idle' });

  const runStockCheck = async () => {
    if (!client) return;
    setStockHealth({ state: 'checking' });
    try {
      const r = await client.checkStockPlugin();
      setStockHealth({ state: r.ok ? 'ok' : 'bad', text: r.detail });
    } catch (e) {
      setStockHealth({ state: 'bad', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const runHealth = async () => {
    if (!client) return;
    setHealth({ state: 'checking' });
    const r = await client.ping();
    setHealth(r.ok ? { state: 'ok', ms: r.ms } : { state: 'bad', ms: r.ms, error: r.error });
  };

  useEffect(() => {
    void getNotificationPermissionStatus().then(setNotifStatus);
    void runHealth();
    void pendingCount().then(setQueued);
  }, []);
  const { colors, themeId, setThemeId } = useTheme();
  // + / − sections: the long ones start closed so the page stays short
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({
    status: true, appearance: true, language: true,
    account: false, notifications: false, sync: false, diagnostics: false, organization: false,
  });
  const toggleSec = (k: string) => setOpenSec((o) => ({ ...o, [k]: !o[k] }));

  const logout = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  const initials = (realName || loginName || 'U')
    .split(/[\s._-]+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const styles = makeStyles(colors);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.hTitle}>{tr('Profile')}</Text>

      <View style={styles.profileCard}>
        {userPicture ? (
          <Image source={{ uri: userPicture }} style={styles.avatarPhoto} />
        ) : (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        )}
        <View>
          <Text style={styles.name}>{realName || loginName || 'User'}</Text>
          <Text style={styles.role}>{tr('CMMS user')}</Text>
        </View>
      </View>

      <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />

      <Pressable style={styles.secHead} onPress={() => toggleSec('status')} accessibilityRole="button">
        <Text style={styles.secHeadText}>{tr('SYSTEM STATUS')}</Text>
        <Text style={styles.secToggle}>{openSec.status ? '−' : '+'}</Text>
      </Pressable>
      {openSec.status ? (
        <>
      <View style={styles.card}>
        <Row colors={colors} label={tr('Product')} value={`medMETRIC CMMS version ${APP_VERSION}`} />
        <Row colors={colors} label={tr('Developer')} value="medMETRIC Lab" />
        <Row
          colors={colors}
          label={tr('Server')}
          value={config.baseUrl.replace(/^https?:\/\//, '')}
        />
        <Pressable onPress={runHealth}>
          <Row
            colors={colors}
            label={tr('Connection (tap to test)')}
            value={
              health.state === 'checking'
                ? 'Checking…'
                : health.state === 'ok'
                  ? `Connected · ${health.ms} ms`
                  : health.error || 'Not connected'
            }
            ok={health.state === 'ok'}
          />
        </Pressable>
        <Pressable onPress={runStockCheck}>
          <Row
            colors={colors}
            label={tr('Stock plugin (tap to test)')}
            value={
              stockHealth.state === 'idle'
                ? tr('Tap to test')
                : stockHealth.state === 'checking'
                  ? tr('Checking…')
                  : stockHealth.text || ''
            }
            ok={stockHealth.state === 'ok'}
          />
        </Pressable>
      </View>
        </>
      ) : null}

      <Pressable style={styles.secHead} onPress={() => toggleSec('appearance')} accessibilityRole="button">
        <Text style={styles.secHeadText}>{tr('APPEARANCE')}</Text>
        <Text style={styles.secToggle}>{openSec.appearance ? '−' : '+'}</Text>
      </Pressable>
      {openSec.appearance ? (
        <>
      <View style={styles.card}>
        <Pressable style={styles.themeHeader} onPress={() => setThemeOpen((o) => !o)}>
          <View style={styles.swatches}>
            <View style={[styles.swatch, { backgroundColor: THEME_PRESETS[themeId].colors.bg }]} />
            <View style={[styles.swatch, { backgroundColor: THEME_PRESETS[themeId].colors.accent }]} />
            <View style={[styles.swatch, { backgroundColor: THEME_PRESETS[themeId].colors.primary }]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.prefHint}>{tr('Theme')}</Text>
            <Text style={styles.themeLabel}>{THEME_PRESETS[themeId].label}</Text>
          </View>
          <Text style={styles.chevron}>{themeOpen ? '▲' : '▼'}</Text>
        </Pressable>
        {themeOpen
          ? (Object.keys(THEME_PRESETS) as ThemeId[]).map((id) => {
              const preset = THEME_PRESETS[id];
              const active = themeId === id;
              return (
                <Pressable
                  key={id}
                  style={[styles.themeRow, active && { borderColor: colors.accent }]}
                  onPress={() => {
                    setThemeId(id);
                    setThemeOpen(false);
                  }}
                >
                  <View style={styles.swatches}>
                    <View style={[styles.swatch, { backgroundColor: preset.colors.bg }]} />
                    <View style={[styles.swatch, { backgroundColor: preset.colors.bgCard }]} />
                    <View style={[styles.swatch, { backgroundColor: preset.colors.accent }]} />
                    <View style={[styles.swatch, { backgroundColor: preset.colors.primary }]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.themeLabel}>{preset.label}</Text>
                    <Text style={styles.themeDesc}>{preset.description}</Text>
                  </View>
                  {active ? <Text style={styles.activeMark}>✓</Text> : null}
                </Pressable>
              );
            })
          : null}
      </View>
        </>
      ) : null}

      <Pressable style={styles.secHead} onPress={() => toggleSec('language')} accessibilityRole="button">
        <Text style={styles.secHeadText}>{tr('LANGUAGE')}</Text>
        <Text style={styles.secToggle}>{openSec.language ? '−' : '+'}</Text>
      </Pressable>
      {openSec.language ? (
        <>
      <View style={styles.card}>
        <LanguageDropdown />
      </View>
        </>
      ) : null}

      <Pressable style={styles.secHead} onPress={() => toggleSec('account')} accessibilityRole="button">
        <Text style={styles.secHeadText}>{tr('ACCOUNT')}</Text>
        <Text style={styles.secToggle}>{openSec.account ? '−' : '+'}</Text>
      </Pressable>
      {openSec.account ? (
        <>
      <View style={styles.card}>
        <Text style={{ color: colors.textMuted, fontSize: 12, padding: 14, paddingBottom: 4 }}>
          Change password (saved on the CMMS server)
        </Text>
        {!showPw ? (
          <Pressable
            style={{ padding: 14 }}
            onPress={() => setShowPw(true)}
          >
            <Text style={{ color: colors.accent, fontWeight: '700' }}>{tr('Update password →')}</Text>
          </Pressable>
        ) : (
          <View style={{ padding: 14, gap: 8 }}>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                padding: 12,
                color: colors.text,
                backgroundColor: colors.bg,
              }}
              placeholder={tr('New password')}
              placeholderTextColor={colors.textDim}
              secureTextEntry
              value={pw1}
              onChangeText={setPw1}
            />
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                padding: 12,
                color: colors.text,
                backgroundColor: colors.bg,
              }}
              placeholder={tr('Confirm new password')}
              placeholderTextColor={colors.textDim}
              secureTextEntry
              value={pw2}
              onChangeText={setPw2}
            />
            <Pressable
              style={{
                backgroundColor: colors.accent,
                padding: 12,
                borderRadius: 10,
                alignItems: 'center',
                opacity: pwBusy ? 0.6 : 1,
              }}
              disabled={pwBusy}
              onPress={async () => {
                if (!pw1 || pw1.length < 6) {
                  Alert.alert('Password', tr('Use at least 6 characters.'));
                  return;
                }
                if (pw1 !== pw2) {
                  Alert.alert('Password', tr('Passwords do not match.'));
                  return;
                }
                if (!client || !userId) {
                  Alert.alert(tr('Error'), tr('Not logged in.'));
                  return;
                }
                setPwBusy(true);
                try {
                  await client.changePassword(userId, pw1);
                  Alert.alert(tr('Done'), tr('Password updated on the server.'));
                  setPw1('');
                  setPw2('');
                  setShowPw(false);
                } catch (e: unknown) {
                  Alert.alert(
                    'Could not change password',
                    e instanceof Error ? e.message : 'Check profile rights (update own password).'
                  );
                } finally {
                  setPwBusy(false);
                }
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>
                {pwBusy ? 'Saving…' : 'Save password'}
              </Text>
            </Pressable>
            <Text style={{ color: colors.textDim, fontSize: 11 }}>
              Profile photo is managed in the CMMS web portal (Users → your account → Picture).
            </Text>
          </View>
        )}
      </View>
        </>
      ) : null}

      <Pressable style={styles.secHead} onPress={() => toggleSec('notifications')} accessibilityRole="button">
        <Text style={styles.secHeadText}>{tr('NOTIFICATIONS')}</Text>
        <Text style={styles.secToggle}>{openSec.notifications ? '−' : '+'}</Text>
      </Pressable>
      {openSec.notifications ? (
        <>
      <View style={styles.card}>
        <Pressable
          onPress={async () => {
            if (notifStatus === 'granted') {
              Linking.openSettings();
              return;
            }
            const ok = await requestNotificationPermission();
            setNotifStatus(ok ? 'granted' : await getNotificationPermissionStatus());
            if (!ok) Linking.openSettings();
          }}
        >
          <Row
            colors={colors}
            label={tr('Status')}
            value={
              notifStatus === 'granted'
                ? 'Enabled'
                : notifStatus === 'denied'
                  ? 'Blocked'
                  : 'Off — tap to enable'
            }
            ok={notifStatus === 'granted'}
          />
        </Pressable>
      </View>
        </>
      ) : null}

      <Pressable style={styles.secHead} onPress={() => toggleSec('sync')} accessibilityRole="button">
        <Text style={styles.secHeadText}>{tr('SYNC & DATA')}</Text>
        <Text style={styles.secToggle}>{openSec.sync ? '−' : '+'}</Text>
      </Pressable>
      {openSec.sync ? (
        <>
      <View style={styles.card}>
        <View style={styles.prefRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.prefTitle}>{tr('Auto-refresh ticket list')}</Text>
            <Text style={styles.prefHint}>{tr('Updates while the Tickets screen is open')}</Text>
          </View>
          <Switch
            value={prefs.autoRefresh}
            onValueChange={(v) => void setPrefs({ autoRefresh: v })}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>
        {prefs.autoRefresh ? (
          <Seg
            colors={colors}
            label={tr('Refresh every')}
            options={[1, 2, 5, 10].map((m) => ({ v: m, t: `${m} min` }))}
            value={prefs.refreshMinutes}
            onChange={(v) => void setPrefs({ refreshMinutes: v as number })}
          />
        ) : null}
        <Seg
          colors={colors}
          label={tr('Tickets per page')}
          options={[25, 50, 100].map((n) => ({ v: n, t: String(n) }))}
          value={prefs.pageSize}
          onChange={(v) => void setPrefs({ pageSize: v as 25 | 50 | 100 })}
        />
        <Seg
          colors={colors}
          label={tr('Photo upload quality')}
          options={[
            { v: 'low', t: 'Low (fast)' },
            { v: 'medium', t: 'Medium' },
            { v: 'high', t: 'High' },
          ]}
          value={prefs.uploadQuality}
          onChange={(v) => void setPrefs({ uploadQuality: v as UploadQuality })}
        />
        <Pressable
          onPress={async () => {
            if (!client) return;
            const r = await flushQueue(client, userId);
            setQueued(r.left);
            Alert.alert(
              'Offline notes',
              r.sent + r.failed === 0 && r.left === 0
                ? 'Nothing waiting to be sent.'
                : `Sent ${r.sent}${r.failed ? `, rejected ${r.failed}` : ''}${r.left ? `, still waiting ${r.left}` : ''}.`
            );
          }}
        >
          <Row colors={colors} label={tr('Notes waiting to send')} value={queued ? `${queued} — tap to send now` : 'None'} />
        </Pressable>
        {queued ? (
          <Pressable
            onPress={() =>
              Alert.alert(tr('Discard waiting notes?'), tr('They have not been sent to the server.'), [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Discard',
                  style: 'destructive',
                  onPress: async () => {
                    await clearQueue();
                    setQueued(0);
                  },
                },
              ])
            }
          >
            <Text style={styles.linkDanger}>{tr('Discard waiting notes')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            cache.clear();
            Alert.alert(tr('Cache cleared'), tr('Tickets and assets will be downloaded again.'));
          }}
        >
          <Text style={styles.link}>Clear offline cache ({cache.stats().entries} items)</Text>
        </Pressable>
      </View>
        </>
      ) : null}

      <Pressable style={styles.secHead} onPress={() => toggleSec('diagnostics')} accessibilityRole="button">
        <Text style={styles.secHeadText}>{tr('DIAGNOSTICS')}</Text>
        <Text style={styles.secToggle}>{openSec.diagnostics ? '−' : '+'}</Text>
      </Pressable>
      {openSec.diagnostics ? (
        <>
      <View style={styles.card}>
        <Pressable
          onPress={async () => {
            if (!client) return;
            try {
              const r = await client.getMyRights();
              const bits = (n: number) =>
                [n & 1 ? 'read' : '', n & 2 ? 'update' : '', n & 4 ? 'create' : '', n & 8 ? 'delete' : '']
                  .filter(Boolean)
                  .join(', ') || 'none';
              const lines = Object.entries(r.rights).slice(0, 40).map(([k, v]) => `${k}: ${bits(v)} (${v})`);
              Alert.alert(
                `Profile: ${r.profile || 'unknown'}`,
                (lines.join('\n') || 'No rights returned by the server.') +
                  '\n\nSend this to your GLPI admin if an action says "permission".'
              );
            } catch (e: unknown) {
              Alert.alert('Rights', e instanceof Error ? e.message : 'Could not read rights');
            }
          }}
        >
          <Row colors={colors} label={tr('My access rights')} value="View →" />
        </Pressable>
        <Pressable
          onPress={async () => {
            try {
              const text = diag.dump([
                `medMETRIC CMMS ${APP_VERSION}`,
                `Server: ${config.baseUrl.replace(/^https?:\/\//, '')}`,
                `User id: ${userId ?? '-'}`,
                `Exported: ${new Date().toISOString()}`,
              ]);
              const uri = (FileSystem.cacheDirectory || '') + 'medmetric-diagnostics.txt';
              await FileSystem.writeAsStringAsync(uri, text);
              if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(uri, { mimeType: 'text/plain', dialogTitle: 'Diagnostics' });
              } else {
                Alert.alert('Diagnostics', text.slice(0, 1200));
              }
            } catch (e: unknown) {
              Alert.alert('Diagnostics', e instanceof Error ? e.message : 'Could not export');
            }
          }}
        >
          <Row colors={colors} label={tr('Export request log')} value="Share →" />
        </Pressable>
        <Text style={styles.prefHint2}>
          The log lists the last API calls (time, status, server message). It never contains passwords or tokens.
        </Text>
      </View>
        </>
      ) : null}

      <Pressable style={styles.secHead} onPress={() => toggleSec('organization')} accessibilityRole="button">
        <Text style={styles.secHeadText}>{tr('ORGANIZATION')}</Text>
        <Text style={styles.secToggle}>{openSec.organization ? '−' : '+'}</Text>
      </Pressable>
      {openSec.organization ? (
        <>
      <View style={styles.card}>
        <Row colors={colors} label={tr('Company')} value="MedMetric Healthcare PLC" />
      </View>
        </>
      ) : null}


      <Pressable style={styles.btn} onPress={logout}>
        <Text style={styles.btnText}>{tr('Sign out')}</Text>
      </Pressable>

      <Pressable
        style={[styles.btn, { backgroundColor: colors.bgCard, marginTop: 10, borderWidth: 1, borderColor: colors.border }]}
        onPress={async () => {
          await clearServerConfig();
          router.replace('/(auth)/setup');
        }}
      >
        <Text style={[styles.btnText, { color: colors.textMuted }]}>{tr('Change server (reset)')}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Seg({
  label,
  options,
  value,
  onChange,
  colors,
}: {
  label: string;
  options: { v: string | number; t: string }[];
  value: string | number;
  onChange: (v: string | number) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 8 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {options.map((o) => {
          const on = o.v === value;
          return (
            <Pressable
              key={String(o.v)}
              onPress={() => onChange(o.v)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: on ? colors.accent : colors.border,
                backgroundColor: on ? colors.accent + '22' : 'transparent',
              }}
            >
              <Text style={{ color: on ? colors.accent : colors.text, fontWeight: '600', fontSize: 13 }}>{o.t}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Row({
  label,
  value,
  ok,
  colors,
}: {
  label: string;
  value: string;
  ok?: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: 12,
      }}
    >
      <Text style={{ color: colors.textMuted, fontSize: 13 }}>{label}</Text>
      <Text
        style={{
          color: ok ? colors.success : colors.text,
          fontSize: 13,
          fontWeight: '600',
          flexShrink: 1,
          textAlign: 'right',
        }}
        numberOfLines={3}
      >
        {ok ? '● ' : ''}
        {value}
      </Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg, padding: 16 },
    hTitle: { color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: 16 },
    profileCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    avatar: {
      width: 52,
      height: 52,
      borderRadius: 14,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.chipOnText, fontWeight: '800', fontSize: 18 },
    avatarPhoto: { width: 52, height: 52, borderRadius: 14 },
    name: { color: colors.text, fontWeight: '700', fontSize: 18 },
    role: { color: colors.accent, marginTop: 2, fontWeight: '600' },
    logo: { width: '100%', height: 72, marginBottom: 16 },
    secHead: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 10, marginTop: 4,
    },
    secHeadText: { color: colors.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
    secToggle: {
      color: colors.accent, fontSize: 22, fontWeight: '700', width: 32, textAlign: 'center', lineHeight: 24,
    },
    section: {
      color: colors.textDim,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.8,
      marginBottom: 8,
      marginTop: 8,
    },
    card: {
      backgroundColor: colors.bgCard,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
      overflow: 'hidden',
    },
    themeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    themeHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
    chevron: { color: colors.textMuted, fontSize: 12 },
    swatches: { flexDirection: 'row', gap: 4 },
    swatch: { width: 16, height: 28, borderRadius: 4 },
    themeLabel: { color: colors.text, fontWeight: '700', fontSize: 14 },
    themeDesc: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    activeMark: { color: colors.accent, fontWeight: '800', fontSize: 18 },
    btn: {
      marginTop: 20,
      backgroundColor: '#3F1D1D',
      padding: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    btnText: { color: colors.danger, fontWeight: '700' },
    prefRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    prefTitle: { color: colors.text, fontWeight: '600', fontSize: 14 },
    prefHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    prefHint2: { color: colors.textDim, fontSize: 11, padding: 14 },
    link: { color: colors.accent, fontWeight: '700', padding: 14 },
    linkDanger: { color: colors.danger, fontWeight: '700', padding: 14, paddingTop: 0 },
  });
}
