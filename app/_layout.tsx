import { tr } from '../src/i18n';
import 'react-native-gesture-handler';
import React, { Component, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/context/AuthContext';
import { ThemeProvider } from '../src/context/ThemeContext';
import { useEffect } from 'react';
import { usePrefs } from '../src/preferences';
import { loadAppFonts } from '../src/fonts';

/** Visible crash screen — never leave a blank white page. */
export function ErrorBoundary({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <View style={eb.root}>
      <Text style={eb.title}>medMETRIC CMMS</Text>
      <Text style={eb.msg}>{error?.message || 'Something went wrong'}</Text>
      <Pressable style={eb.btn} onPress={retry}>
        <Text style={eb.btnText}>{tr('Try again')}</Text>
      </Pressable>
    </View>
  );
}

const eb = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B3D4A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  msg: { color: '#B0D4D8', textAlign: 'center', marginBottom: 20 },
  btn: {
    backgroundColor: '#5EC8C0',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnText: { color: '#0B3D4A', fontWeight: '700' },
});

class SafeNotifications extends Component<{ children?: ReactNode }, { on: boolean }> {
  state = { on: false };
  componentDidMount() {
    // Defer so first paint always happens
    setTimeout(() => this.setState({ on: true }), 800);
  }
  render() {
    if (!this.state.on) return null;
    try {
      const { NotificationBootstrap } = require('../src/NotificationBootstrap');
      return <NotificationBootstrap />;
    } catch {
      return null;
    }
  }
}

export default function RootLayout() {
  useEffect(() => {
    void loadAppFonts();
  }, []);
  const { language } = usePrefs(); // changing language remounts the screens so every label updates
  return (
    <ThemeProvider>
      <AuthProvider>
        <SafeNotifications />
        <StatusBar style="light" />
        <Stack
          key={language}
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0B3D4A' },
          }}
        />
      </AuthProvider>
    </ThemeProvider>
  );
}
