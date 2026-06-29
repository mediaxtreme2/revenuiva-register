import api from '../config/api';

export async function registerDevice(deviceName, deviceToken, locationId = null, hardwareInfo = {}) {
  const { data } = await api.post('/register-device', {
    device_name: deviceName,
    device_token: deviceToken,
    location_id: locationId,
    ...hardwareInfo,
  });
  return data;
}

export async function heartbeat(deviceToken) {
  const { data } = await api.post('/heartbeat', { device_token: deviceToken });
  return data;
}

export async function getPendingOrders(deviceToken) {
  const { data } = await api.get('/pending-orders', {
    params: { device_token: deviceToken },
  });
  return data;
}

export async function getConnectionToken() {
  const { data } = await api.post('/connection-token');
  return data.secret;
}

export async function collectOrder(orderId) {
  const { data } = await api.post(`/orders/${orderId}/collect`);
  return data;
}

export async function confirmPayment(orderId, paymentIntentId, paymentMethod = 'tap_to_pay') {
  const { data } = await api.post(`/orders/${orderId}/confirm-payment`, {
    payment_intent_id: paymentIntentId,
    payment_method: paymentMethod,
  });
  return data;
}

export async function markCash(orderId) {
  const { data } = await api.post(`/orders/${orderId}/confirm-payment`, {
    payment_method: 'cash',
  });
  return data;
}
