import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ActivityIndicator, ScrollView, Alert, AppState, Animated, Platform,
  PermissionsAndroid, Dimensions,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { useStripeTerminal } from '@stripe/stripe-terminal-react-native';
import { COLORS, FONTS } from '../config/theme';
import { heartbeat, collectOrder, confirmPayment, markCash } from '../services/pos';
import { logout } from '../services/auth';

const POLL_INTERVAL = 3000;
const SUCCESS_DISPLAY_MS = 5000;
const { width: SCREEN_W } = Dimensions.get('window');

export default function TerminalScreen({ navigation }) {
  const [deviceName, setDeviceName] = useState('');
  const [connected, setConnected] = useState(false);
  const [orders, setOrders] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [paymentData, setPaymentData] = useState(null);
  const [terminalReady, setTerminalReady] = useState(false);

  const pollRef = useRef(null);
  const statusPollRef = useRef(null);
  const appState = useRef(AppState.currentState);
  const isProcessing = useRef(false);
  const phaseRef = useRef('idle');
  const errorLockedUntil = useRef(0);
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0.5)).current;
  const nfcGlow = useRef(new Animated.Value(0)).current;

  const updatePhase = useCallback((newPhase) => {
    if (newPhase === 'error') {
      errorLockedUntil.current = Date.now() + 30000;
    }
    phaseRef.current = newPhase;
    setPhase(newPhase);
  }, []);

  const {
    easyConnect,
    collectPaymentMethod,
    confirmPaymentIntent,
    retrievePaymentIntent,
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
      stopPolling();
      stopStatusPolling();
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (phase === 'tapping') {
      startPulseAnimation();
    } else {
      stopPulseAnimation();
    }
  }, [phase]);

  useEffect(() => {
    if (phase === 'success') {
      Animated.parallel([
        Animated.spring(successScale, {
          toValue: 1, friction: 5, tension: 80, useNativeDriver: true,
        }),
        Animated.timing(successOpacity, {
          toValue: 1, duration: 300, useNativeDriver: true,
        }),
      ]).start();
      const t = setTimeout(() => {
        Animated.timing(successOpacity, {
          toValue: 0, duration: 400, useNativeDriver: true,
        }).start(() => {
          successScale.setValue(0.5);
          resetToIdle();
        });
      }, SUCCESS_DISPLAY_MS);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const startPulseAnimation = () => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 1500, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.15, duration: 1500, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 1500, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(nfcGlow, { toValue: 1, duration: 1500, useNativeDriver: true }),
          Animated.timing(nfcGlow, { toValue: 0, duration: 1500, useNativeDriver: true }),
        ]),
      ])
    ).start();
  };

  const stopPulseAnimation = () => {
    pulseAnim.stopAnimation();
    pulseScale.stopAnimation();
    nfcGlow.stopAnimation();
    pulseAnim.setValue(0.3);
    pulseScale.setValue(1);
    nfcGlow.setValue(0);
  };

  const handleAppState = (nextState) => {
    if (appState.current.match(/inactive|background/) && nextState === 'active') {
      if (!isProcessing.current && phaseRef.current === 'idle') pollNow();
    }
    appState.current = nextState;
  };

  const requestPermissions = async () => {
    if (Platform.OS !== 'android') return true;
    try {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      ]);
      return Object.values(results).every(
        r => r === PermissionsAndroid.RESULTS.GRANTED
      );
    } catch (e) {
      return false;
    }
  };

  const init = async () => {
    const name = await SecureStore.getItemAsync('device_name');
    setDeviceName(name || 'Device');
    try {
      await requestPermissions();
      await initTerminal();
      await connectTerminalReader();
    } catch (e) {
      console.warn('Terminal init skipped:', e.message);
    }
    startPolling();
  };

  const startPolling = () => {
    stopPolling();
    pollNow();
    pollRef.current = setInterval(pollNow, POLL_INTERVAL);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const stopStatusPolling = () => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  };

  const pollNow = async () => {
    if (isProcessing.current) return;
    if (phaseRef.current === 'error' || phaseRef.current === 'tapping' || phaseRef.current === 'success') return;
    if (Date.now() < errorLockedUntil.current) return;
    try {
      const token = await SecureStore.getItemAsync('device_token');
      if (!token) return;
      const data = await heartbeat(token);
      setConnected(true);
      const incoming = data.orders || [];
      setOrders(incoming);
      if (incoming.length > 0 && phaseRef.current === 'idle' && !isProcessing.current) {
        handleIncomingOrder(incoming[0]);
      }
    } catch (e) {
      setConnected(false);
    }
  };

  const handleIncomingOrder = (order) => {
    if (isProcessing.current) return;
    if (phaseRef.current === 'error' || phaseRef.current === 'tapping' || phaseRef.current === 'success') return;
    if (Date.now() < errorLockedUntil.current) return;
    setActiveOrder(order);
    updatePhase('collecting');
    setErrorMsg('');
    setStatusMsg('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };

  const resetToIdle = () => {
    isProcessing.current = false;
    errorLockedUntil.current = 0;
    updatePhase('idle');
    setActiveOrder(null);
    setPaymentData(null);
    setErrorMsg('');
    setStatusMsg('');
    startPolling();
  };

  const connectTerminalReader = async () => {
    try {
      const { reader, error } = await easyConnect({
        discoveryMethod: 'tapToPay',
        simulated: false,
        locationId: 'tml_GjckgyoJFmc1L9',
        tosAcceptancePermitted: true,
        autoReconnectOnUnexpectedDisconnect: true,
        merchantDisplayName: 'Salud Holistic Spa',
      });
      if (error) {
        console.warn('[Terminal] easyConnect error:', error.message);
        return false;
      }
      if (reader) {
        setTerminalReady(true);
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[Terminal] easyConnect exception:', e.message);
      return false;
    }
  };

  const handleCollectPayment = async () => {
    if (!activeOrder || isProcessing.current) return;

    isProcessing.current = true;
    stopPolling();
    updatePhase('tapping');
    setErrorMsg('');
    setStatusMsg('Preparing payment...');

    try {
      const data = await collectOrder(activeOrder.id);
      setPaymentData(data);
      setStatusMsg('Connecting to terminal...');
      await initiateTerminalCollection(data);
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to initialize payment. Please try again.';
      showError(msg);
    }
  };

  const showError = (msg) => {
    isProcessing.current = false;
    setErrorMsg(msg);
    setStatusMsg('');
    updatePhase('error');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const initiateTerminalCollection = async (data) => {
    try {
      if (!terminalReady) {
        setStatusMsg('Setting up NFC reader...');
        const ok = await connectTerminalReader();
        if (!ok) {
          showError('Could not activate NFC reader. Make sure NFC is enabled in your phone settings.');
          return;
        }
      }

      setStatusMsg('Loading payment details...');
      const { paymentIntent: pi, error: retrieveError } = await retrievePaymentIntent(data.client_secret);
      if (retrieveError) {
        showError('Failed to load payment: ' + retrieveError.message);
        return;
      }

      setStatusMsg('Hold card near the top of this phone...');
      const { paymentIntent, error } = await collectPaymentMethod({ paymentIntent: pi });
      if (error) {
        if (error.code === 'Canceled') {
          showError('Card read was cancelled. Please try again.');
        } else {
          showError(error.message || 'Could not read card. Please try again.');
        }
        return;
      }

      setStatusMsg('Card read successfully! Processing payment...');
      const { paymentIntent: confirmed, error: confirmError } = await confirmPaymentIntent({ paymentIntent });
      if (confirmError) {
        showError(confirmError.message || 'Payment was declined. Please try a different card.');
        return;
      }

      setStatusMsg('Finalizing...');
      await confirmPayment(activeOrder.id, confirmed.id, 'tap_to_pay');

      isProcessing.current = false;
      setStatusMsg('');
      updatePhase('success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      showError('Payment failed: ' + e.message);
    }
  };

  const handleRetry = () => {
    errorLockedUntil.current = 0;
    setErrorMsg('');
    setStatusMsg('');
    updatePhase('collecting');
    isProcessing.current = false;
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
              isProcessing.current = true;
              stopPolling();
              setStatusMsg('Processing cash payment...');
              await markCash(activeOrder.id);
              isProcessing.current = false;
              setStatusMsg('');
              updatePhase('success');
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e) {
              showError('Failed to process cash payment. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleDismiss = () => {
    if (isProcessing.current && phase === 'tapping') {
      Alert.alert(
        'Cancel Payment?',
        'A card read is in progress. Are you sure you want to cancel?',
        [
          { text: 'Keep Waiting', style: 'cancel' },
          { text: 'Cancel Payment', style: 'destructive', onPress: resetToIdle },
        ]
      );
      return;
    }
    resetToIdle();
  };

  const handleLogout = () => {
    if (isProcessing.current) {
      Alert.alert('Payment in Progress', 'Please finish or cancel the current payment before signing out.');
      return;
    }
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          stopPolling();
          stopStatusPolling();
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

  // ─── SUCCESS OVERLAY ─────────────────────────────────────
  if (phase === 'success') {
    return (
      <SafeAreaView style={[s.safe, s.successSafe]}>
        <Animated.View style={[s.successCenter, { opacity: successOpacity }]}>
          <Animated.View style={[s.successCircle, { transform: [{ scale: successScale }] }]}>
            <Text style={s.successCheck}>✓</Text>
          </Animated.View>
          <Text style={s.successTitle}>Payment Complete</Text>
          {activeOrder && (
            <Text style={s.successAmount}>{formatMoney(activeOrder.total_amount)}</Text>
          )}
          <Text style={s.successDesc}>Receipt sent to customer via SMS</Text>
          <View style={s.successDivider} />
          <Text style={s.successHint}>Returning to terminal...</Text>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // ─── MAIN TERMINAL VIEW ──────────────────────────────────
  const hasOrder = !!activeOrder && phase !== 'idle';

  return (
    <SafeAreaView style={s.safe}>
      {/* ── Top Bar ── */}
      <View style={s.topBar}>
        <View>
          <Text style={s.deviceLabel}>{deviceName}</Text>
          <View style={s.statusRow}>
            <View style={[s.dot, { backgroundColor: connected ? COLORS.success : COLORS.danger }]} />
            <Text style={[s.statusText, { color: connected ? COLORS.success : COLORS.danger }]}>
              {connected ? 'Online' : 'Offline'}
            </Text>
            {terminalReady && (
              <>
                <View style={s.statusSep} />
                <Text style={s.nfcBadge}>NFC Ready</Text>
              </>
            )}
          </View>
        </View>
        {hasOrder ? (
          <TouchableOpacity onPress={handleDismiss} style={s.dismissBtn} activeOpacity={0.7}>
            <Text style={s.dismissText}>✕</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={handleLogout} style={s.logoutBtn} activeOpacity={0.7}>
            <Text style={s.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── IDLE STATE ── */}
      {!hasOrder && (
        <View style={s.idleWrap}>
          <View style={s.idleCenter}>
            <View style={s.idleIconWrap}>
              <Text style={s.idleIcon}>📱</Text>
            </View>
            <Text style={s.idleTitle}>Ready for Orders</Text>
            <Text style={s.idleDesc}>
              Waiting for the front desk to send an order. It will appear here automatically.
            </Text>
          </View>

          {orders.length > 0 && (
            <View style={s.queueBox}>
              <Text style={s.queueHeader}>PENDING ORDERS</Text>
              {orders.map((order) => (
                <TouchableOpacity
                  key={order.id}
                  style={s.queueItem}
                  onPress={() => handleIncomingOrder(order)}
                  activeOpacity={0.7}
                >
                  <View style={s.queueLeft}>
                    <Text style={s.queueName}>{clientName(order)}</Text>
                    <Text style={s.queueId}>#{order.id}</Text>
                  </View>
                  <Text style={s.queueAmount}>{formatMoney(order.total_amount)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {/* ── ACTIVE ORDER ── */}
      {hasOrder && (
        <ScrollView
          contentContainerStyle={s.orderContent}
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          {/* Order Summary */}
          <View style={s.orderCard}>
            <View style={s.orderHeader}>
              <View>
                <Text style={s.orderClient}>{clientName(activeOrder)}</Text>
                <Text style={s.orderId}>Order #{activeOrder?.id}</Text>
              </View>
              <View style={s.orderBadge}>
                <Text style={s.orderBadgeText}>
                  {phase === 'tapping' ? 'PROCESSING' : phase === 'error' ? 'FAILED' : 'PENDING'}
                </Text>
              </View>
            </View>

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

          {/* ── NFC TAP AREA ── */}
          {phase === 'tapping' && (
            <View style={s.nfcCard}>
              <Animated.View style={[
                s.nfcOuterRing,
                { opacity: pulseAnim, transform: [{ scale: pulseScale }] }
              ]}>
                <View style={s.nfcMiddleRing}>
                  <View style={s.nfcInnerCircle}>
                    <Text style={s.nfcSymbol}>📶</Text>
                  </View>
                </View>
              </Animated.View>

              <Text style={s.nfcTitle}>Tap Card Here</Text>
              <Text style={s.nfcDesc}>
                Hold the customer's card flat against the back of this phone until you hear a beep.
              </Text>

              <View style={s.statusBar}>
                <ActivityIndicator size="small" color={COLORS.nfcBlue} />
                <Text style={s.statusBarText}>{statusMsg || 'Waiting for card...'}</Text>
              </View>
            </View>
          )}

          {/* ── ERROR DISPLAY ── */}
          {phase === 'error' && (
            <View style={s.errorCard}>
              <View style={s.errorIconWrap}>
                <Text style={s.errorIconText}>!</Text>
              </View>
              <Text style={s.errorTitle}>Payment Failed</Text>
              <Text style={s.errorDesc}>{errorMsg}</Text>
              <View style={s.errorActions}>
                <TouchableOpacity style={s.retryBtn} onPress={handleRetry} activeOpacity={0.7}>
                  <Text style={s.retryText}>Try Again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.errorDismissBtn} onPress={resetToIdle} activeOpacity={0.7}>
                  <Text style={s.errorDismissText}>Cancel Order</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── COLLECTING PHASE BUTTONS ── */}
          {phase === 'collecting' && (
            <View style={s.actions}>
              <TouchableOpacity
                style={s.collectBtn}
                onPress={handleCollectPayment}
                activeOpacity={0.8}
              >
                <Text style={s.collectIcon}>📶</Text>
                <Text style={s.collectText}>
                  Collect {formatMoney(activeOrder?.total_amount)}
                </Text>
                <Text style={s.collectSub}>Tap to Pay</Text>
              </TouchableOpacity>

              <TouchableOpacity style={s.cashBtn} onPress={handleCashPayment} activeOpacity={0.7}>
                <Text style={s.cashText}>💵  Cash Payment</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── TAPPING PHASE - FALLBACK OPTION ── */}
          {phase === 'tapping' && (
            <View style={s.actions}>
              <TouchableOpacity style={s.switchCashBtn} onPress={handleCashPayment} activeOpacity={0.7}>
                <Text style={s.switchCashText}>Switch to Cash Instead</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  successSafe: { backgroundColor: '#ecfdf5' },

  // ── Top Bar ──
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  deviceLabel: { ...FONTS.bold, fontSize: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 12, fontWeight: '600' },
  statusSep: { width: 1, height: 12, backgroundColor: COLORS.border, marginHorizontal: 8 },
  nfcBadge: {
    fontSize: 10, fontWeight: '700', color: COLORS.nfcBlue, letterSpacing: 0.5,
    backgroundColor: COLORS.nfcBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  logoutBtn: { paddingHorizontal: 14, paddingVertical: 8 },
  logoutText: { color: COLORS.danger, fontWeight: '600', fontSize: 13 },
  dismissBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.borderLight, justifyContent: 'center', alignItems: 'center',
  },
  dismissText: { fontSize: 18, color: COLORS.textSecondary },

  // ── Idle ──
  idleWrap: { flex: 1 },
  idleCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  idleIconWrap: { marginBottom: 20 },
  idleIcon: { fontSize: 56 },
  idleTitle: { ...FONTS.heading, fontSize: 22, marginBottom: 8 },
  idleDesc: { ...FONTS.regular, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },

  // ── Queue ──
  queueBox: { paddingHorizontal: 20, paddingBottom: 24 },
  queueHeader: {
    fontSize: 11, fontWeight: '700', color: COLORS.textMuted,
    letterSpacing: 1, marginBottom: 10,
  },
  queueItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.white, borderRadius: 12, padding: 16, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  queueLeft: { flex: 1 },
  queueName: { ...FONTS.bold, fontSize: 15 },
  queueId: { ...FONTS.caption, marginTop: 2 },
  queueAmount: { ...FONTS.bold, fontSize: 18, color: COLORS.primary },

  // ── Order Card ──
  orderContent: { padding: 20, paddingBottom: 40 },
  orderCard: {
    backgroundColor: COLORS.white, borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 16,
  },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  orderClient: { ...FONTS.heading, fontSize: 20 },
  orderId: { ...FONTS.caption, marginTop: 2 },
  orderBadge: {
    backgroundColor: COLORS.warningBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
  },
  orderBadgeText: { fontSize: 10, fontWeight: '800', color: COLORS.warning, letterSpacing: 0.5 },
  itemsList: { borderTopWidth: 1, borderTopColor: COLORS.borderLight, paddingTop: 12 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  itemName: { ...FONTS.regular, color: COLORS.textSecondary, flex: 1 },
  itemPrice: { ...FONTS.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 2, borderTopColor: COLORS.border, paddingTop: 14, marginTop: 8,
  },
  totalLabel: { ...FONTS.bold, fontSize: 16 },
  totalAmount: { ...FONTS.money },

  // ── NFC Card ──
  nfcCard: {
    backgroundColor: '#f0f7ff', borderRadius: 20, padding: 32,
    alignItems: 'center', marginBottom: 16,
    borderWidth: 2, borderColor: '#bfdbfe',
  },
  nfcOuterRing: {
    width: 120, height: 120, borderRadius: 60, backgroundColor: '#dbeafe',
    justifyContent: 'center', alignItems: 'center', marginBottom: 24,
  },
  nfcMiddleRing: {
    width: 90, height: 90, borderRadius: 45, backgroundColor: '#bfdbfe',
    justifyContent: 'center', alignItems: 'center',
  },
  nfcInnerCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.white,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 3,
  },
  nfcSymbol: { fontSize: 28 },
  nfcTitle: { ...FONTS.heading, fontSize: 20, color: '#1e40af', marginBottom: 8 },
  nfcDesc: {
    ...FONTS.regular, color: '#3b82f6', textAlign: 'center',
    lineHeight: 22, paddingHorizontal: 10,
  },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', marginTop: 20,
    backgroundColor: '#dbeafe', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
  },
  statusBarText: {
    color: '#1e40af', fontWeight: '600', fontSize: 13, marginLeft: 10, flex: 1,
  },

  // ── Error ──
  errorCard: {
    backgroundColor: '#fff5f5', borderRadius: 16, padding: 28,
    alignItems: 'center', marginBottom: 16,
    borderWidth: 1, borderColor: '#fecaca',
  },
  errorIconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.danger,
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  errorIconText: { fontSize: 28, color: COLORS.white, fontWeight: '900' },
  errorTitle: { ...FONTS.bold, fontSize: 18, color: COLORS.danger, marginBottom: 8 },
  errorDesc: {
    ...FONTS.regular, color: '#991b1b', textAlign: 'center',
    lineHeight: 22, paddingHorizontal: 8, marginBottom: 20,
  },
  errorActions: { width: '100%', gap: 10 },
  retryBtn: {
    backgroundColor: COLORS.danger, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center',
  },
  retryText: { ...FONTS.bold, color: COLORS.white, fontSize: 15 },
  errorDismissBtn: {
    borderRadius: 12, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#fecaca',
  },
  errorDismissText: { ...FONTS.bold, color: COLORS.danger, fontSize: 14 },

  // ── Actions ──
  actions: { gap: 12, marginTop: 4 },
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
  switchCashBtn: {
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white,
  },
  switchCashText: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },

  // ── Success ──
  successCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  successCircle: {
    width: 110, height: 110, borderRadius: 55, backgroundColor: COLORS.success,
    justifyContent: 'center', alignItems: 'center', marginBottom: 28,
    shadowColor: COLORS.success, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
  },
  successCheck: { fontSize: 52, color: COLORS.white, fontWeight: '800' },
  successTitle: { ...FONTS.heading, fontSize: 26, color: COLORS.success, marginBottom: 12 },
  successAmount: { ...FONTS.money, fontSize: 40, marginBottom: 8 },
  successDesc: { ...FONTS.regular, color: COLORS.textSecondary, fontSize: 15, marginBottom: 20 },
  successDivider: { width: 40, height: 2, backgroundColor: '#d1fae5', marginBottom: 16 },
  successHint: { ...FONTS.caption, fontSize: 13 },
});
