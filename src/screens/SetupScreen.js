import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import { COLORS, FONTS } from '../config/theme';
import { registerDevice } from '../services/pos';

export default function SetupScreen({ navigation }) {
  const [deviceName, setDeviceName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkExisting();
  }, []);

  const checkExisting = async () => {
    const token = await SecureStore.getItemAsync('device_token');
    const name = await SecureStore.getItemAsync('device_name');
    if (token && name) {
      navigation.replace('Terminal');
      return;
    }
    const defaultName = Device.modelName
      ? `${Device.modelName}`
      : 'Front Desk Device';
    setDeviceName(defaultName);
    setChecking(false);
  };

  const generateToken = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'dev_';
    for (let i = 0; i < 16; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
  };

  const handleRegister = async () => {
    if (!deviceName.trim()) {
      setError('Please enter a device name.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const token = generateToken();
      const hardwareInfo = {
        device_model: Device.modelName || Device.deviceName || 'Unknown',
        device_os: `${Device.osName || 'Unknown'} ${Device.osVersion || ''}`.trim(),
        device_hardware_id: Device.osBuildId || Device.osInternalBuildId || null,
      };
      await registerDevice(deviceName.trim(), token, null, hardwareInfo);
      await SecureStore.setItemAsync('device_token', token);
      await SecureStore.setItemAsync('device_name', deviceName.trim());
      navigation.replace('Terminal');
    } catch (e) {
      setError(e.response?.data?.error || 'Registration failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <View style={s.header}>
          <View style={s.stepBadge}>
            <Text style={s.stepText}>SETUP</Text>
          </View>
          <Text style={s.title}>Register This Device</Text>
          <Text style={s.desc}>
            Name this device so the front desk can send payment orders to it. This only needs to be done once.
          </Text>
        </View>

        {!!error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Text style={s.label}>Device Name</Text>
        <TextInput
          style={s.input}
          value={deviceName}
          onChangeText={setDeviceName}
          placeholder="e.g. Front Desk iPhone 15"
          placeholderTextColor={COLORS.textMuted}
        />
        <Text style={s.hint}>
          This name will appear in the "Send to Device" dropdown on the PC dashboard.
        </Text>

        <TouchableOpacity style={s.btn} onPress={handleRegister} disabled={loading} activeOpacity={0.8}>
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={s.btnText}>Register & Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  header: { marginBottom: 32 },
  stepBadge: {
    backgroundColor: COLORS.primary + '15', paddingHorizontal: 12,
    paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start', marginBottom: 12,
  },
  stepText: { ...FONTS.bold, fontSize: 11, color: COLORS.primary, letterSpacing: 1 },
  title: { ...FONTS.heading, fontSize: 24, marginBottom: 8 },
  desc: { ...FONTS.regular, color: COLORS.textSecondary, lineHeight: 22 },
  label: { ...FONTS.bold, fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: COLORS.text,
  },
  hint: { ...FONTS.caption, marginTop: 6, marginBottom: 20 },
  btn: {
    backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginTop: 8,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  btnText: { ...FONTS.bold, color: COLORS.white, fontSize: 16 },
  errorBox: { backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 12, marginBottom: 12 },
  errorText: { color: COLORS.danger, fontSize: 13, textAlign: 'center' },
});
