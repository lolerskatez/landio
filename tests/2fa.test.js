/**
 * Two-Factor Authentication Tests — Setup, verify, disable, backup codes
 */
const request = require('supertest');
const { setupTestEnvironment, teardownTestEnvironment, TEST_ADMIN, TEST_USER, createAuthToken, authHeader } = require('./helpers');

let app;

beforeAll(async () => {
  const ctx = await setupTestEnvironment();
  app = ctx.app;
});

afterAll(async () => {
  await teardownTestEnvironment();
});

describe('POST /api/2fa/setup', () => {

  test('generates TOTP secret for authenticated user', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email });
    const res = await request(app)
      .post('/api/2fa/setup')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.secret).toBeDefined();
    expect(res.body.qrCode).toBeDefined();
    expect(res.body.backupCodes).toBeDefined();
    expect(res.body.backupCodes.length).toBe(10);
  });

  test('rejects setup without authentication', async () => {
    const res = await request(app)
      .post('/api/2fa/setup');

    expect(res.status).toBe(401);
  });

  test('generates unique backup codes on each call', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email });

    const res1 = await request(app)
      .post('/api/2fa/setup')
      .set(authHeader(token));

    const res2 = await request(app)
      .post('/api/2fa/setup')
      .set(authHeader(token));

    // Backup codes should differ between calls
    expect(res1.body.backupCodes).not.toEqual(res2.body.backupCodes);
  });
});

describe('POST /api/2fa/verify-setup', () => {

  test('rejects verify-setup without a valid code', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email });
    const res = await request(app)
      .post('/api/2fa/verify-setup')
      .set(authHeader(token))
      .send({ secret: 'INVALIDSECRET', code: '000000' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('rejects without authentication', async () => {
    const res = await request(app)
      .post('/api/2fa/verify-setup')
      .send({ secret: 'test', code: '123456' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/2fa/verify (login verification)', () => {

  test('rejects 2FA verification without authentication', async () => {
    const res = await request(app)
      .post('/api/2fa/verify')
      .send({ userId: 1, code: '123456' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/2fa/disable', () => {

  test('rejects disable without authentication', async () => {
    const res = await request(app)
      .post('/api/2fa/disable');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/2fa/regenerate-backup-codes', () => {

  test('rejects regeneration without authentication', async () => {
    const res = await request(app)
      .post('/api/2fa/regenerate-backup-codes');

    expect(res.status).toBe(401);
  });
});

describe('GET /api/2fa/status', () => {

  test('returns 2FA status for authenticated user', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email });
    const res = await request(app)
      .get('/api/2fa/status')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enabled');
  });

  test('rejects without authentication', async () => {
    const res = await request(app)
      .get('/api/2fa/status');

    expect(res.status).toBe(401);
  });
});

describe('GET /api/2fa/enforcement-status', () => {

  test('returns 2FA enforcement policy', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .get('/api/2fa/enforcement-status')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mode');
    expect(res.body).toHaveProperty('twoFAGracePeriod');
  });

  test('rejects enforcement for non-admin', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email, role: 'user' });
    const res = await request(app)
      .get('/api/2fa/enforcement-status')
      .set(authHeader(token));

    expect(res.status).toBe(403);
  });
});

describe('POST /api/2fa/admin/reset/:userId', () => {

  test('rejects reset for non-admin', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email, role: 'user' });
    const res = await request(app)
      .post('/api/2fa/admin/reset/2')
      .set(authHeader(token));

    expect(res.status).toBe(403);
  });
});

describe('GET /api/2fa/admin/users-2fa-status', () => {

  test('rejects statuses for non-admin', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email, role: 'user' });
    const res = await request(app)
      .get('/api/2fa/admin/users-2fa-status')
      .set(authHeader(token));

    expect(res.status).toBe(403);
  });

  test('returns all user 2FA statuses for admin', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .get('/api/2fa/admin/users-2fa-status')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBeGreaterThanOrEqual(2);
  });
});
