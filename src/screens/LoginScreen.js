import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { COLORS, FONTS } from '../config/theme';
import { login } from '../services/auth';
import { getBrand } from '../services/brand';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const brand = getBrand();
  const accent = brand.primaryColor || COLORS.primary;

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(email.trim(), password);
      navigation.replace('Setup');
    } catch (e) {
      const msg = e.response?.data?.message || e.response?.data?.error || 'Login failed. Check credentials.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.container}>
        <View style={s.logoBox}>
          <Image
            source={brand.logoUrl ? { uri: brand.logoUrl } : require('../../assets/logo.png')}
            style={s.logoImage}
            resizeMode="contain"
          />
          <Text style={[s.title, { color: accent }]}>{brand.practiceName || 'RevenuivaAI'}</Text>
          <Text style={s.subtitle}>Register Terminal</Text>
        </View>

        <View style={s.form}>
          {!!error && (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="staff@clinic.com"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={s.label}>Password</Text>
          <View style={s.passwordWrap}>
            <TextInput
              style={s.passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity
              style={s.eyeBtn}
              onPress={() => setShowPassword(!showPassword)}
              activeOpacity={0.6}
            >
              <Text style={s.eyeIcon}>{showPassword ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[s.btn, { backgroundColor: accent, shadowColor: accent }]} onPress={handleLogin} disabled={loading} activeOpacity={0.8}>
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={s.btnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <Text style={s.footerText}>
            Sign in with your RevenuivaAI dashboard credentials
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logoBox: { alignItems: 'center', marginBottom: 40 },
  logoImage: {
    width: 80, height: 80, borderRadius: 18, marginBottom: 16,
  },
  title: { ...FONTS.heading, fontSize: 26 },
  subtitle: { ...FONTS.caption, fontSize: 14, marginTop: 4 },
  form: { gap: 4 },
  label: { ...FONTS.bold, fontSize: 13, marginBottom: 4, marginTop: 12 },
  input: {
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: COLORS.text,
  },
  passwordWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 12, overflow: 'hidden',
  },
  passwordInput: {
    flex: 1, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: COLORS.text,
  },
  eyeBtn: {
    paddingHorizontal: 14, paddingVertical: 14, justifyContent: 'center', alignItems: 'center',
  },
  eyeIcon: { fontSize: 18 },
  btn: {
    backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginTop: 20,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  btnText: { ...FONTS.bold, color: COLORS.white, fontSize: 16 },
  errorBox: { backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 12, marginBottom: 8 },
  errorText: { color: COLORS.danger, fontSize: 13, textAlign: 'center' },
  footerText: { ...FONTS.caption, textAlign: 'center', marginTop: 16 },
});
