import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ActivityIndicator, ScrollView, Alert, AppState, Animated, Platform,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { useStripeTerminal } from '@stripe/stripe-terminal-react-native';
import { COLORS, FONTS } from '../config/theme';
import { heartbeat, collectOrder, confirmPayment, markCash, getConnectionToken } from '../services/pos';
import { logout } from '../services/auth';

const POLL_INTERVAL = 3000;

export default function TerminalScreen({ navigation }) {
  const [deviceName, setDeviceName] = useState('');
  const [connected, setConnected] = useState(false);
  const [orders, setOrders] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | collecting | tapping | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [paymentData, setPaymentData] = useState(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const pollRef = useRef(null);
  const appState = useRef(AppState.currentState);
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const successScale = useRef(new Animated.Value(0)).current;

  const {
    discoverReaders,
    connectLocalMobileReader,
    collectPaymentMethod,
    confirmPaymentIntent,
    initialize: initTerminal,
  } = useStripeTerminal({
    onDidChangeConnectionStatus: (status) => {
      setTerminalReady(status === 'connected');
    },
  });

  useEffect(() => {
    init();
    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (phase === 'tapping') startPulse();
    else pulseAnim.setValue(0.4);
  }, [phase]);

  useEffect(() => {
    if (phase === 'success') {
      Animated.spring(successScale, {
        toValue: 1, friction: 4, tension: 60, useNativeDriver: true,
      }).start();
      const t = setTimeout(() => {
        successScale.setValue(0);
        setPhase('idle');
        setActiveOrder(null);
        setPaymentData(null);
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  };

  const handleAppState = (nextState) => {
    if (appState.current.match(/inactive|background/) && nextState === 'active') {
      pollNow();
    }
    appState.current = nextState;
  };

  const init = async () => {
    const name = await SecureStore.getItemAsync('device_name');
    setDeviceName(name || 'Device');
    try {
      await initTerminal();
      await connectTerminalReader();
    } catch (e) {
      console.warn('Terminal init skipped:', e.message);
    }
    startPolling();
  };

  const startPolling = () => {
    pollNow();
    pollRef.current = setInterval(pollNow, POLL_INTERVAL);
  };

  const pollNow = async () => {
    try {
      const token = await SecureStore.getItemAsync('device_token');
      if (!token) return;
      const data = await heartbeat(token);
      setConnected(true);
      const incoming = data.orders || [];
      setOrders(incoming);
      if (incoming.length > 0 && phase === 'idle' && !activeOrder) {
        handleIncomingOrder(incoming[0]);
      }
    } catch (e) {
      setConnected(false);
    }
  };

  const handleIncomingOrder = (order) => {
    setActiveOrder(order);
    setPhase('collecting');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };

  const handleCollectPayment = async () => {
    if (!activeOrder) return;
    setPhase('tapping');
    setErrorMsg('');
    try {
      const data = await collectOrder(activeOrder.id);
      setPaymentData(data);
      // PaymentIntent is created with card_present
      // Now we wait - the Stripe Terminal SDK will handle NFC
      // For now, we initiate the terminal collection
      await initiateTerminalCollection(data);
    } catch (e) {
      setErrorMsg(e.response?.data?.error || 'Failed to initialize payment.');
      setPhase('error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const connectTerminalReader = async () => {
    try {
      console.log('[Terminal] Discovering localMobile readers...');
      const { readers, error: discoverError } = await discoverReaders({
        discoveryMethod: 'localMobile',
        simulated: false,
      });
      if (discoverError) {
        console.warn('[Terminal] Discovery error:', discoverError.message);
        setErrorMsg('Reader discovery failed: ' + discoverError.message);
        return false;
      }
      console.log('[Terminal] Found readers:', readers?.length || 0);
      if (readers && readers.length > 0) {
        console.log('[Terminal] Connecting to reader:', readers[0].serialNumber);
        const { reader, error: connectError } = await connectLocalMobileReader({
          reader: readers[0],
          locationId: 'tml_Gj59ACoEe3BBd0',
        });
        if (connectError) {
          console.warn('[Terminal] Connect error:', connectError.message);
          setErrorMsg('Reader connect failed: ' + connectError.message);
          return false;
        }
        if (reader) {
          console.log('[Terminal] Connected successfully');
          setTerminalReady(true);
          return true;
        }
      }
      setErrorMsg('No NFC reader found. Ensure Google Play Services is active and device has a lock screen enabled.');
      return false;
    } catch (e) {
      console.warn('[Terminal] Reader connect exception:', e.message);
      setErrorMsg('Terminal error: ' + e.message);
      return false;
    }
  };

  const initiateTerminalCollection = async (data) => {
    try {
      if (!terminalReady) {
        const ok = await connectTerminalReader();
        if (!ok) {
          setPhase('error');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          return;
        }
      }
      console.log('[Terminal] Collecting payment, client_secret:', data.client_secret?.substring(0, 20) + '...');
      const { paymentIntent, error } = await collectPaymentMethod({ paymentIntent: data.client_secret });
      if (error) {
        console.warn('[Terminal] Collect error:', error.message, error.code);
        setErrorMsg(error.message || 'Card collection failed.');
        setPhase('error');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      console.log('[Terminal] Card collected, confirming...');
      const { paymentIntent: confirmed, error: confirmError } = await confirmPaymentIntent({ paymentIntent: paymentIntent.id });
      if (confirmError) {
        console.warn('[Terminal] Confirm error:', confirmError.message);
        setErrorMsg(confirmError.message || 'Payment confirmation failed.');
        setPhase('error');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      console.log('[Terminal] Payment confirmed!');
      await confirmPayment(activeOrder.id, confirmed.id, 'tap_to_pay');
      setPhase('success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[Terminal] Collection exception:', e.message);
      setErrorMsg('Payment failed: ' + e.message);
      setPhase('error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const statusPollRef = useRef(null);

  const startPaymentStatusPolling = () => {
    if (statusPollRef.current) clearInterval(statusPollRef.current);
    statusPollRef.current = setInterval(async () => {
      if (!activeOrder) return;
      try {
        const token = await SecureStore.getItemAsync('device_token');
        const data = await heartbeat(token);
        const updated = (data.orders || []).find(o => o.id === activeOrder.id);
        if (!updated) {
          // Order no longer pending = payment completed
          clearInterval(statusPollRef.current);
          setPhase('success');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch (e) {}
    }, 2000);
  };

  const handleConfirmManual = async () => {
    if (!activeOrder) return;
    try {
      await confirmPayment(activeOrder.id, paymentData?.payment_intent_id);
      setPhase('success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (statusPollRef.current) clearInterval(statusPollRef.current);
    } catch (e) {
      setErrorMsg('Failed to confirm payment.');
    }
  };

  const handleCashPayment = async () => {
    if (!activeOrder) return;
    Alert.alert(
      'Cash Payment',
      `Confirm cash payment of $${Number(activeOrder.total_amount).toFixed(2)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Cash',
          onPress: async () => {
            try {
              await markCash(activeOrder.id);
              setPhase('success');
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              if (statusPollRef.current) clearInterval(statusPollRef.current);
            } catch (e) {
              setErrorMsg('Failed to process cash payment.');
              setPhase('error');
            }
          },
        },
      ]
    );
  };

  const handleDismiss = () => {
    setActiveOrder(null);
    setPhase('idle');
    setPaymentData(null);
    setErrorMsg('');
    if (statusPollRef.current) clearInterval(statusPollRef.current);
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          if (pollRef.current) clearInterval(pollRef.current);
          if (statusPollRef.current) clearInterval(statusPollRef.current);
          await SecureStore.deleteItemAsync('device_token');
          await SecureStore.deleteItemAsync('device_name');
          await logout();
          navigation.replace('Login');
        },
      },
    ]);
  };

  const formatMoney = (amt) => `$${Number(amt || 0).toFixed(2)}`;
  const clientName = (order) => {
    if (!order?.client) return 'Walk-in Customer';
    return `${order.client.first_name || ''} ${order.client.last_name || ''}`.trim() || 'Customer';
  };

  // IDLE STATE - Waiting for orders
  if (phase === 'idle' && !activeOrder) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.topBar}>
          <View>
            <Text style={s.deviceLabel}>{deviceName}</Text>
            <View style={[s.statusDot, connected ? s.dotGreen : s.dotRed]}>
              <View style={[s.dot, { backgroundColor: connected ? COLORS.success : COLORS.danger }]} />
              <Text style={[s.statusText, { color: connected ? COLORS.success : COLORS.danger }]}>
                {connected ? 'Connected' : 'Disconnected'}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={handleLogout} style={s.logoutBtn}>
            <Text style={s.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <View style={s.idleCenter}>
          <View style={s.nfcIconLarge}>
            <Text style={s.nfcEmoji}>📱</Text>
          </View>
          <Text style={s.idleTitle}>Ready for Orders</Text>
          <Text style={s.idleDesc}>
            This device is registered and waiting. When the front desk sends an order, it will appear here automatically.
          </Text>
          <View style={s.pulseRing} />
        </View>

        {orders.length > 0 && (
          <View style={s.queueBox}>
            <Text style={s.queueTitle}>Pending Orders</Text>
            {orders.map((order) => (
              <TouchableOpacity key={order.id} style={s.queueItem} onPress={() => handleIncomingOrder(order)}>
                <View>
                  <Text style={s.queueName}>{clientName(order)}</Text>
                  <Text style={s.queueId}>#{order.id}</Text>
                </View>
                <Text style={s.queueAmount}>{formatMoney(order.total_amount)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </SafeAreaView>
    );
  }

  // SUCCESS STATE
  if (phase === 'success') {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: COLORS.successBg }]}>
        <View style={s.successCenter}>
          <Animated.View style={[s.successCircle, { transform: [{ scale: successScale }] }]}>
            <Text style={s.successCheck}>✓</Text>
          </Animated.View>
          <Text style={s.successTitle}>Payment Complete</Text>
          <Text style={s.successDesc}>Receipt sent to customer via SMS</Text>
          <Text style={s.successAmount}>
            {activeOrder ? formatMoney(activeOrder.total_amount) : ''}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ACTIVE ORDER - Collecting or Tapping
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Text style={s.deviceLabel}>{deviceName}</Text>
        <TouchableOpacity onPress={handleDismiss} style={s.dismissBtn}>
          <Text style={s.dismissText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.orderContent}>
        {/* Order Summary Card */}
        <View style={s.orderCard}>
          <Text style={s.orderClient}>{clientName(activeOrder)}</Text>
          <Text style={s.orderId}>Order #{activeOrder?.id}</Text>

          <View style={s.itemsList}>
            {(activeOrder?.items || []).map((item, i) => (
              <View key={i} style={s.itemRow}>
                <Text style={s.itemName}>{item.name} x{item.quantity}</Text>
                <Text style={s.itemPrice}>{formatMoney(item.line_total)}</Text>
              </View>
            ))}
          </View>

          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Total</Text>
            <Text style={s.totalAmount}>{formatMoney(activeOrder?.total_amount)}</Text>
          </View>
        </View>

        {/* NFC Collection Area */}
        {phase === 'tapping' && (
          <View style={s.nfcCard}>
            <Animated.View style={[s.nfcRing, { opacity: pulseAnim }]}>
              <View style={s.nfcInner}>
                <Text style={s.nfcIcon}>📶</Text>
              </View>
            </Animated.View>
            <Text style={s.nfcTitle}>Tap Card on This Device</Text>
            <Text style={s.nfcDesc}>
              Hold the customer's card near the top of this phone to collect payment.
            </Text>
            <View style={s.nfcStatus}>
              <ActivityIndicator size="small" color={COLORS.nfcBlue} />
              <Text style={s.nfcStatusText}>Waiting for card tap...</Text>
            </View>
          </View>
        )}

        {/* Error State */}
        {phase === 'error' && (
          <View style={s.errorCard}>
            <Text style={s.errorIcon}>⚠️</Text>
            <Text style={s.errorTitle}>Payment Error</Text>
            <Text style={s.errorDesc}>{errorMsg}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={() => { setPhase('collecting'); setErrorMsg(''); }}>
              <Text style={s.retryText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Action Buttons */}
        {phase === 'collecting' && (
          <View style={s.actions}>
            <TouchableOpacity style={s.collectBtn} onPress={handleCollectPayment} activeOpacity={0.8}>
              <Text style={s.collectIcon}>📶</Text>
              <Text style={s.collectText}>Collect {formatMoney(activeOrder?.total_amount)}</Text>
              <Text style={s.collectSub}>Tap to Pay</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.cashBtn} onPress={handleCashPayment} activeOpacity={0.8}>
              <Text style={s.cashText}>💵  Cash Payment</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'tapping' && (
          <View style={s.actions}>
            <TouchableOpacity style={s.cashBtn} onPress={handleCashPayment} activeOpacity={0.8}>
              <Text style={s.cashText}>💵  Switch to Cash</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  deviceLabel: { ...FONTS.bold, fontSize: 16 },
  statusDot: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dotGreen: {}, dotRed: {},
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 12, fontWeight: '600' },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  logoutText: { color: COLORS.danger, fontWeight: '600', fontSize: 13 },
  dismissBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.borderLight, justifyContent: 'center', alignItems: 'center' },
  dismissText: { fontSize: 18, color: COLORS.textSecondary },

  // Idle
  idleCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  nfcIconLarge: { marginBottom: 24 },
  nfcEmoji: { fontSize: 64 },
  idleTitle: { ...FONTS.heading, fontSize: 22, marginBottom: 8 },
  idleDesc: { ...FONTS.regular, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
  pulseRing: {
    position: 'absolute', width: 200, height: 200, borderRadius: 100,
    borderWidth: 2, borderColor: COLORS.primary + '20',
  },

  // Queue
  queueBox: { paddingHorizontal: 20, paddingBottom: 20 },
  queueTitle: { ...FONTS.bold, fontSize: 13, color: COLORS.textMuted, marginBottom: 8, letterSpacing: 0.5 },
  queueItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.card, borderRadius: 12, padding: 16, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  queueName: { ...FONTS.bold, fontSize: 15 },
  queueId: { ...FONTS.caption, marginTop: 2 },
  queueAmount: { ...FONTS.bold, fontSize: 18, color: COLORS.primary },

  // Order
  orderContent: { padding: 20 },
  orderCard: {
    backgroundColor: COLORS.card, borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 16,
  },
  orderClient: { ...FONTS.heading, fontSize: 20, marginBottom: 2 },
  orderId: { ...FONTS.caption, marginBottom: 16 },
  itemsList: { borderTopWidth: 1, borderTopColor: COLORS.borderLight, paddingTop: 12 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  itemName: { ...FONTS.regular, color: COLORS.textSecondary, flex: 1 },
  itemPrice: { ...FONTS.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 2, borderTopColor: COLORS.border, paddingTop: 12, marginTop: 8,
  },
  totalLabel: { ...FONTS.bold, fontSize: 16 },
  totalAmount: { ...FONTS.money },

  // NFC
  nfcCard: {
    backgroundColor: COLORS.nfcBg, borderRadius: 20, padding: 32,
    alignItems: 'center', borderWidth: 2, borderColor: '#bfdbfe', marginBottom: 16,
  },
  nfcRing: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: '#dbeafe',
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  nfcInner: {
    width: 70, height: 70, borderRadius: 35, backgroundColor: COLORS.white,
    justifyContent: 'center', alignItems: 'center',
  },
  nfcIcon: { fontSize: 32 },
  nfcTitle: { ...FONTS.heading, fontSize: 18, marginBottom: 8, color: '#1e40af' },
  nfcDesc: { ...FONTS.regular, color: '#3b82f6', textAlign: 'center', lineHeight: 20 },
  nfcStatus: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 8 },
  nfcStatusText: { color: COLORS.nfcBlue, fontWeight: '600', fontSize: 13 },

  // Error
  errorCard: {
    backgroundColor: COLORS.dangerBg, borderRadius: 16, padding: 24,
    alignItems: 'center', marginBottom: 16,
  },
  errorIcon: { fontSize: 40, marginBottom: 12 },
  errorTitle: { ...FONTS.bold, fontSize: 18, color: COLORS.danger, marginBottom: 4 },
  errorDesc: { ...FONTS.regular, color: COLORS.danger, textAlign: 'center' },
  retryBtn: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.danger },
  retryText: { ...FONTS.bold, color: COLORS.white },

  // Actions
  actions: { gap: 12 },
  collectBtn: {
    backgroundColor: COLORS.success, borderRadius: 16, paddingVertical: 24,
    alignItems: 'center',
    shadowColor: COLORS.success, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  collectIcon: { fontSize: 32, marginBottom: 4 },
  collectText: { ...FONTS.bold, color: COLORS.white, fontSize: 22 },
  collectSub: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600', marginTop: 2 },
  cashBtn: {
    backgroundColor: COLORS.borderLight, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  cashText: { ...FONTS.bold, fontSize: 15, color: COLORS.textSecondary },

  // Success
  successCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  successCircle: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.success,
    justifyContent: 'center', alignItems: 'center', marginBottom: 24,
  },
  successCheck: { fontSize: 48, color: COLORS.white, fontWeight: '800' },
  successTitle: { ...FONTS.heading, fontSize: 24, color: COLORS.success, marginBottom: 8 },
  successDesc: { ...FONTS.regular, color: COLORS.textSecondary, marginBottom: 16 },
  successAmount: { ...FONTS.money, fontSize: 36 },
});
