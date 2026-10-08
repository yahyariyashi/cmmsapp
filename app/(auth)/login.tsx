import { tr } from '../../src/i18n';
import { LanguageDropdown } from '../../src/components/LanguageDropdown';
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

/** Username + password only. Server URL/token set once on Setup screen. */
export default function LoginScreen() {
  const { signIn, serverConfigured, clearServerConfig } = useAuth();
  const { colors } = useTheme();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatApiError = (e: unknown): string => {
    if (e && typeof e === 'object' && 'response' in e) {
      const resp = (e as { response?: { data?: unknown; status?: number } }).response;
      const data = resp?.data;
      if (Array.isArray(data) && data.length >= 1) {
        const code = String(data[0]);
        const detail = data[1] != null ? String(data[1]) : '';
        if (code.includes('APP_TOKEN')) {
          return 'Server App-Token is invalid. Reset server setup from Profile or reinstall.';
        }
        if (code.includes('LOGIN') || code.includes('WRONG')) {
          return 'Incorrect username or password.';
        }
        return detail || code;
      }
      if (typeof data === 'string') return data;
      return `Server error (HTTP ${resp?.status ?? '?'})`;
    }
    if (e instanceof Error) return e.message;
    return 'Login failed. Check your connection.';
  };

  const onSubmit = async () => {
    setError(null);
    if (!serverConfigured) {
      router.replace('/(auth)/setup');
      return;
    }
    if (!login.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setBusy(true);
    try {
      await signIn(login.trim(), password);
      router.replace('/(tabs)/home');
    } catch (e: unknown) {
      setError(formatApiError(e));
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

        <Text style={styles.brand}>{tr('medMETRIC CMMS')}</Text>
        <Text style={styles.subtitle}>{tr('Clinical engineering · sign in')}</Text>

        <Text style={styles.label}>{tr('Username')}</Text>
        <TextInput
          style={styles.input}
          placeholder={tr('Username')}
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          value={login}
          onChangeText={setLogin}
          returnKeyType="next"
        />

        <Text style={styles.label}>{tr('Password')}</Text>
        <TextInput
          style={styles.input}
          placeholder={tr('Password')}
          placeholderTextColor={colors.textDim}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.btn, (!login || !password) && styles.btnDisabled]}
          onPress={onSubmit}
          disabled={busy || !login || !password}
        >
          {busy ? (
            <ActivityIndicator color={colors.chipOnText} />
          ) : (
            <Text style={styles.btnText}>{tr('Sign In')}</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.resetLink}
          onPress={async () => {
            await clearServerConfig();
            router.replace('/(auth)/setup');
          }}
        >
          <Text style={styles.resetText}>{tr('Change server / App-Token')}</Text>
        </Pressable>

        <View style={{ marginTop: 18 }}>
          <LanguageDropdown compact />
        </View>

        <Text style={styles.version}>medMETRIC CMMS v1.0.29 · medMETRIC Lab</Text>
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
      color: colors.textMuted,
      textAlign: 'center',
      marginBottom: 32,
      fontSize: 14,
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
      marginTop: 4,
      lineHeight: 20,
      fontSize: 13,
      backgroundColor: colors.bgCard,
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    resetLink: { alignItems: 'center', marginTop: 20 },
    resetText: { color: colors.textDim, fontSize: 13 },
    version: {
      color: colors.textDim,
      textAlign: 'center',
      fontSize: 11,
      marginTop: 24,
    },
  });
}
