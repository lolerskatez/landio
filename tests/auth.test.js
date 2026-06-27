/**
 * Authentication Tests — Login, logout, token validation, password policy, lockout
 */
const request = require('supertest');
const { setupTestEnvironment, teardownTestEnvironment, TEST_ADMIN, TEST_USER, createAuthToken } = require('./helpers');

let app;

beforeAll(async () => {
  const ctx = await setupTestEnvironment();
  app = ctx.app;
});

afterAll(async () => {
  await teardownTestEnvironment();
});

describe('POST /api/auth/login', () => {

  test('logs in admin user with email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(TEST_ADMIN.email);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.requiresTwoFactor).toBeUndefined();
  });

  test('logs in admin user with username', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.username).toBe(TEST_ADMIN.username);
  });

  test('rejects invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_ADMIN.email, password: 'WrongPassword1!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
    expect(res.body.token).toBeUndefined();
  });

  test('rejects non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'SomePass1!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  test('returns 400 when credentials are missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  test('rejects disabled user', async () => {
    const datalayer = require('../lib/datalayer');
    const user = await datalayer.users.findByEmail(TEST_USER.email);
    await datalayer.users.update(user.id, { is_active: false });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled/i);

    // Re-enable
    await datalayer.users.update(user.id, { is_active: true });
  });
});

describe('POST /api/auth/logout', () => {

  test('logs out authenticated user', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });
    const token = loginRes.body.token;

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);
  });

  test('rejects logout without token', async () => {
    const res = await request(app)
      .post('/api/auth/logout');

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {

  test('returns authenticated user info', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });
    const token = loginRes.body.token;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_ADMIN.email);
    expect(res.body.role).toBe('admin');
    expect(res.body.permissions).toBeDefined();
  });

  test('rejects without token', async () => {
    const res = await request(app)
      .get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  test('rejects invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token-here');

    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/refresh', () => {

  test('refreshes a valid token', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });
    const token = loginRes.body.token;

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.token).not.toBe(token);
  });

  test('rejects refresh without token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/setup and GET /api/auth/setup/status', () => {

  test('rejects setup when system has users', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ name: 'Another', email: 'another@test.com', password: 'StrongPass1!' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/already initialized/i);
  });

  test('returns setup status as initialized', async () => {
    const res = await request(app)
      .get('/api/auth/setup/status');

    expect(res.status).toBe(200);
    expect(res.body.initialized).toBe(true);
  });
});

describe('Account Lockout', () => {

  test('locks account after repeated failed attempts', async () => {
    const datalayer = require('../lib/datalayer');
    // Set max-login-attempts to 3 for testing
    await datalayer.settings.set('max-login-attempts', '3');
    await datalayer.settings.set('lockout-duration', '3600');

    // Make 3 failed attempts
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: TEST_ADMIN.email, password: 'WrongPassword1!' });
    }

    // The 4th attempt with correct password should be blocked
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');

    // Reset for other tests
    await datalayer.settings.set('max-login-attempts', '5');
    await datalayer.settings.set('lockout-duration', '900');
    const user = await datalayer.users.findByEmail(TEST_ADMIN.email);
    await datalayer.users.resetFailedAttempts(user.id);
  });
});

describe('Password Policy (via user update)', () => {

  /** Ensure password-policy setting is enabled before each test */
  async function enablePasswordPolicy() {
    const datalayer = require('../lib/datalayer');
    await datalayer.settings.set('password-policy', 'true');
  }

  test('rejects short password when updating user', async () => {
    await enablePasswordPolicy();

    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .put('/api/users/2')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Short1A' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password policy/i);
  });

  test('rejects password without uppercase', async () => {
    await enablePasswordPolicy();

    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .put('/api/users/2')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'alllowercase1!' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password policy/i);
  });

  test('rejects password without numbers', async () => {
    await enablePasswordPolicy();

    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .put('/api/users/2')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'NoNumbersHere!' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password policy/i);
  });
});

describe('GET /api/auth/init-demo-users (deprecated)', () => {

  test('returns 410 Gone', async () => {
    const res = await request(app)
      .post('/api/auth/init-demo-users');

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('Gone');
  });
});
