import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { KASPI_QRPAY_URL, DATA_DIR } from '../config.js';
import { loggedFetch, signedQrPayHeaders } from '../helpers.js';
import { decryptSecret } from '../crypto.js';
import { trackPayment } from '../polling.js';
 
const router = Router();
 
// ─── Persisted server-side session (written by auth.js after successful login) ───
const SESSION_FILE = path.join(DATA_DIR, 'session.json');
 
function readPersistedSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read persisted session.json:', e.message);
  }
  return null;
}
 
// Extract session from request headers, falling back to the persisted
// server-side session file if headers are absent (used by internal
// server-to-server callers, e.g. the main app's bridge, which have no
// browser localStorage to read tokenSN/vtokenSecret from).
const extractSession = (req) => {
  const headerSession = {
    tokenSN: req.headers['x-token-sn'] || null,
    profileId: req.headers['x-profile-id'] || null,
    vtokenSecret: req.headers['x-vtoken-secret'] || null,
  };
 
  if (headerSession.tokenSN && headerSession.vtokenSecret) {
    return headerSession;
  }
 
  const persisted = readPersistedSession();
  if (persisted && persisted.tokenSN && persisted.vtokenSecret) {
    return {
      tokenSN: persisted.tokenSN,
      profileId: persisted.profileId ?? null,
      vtokenSecret: persisted.vtokenSecret,
    };
  }
 
  return headerSession;
};
 
const requireAuth = (req, res, next) => {
  const session = extractSession(req);
  if (!session.tokenSN) return res.status(401).json({ error: 'Missing X-Token-SN header.' });
  if (!session.vtokenSecret) return res.status(401).json({ error: 'Missing X-Vtoken-Secret header.' });
  try {
    session.decryptedSecret = decryptSecret(session.vtokenSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired vtokenSecret. Re-authenticate.' });
  }
  req.session = session;
  next();
};
 
router.use(requireAuth);
 
// ─── Client info ───
 
router.get('/client-info', async (req, res) => {
  const { phoneNumber } = req.query;
  if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber required' });
 
  try {
    const url = `${KASPI_QRPAY_URL}/v01/remote/client-info?phoneNumber=${phoneNumber}`;
    const resp = await loggedFetch(url, { headers: signedQrPayHeaders(url, req.session) });
    res.json(await resp.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ─── Create invoice ───
 
router.post('/create', async (req, res) => {
  const { phoneNumber, amount, comment } = req.body;
  if (!phoneNumber || !amount) return res.status(400).json({ error: 'phoneNumber and amount required' });
 
  try {
    const url = `${KASPI_QRPAY_URL}/v01/remote/create`;
    const payload = JSON.stringify({ PhoneNumber: phoneNumber, Amount: Number(amount), Comment: comment || '' });
    const headers = { ...signedQrPayHeaders(url, req.session, payload), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: payload,
    });
    const kaspiResponse = await resp.json();
    const d = kaspiResponse.Data;
    if (d && d.Id && d.Status === 'RemotePaymentCreated') {
      trackPayment(
        d.Id,
        'invoice',
        {
          tokenSN: req.session.tokenSN,
          vtokenSecret: req.session.vtokenSecret,
          profileId: req.session.profileId,
        },
        {
          amount: d.Amount,
          clientMobile: d.ClientMobile,
          receiptUrl: d.ReceiptUrl,
          orderNumber: d.OrderNumber,
        },
      );
    }
    res.json(kaspiResponse);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ─── Invoice details ───
 
router.get('/details', async (req, res) => {
  const { operationId } = req.query;
  if (!operationId) return res.status(400).json({ error: 'operationId required' });
 
  try {
    const url = `${KASPI_QRPAY_URL}/v02/remote/details?operationId=${operationId}`;
    const resp = await loggedFetch(url, { headers: signedQrPayHeaders(url, req.session) });
    res.json(await resp.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ─── Cancel invoice ───
 
router.post('/cancel', async (req, res) => {
  const { operationId } = req.body;
  if (!operationId) return res.status(400).json({ error: 'operationId required' });
 
  try {
    const url = `${KASPI_QRPAY_URL}/v01/remote/cancel`;
    const payload = JSON.stringify({ qrOperationId: Number(operationId) });
    const headers = { ...signedQrPayHeaders(url, req.session, payload), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: payload,
    });
    res.json(await resp.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ─── Invoice history ───
 
router.post('/history', async (req, res) => {
  try {
    const url = `${KASPI_QRPAY_URL}/v01/remote/history`;
    const payload = JSON.stringify({ MaxResult: 20 });
    const headers = { ...signedQrPayHeaders(url, req.session, payload), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: payload,
    });
    res.json(await resp.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
export default router;
 
