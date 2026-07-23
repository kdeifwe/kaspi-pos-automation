import express from 'express';
import path from 'path';
import { PORT, ROOT_DIR } from './src/config.js';
import authRoutes from './src/routes/auth.js';
import invoiceRoutes from './src/routes/invoice.js';
import qrRoutes from './src/routes/qr.js';
import historyRoutes from './src/routes/history.js';
import refundRoutes from './src/routes/refund.js';
import sessionRoutes from './src/routes/session.js';
import { startPolling } from './src/polling.js';
import 'dotenv/config';
 
const app = express();
app.use(express.json());
 
// ─── Health check (без авторизации — Railway дёргает его для проверки живости) ───
app.get('/health', (req, res) => res.json({ status: 'ok' }));
 
// ─── Basic auth guard — защищает демо-UI и все /api/* роуты от публичного доступа ───
function requireAuth(req, res, next) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
 
  if (!user || !pass) {
    console.error('FATAL: ADMIN_USER / ADMIN_PASS environment variables are not set.');
    return res.status(500).send('Server misconfigured: auth credentials not set.');
  }
 
  const header = req.headers.authorization || '';
  const expected = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
 
  if (header === expected) return next();
 
  res.set('WWW-Authenticate', 'Basic realm="Restricted"');
  return res.status(401).send('Authentication required');
}
 
app.use(requireAuth);
 
app.use(express.static(path.join(ROOT_DIR, 'public')));
app.use('/api/auth', authRoutes);
app.use('/api/invoice', invoiceRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/refund', refundRoutes);
app.use('/api/session', sessionRoutes);
 
app.listen(PORT, () => {
  console.log(`\n  🟢 Kaspi Pay App running at http://localhost:${PORT}\n`);
  startPolling();
});
 
