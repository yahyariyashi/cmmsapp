import { tr } from '../../src/i18n';
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';

/**
 * One-time server configuration (URL + App-Token).
 * Shown only when the app has never been configured on this device.
 */
export default function ServerSetupScreen() {
  const { saveServerConfig } = useAuth();
  const { colors } = useTheme();
  const [baseUrl, setBaseUrl] = useState('https://tech.medmetrichealthcare.com/public');
  const [appToken, setAppToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSave = async () => {
    setError(null);
    setBusy(true);
    try {
      await saveServerConfig(baseUrl, appToken);
      router.replace('/(auth)/login');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save server settings');
    } finally {
      setBusy(false);
    }
  };

  const styles = makeStyles(colors);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoWrap}>
          <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        </View>

        <Text style={styles.brand}>medMETRIC CMMS</Text>
        <Text style={styles.subtitle}>{tr('One-time server setup')}</Text>
        <Text style={styles.hint}>
          Enter your CMMS server address and App-Token once. After this, you only need username and
          password on each login.
        </Text>

        <Text style={styles.label}>{tr('Server URL')}</Text>
        <TextInput
          style={styles.input}
          placeholder="https://your-server.com/public"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={baseUrl}
          onChangeText={setBaseUrl}
        />

        <Text style={styles.label}>App-Token</Text>
        <TextInput
          style={styles.input}
          placeholder="From CMMS → Setup → General → API"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={appToken}
          onChangeText={setAppToken}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.btn, (!baseUrl || !appToken) && styles.btnDisabled]}
          onPress={onSave}
          disabled={busy || !baseUrl.trim() || !appToken.trim()}
        >
          {busy ? (
            <ActivityIndicator color={colors.chipOnText} />
          ) : (
            <Text style={styles.btnText}>{tr('Save & continue')}</Text>
          )}
        </Pressable>

        <Text style={styles.version}>medMETRIC CMMS v1.0.4 · medMETRIC Lab</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingVertical: 48 },
    logoWrap: { alignItems: 'center', marginBottom: 16 },
    logo: { width: 112, height: 112, borderRadius: 24 },
    brand: {
      color: colors.text,
      fontSize: 26,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: 4,
    },
    subtitle: {
      color: colors.accent,
      textAlign: 'center',
      marginBottom: 12,
      fontSize: 15,
      fontWeight: '600',
    },
    hint: {
      color: colors.textMuted,
      textAlign: 'center',
      marginBottom: 28,
      fontSize: 13,
      lineHeight: 20,
    },
    label: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 6,
      marginTop: 4,
    },
    input: {
      backgroundColor: colors.bgCard,
      borderRadius: 10,
      padding: 14,
      color: colors.text,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
      fontSize: 15,
    },
    btn: {
      backgroundColor: colors.accent,
      padding: 16,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 8,
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: colors.chipOnText, fontWeight: '700', fontSize: 16 },
    error: {
      color: colors.danger,
      marginBottom: 8,
      backgroundColor: colors.bgCard,
      padding: 10,
      borderRadius: 8,
      fontSize: 13,
      borderWidth: 1,
      borderColor: colors.border,
    },
    version: {
      color: colors.textDim,
      textAlign: 'center',
      fontSize: 11,
      marginTop: 32,
    },
  });
}
