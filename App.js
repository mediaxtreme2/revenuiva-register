import React, { useState, useEffect, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StripeTerminalProvider } from '@stripe/stripe-terminal-react-native';
import { isAuthenticated } from './src/services/auth';
import { isActivated } from './src/services/activation';
import { loadBrand, getBrand } from './src/services/brand';
import { getConnectionToken } from './src/services/pos';
import ActivationScreen from './src/screens/ActivationScreen';
import LoginScreen from './src/screens/LoginScreen';
import SetupScreen from './src/screens/SetupScreen';
import TerminalScreen from './src/screens/TerminalScreen';

const Stack = createNativeStackNavigator();

function AppContent() {
  const [initialRoute, setInitialRoute] = useState(null);
  const [accent, setAccent] = useState('#2563eb');

  useEffect(() => {
    boot();
  }, []);

  const boot = async () => {
    await loadBrand();
    setAccent(getBrand().primaryColor || '#2563eb');
    // Device must be paired to a practice before anything else.
    if (!(await isActivated())) {
      setInitialRoute('Activation');
      return;
    }
    const authed = await isAuthenticated();
    setInitialRoute(authed ? 'Setup' : 'Login');
  };

  if (!initialRoute) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' }}>
        <ActivityIndicator size="large" color={accent} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false, animation: 'fade' }}
      >
        <Stack.Screen name="Activation" component={ActivationScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Setup" component={SetupScreen} />
        <Stack.Screen name="Terminal" component={TerminalScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const fetchToken = useCallback(async () => {
    try {
      const secret = await getConnectionToken();
      return secret;
    } catch (e) {
      console.warn('Connection token fetch failed:', e.message);
      throw e;
    }
  }, []);

  return (
    <StripeTerminalProvider
      logLevel="verbose"
      tokenProvider={fetchToken}
    >
      <AppContent />
    </StripeTerminalProvider>
  );
}
