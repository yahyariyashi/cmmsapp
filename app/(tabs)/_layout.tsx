import { tr } from '../../src/i18n';
import { Tabs, Redirect } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { AppIcon } from '../../src/components/AppIcon';

export default function TabsLayout() {
  const { isAuthenticated, loading } = useAuth();
  const { colors } = useTheme();
  if (!loading && !isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: colors.text,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: {
          backgroundColor: colors.header,
          borderTopColor: colors.border,
          height: 58,
          paddingBottom: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: tr('Dashboard'),
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <AppIcon size={size ?? 22} color={color} fallback="▦" />
          ),
        }}
      />
      <Tabs.Screen
        name="tickets"
        options={{
          title: tr('Tickets'),
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <AppIcon size={size ?? 22} color={color} fallback="☰" />
          ),
        }}
      />
      <Tabs.Screen
        name="equipment"
        options={{
          title: tr('Equipment'),
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <AppIcon size={size ?? 22} color={color} fallback="⚙" />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: tr('Profile'),
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <AppIcon size={size ?? 22} color={color} fallback="●" />
          ),
        }}
      />
    </Tabs>
  );
}
