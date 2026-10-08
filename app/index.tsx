import { Redirect } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '../src/context/AuthContext';

export default function Index() {
  const { loading, isAuthenticated, serverConfigured } = useAuth();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#0B3D4A',
        }}
      >
        <ActivityIndicator color="#5EC8C0" size="large" />
        <Text style={{ color: '#B0D4D8', marginTop: 12, fontWeight: '600' }}>
          medMETRIC CMMS
        </Text>
      </View>
    );
  }

  if (isAuthenticated) {
    return <Redirect href="/(tabs)/home" />;
  }
  if (!serverConfigured) {
    return <Redirect href="/(auth)/setup" />;
  }
  return <Redirect href="/(auth)/login" />;
}
