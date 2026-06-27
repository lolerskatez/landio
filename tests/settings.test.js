/**
 * Settings Tests — CRUD operations, validation, SMTP/Discord test
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

describe('GET /api/settings', () => {

  test('returns user settings when authenticated', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email });
    const res = await request(app)
      .get('/api/settings')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(res.body).toHaveProperty('settings');
    expect(typeof res.body.settings).toBe('object');
  });

  test('rejects without authentication', async () => {
    const res = await request(app)
      .get('/api/settings');

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/settings (update user settings)', () => {

  test('updates user settings', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email });
    const res = await request(app)
      .put('/api/settings')
      .set(authHeader(token))
      .send({
        settings: { theme: 'dark', language: 'en' }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify the settings were saved
    const getRes = await request(app)
      .get('/api/settings')
      .set(authHeader(token));

    expect(getRes.body.settings.theme.value).toBe('dark');
  });

  test('accepts setting values even when schema validation warns', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email });

    // validateSettingValue warns on invalid values but does NOT block the save
    const res = await request(app)
      .put('/api/settings')
      .set(authHeader(token))
      .send({
        settings: { 'session-timeout': 'not-a-number' }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('rejects update without authentication', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({
        settings: { theme: 'dark' }
      });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/settings/system-preferences', () => {

  test('returns system preferences for admin', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .get('/api/settings/system-preferences')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('preferences');
    expect(typeof res.body.preferences).toBe('object');
  });

  test('rejects system preferences for non-admin', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email, role: 'user' });
    const res = await request(app)
      .get('/api/settings/system-preferences')
      .set(authHeader(token));

    expect(res.status).toBe(403);
  });
});

describe('POST /api/settings/test-smtp', () => {

  test('rejects SMTP test for non-admin', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email, role: 'user' });
    const res = await request(app)
      .post('/api/settings/test-smtp')
      .set(authHeader(token));

    expect(res.status).toBe(403);
  });
});

describe('POST /api/settings/test-discord', () => {

  test('rejects Discord test for non-admin', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email, role: 'user' });
    const res = await request(app)
      .post('/api/settings/test-discord')
      .set(authHeader(token));

    expect(res.status).toBe(403);
  });
});

describe('Admin Settings Management (PUT /api/settings system scope)', () => {

  test('admin can update system-wide settings', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .put('/api/settings')
      .set(authHeader(token))
      .send({
        scope: 'system',
        settings: { 'app-title': 'Test Dashboard', 'maintainer-email': 'admin@test.com' }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('non-admin cannot update system-wide settings', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email, role: 'user' });
    const res = await request(app)
      .put('/api/settings')
      .set(authHeader(token))
      .send({
        scope: 'system',
        settings: { 'app-title': 'Hacked Dashboard' }
      });

    expect(res.status).toBe(403);
  });
});
