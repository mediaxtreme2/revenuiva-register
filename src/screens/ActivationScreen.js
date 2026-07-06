import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { COLORS, FONTS } from '../config/theme';
import { activate } from '../services/activation';

/**
 * First-launch screen. The single master binary asks for a 6-digit
 * Device Sync PIN (generated in the practice dashboard), then pairs the
 * device and skins itself for that practice.
 */
export default function ActivationScreen({ navigation }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputs = useRef([]);

  const pin = digits.join('');

  const onChange = (val, i) => {
    const clean = val.replace(/[^0-9]/g, '');
    const next = [...digits];
    if (clean.length > 1) {
      // handle paste
      clean.split('').slice(0, 6).forEach((c, k) => { if (i + k < 6) next[i + k] = c; });
      setDigits(next);
      const last = Math.min(i + clean.length, 5);
      inputs.current[last]?.focus();
      return;
    }
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) inputs.current[i + 1]?.focus();
  };

  const onKey = (e, i) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  };

  const handleActivate = async () => {
    if (pin.length !== 6) {
      setError('Enter the 6-digit Device Sync PIN.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await activate(pin);
      navigation.replace('Login');
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'Activation failed. Check the PIN and try again.';
      setError(msg);
      setDigits(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.container}>
        <View style={s.logoBox}>
          <Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" />
          <Text style={s.title}>Activate this device</Text>
          <Text style={s.subtitle}>Enter the 6-digit Device Sync PIN from your practice dashboard.</Text>
        </View>

        {!!error && (
          <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
        )}

        <View style={s.pinRow}>
          {digits.map((d, i) => (
            <TextInput
              key={i}
              ref={(el) => (inputs.current[i] = el)}
              style={[s.pinBox, d ? s.pinBoxFilled : null]}
              value={d}
              onChangeText={(v) => onChange(v, i)}
              onKeyPress={(e) => onKey(e, i)}
              keyboardType="number-pad"
              maxLength={6}
              textAlign="center"
              returnKeyType="done"
            />
          ))}
        </View>

        <TouchableOpacity
          style={[s.btn, (loading || pin.length !== 6) && s.btnDisabled]}
          onPress={handleActivate}
          disabled={loading || pin.length !== 6}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Activate</Text>}
        </TouchableOpacity>

        <Text style={s.hint}>Ask your manager to generate a PIN in Dashboard → App Deployment.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logoBox: { alignItems: 'center', marginBottom: 36 },
  logo: { width: 84, height: 84, marginBottom: 16 },
  title: { ...FONTS.heading, marginTop: 4 },
  subtitle: { ...FONTS.regular, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  pinRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
  pinBox: {
    width: 46, height: 58, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: COLORS.card, fontSize: 24, fontWeight: '700', color: COLORS.text,
  },
  pinBoxFilled: { borderColor: COLORS.primary },
  btn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { ...FONTS.caption, textAlign: 'center', marginTop: 20 },
  errorBox: { backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 12, marginBottom: 18 },
  errorText: { color: COLORS.danger, fontSize: 13, textAlign: 'center' },
});
