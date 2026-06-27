/**
 * Services Tests — CRUD operations, health checks, auto-discover
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

describe('GET /api/services', () => {

  test('lists services for authenticated user', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email });
    const res = await request(app)
      .get('/api/services')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('rejects without authentication', async () => {
    const res = await request(app)
      .get('/api/services');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/services (create service)', () => {

  test('creates a new service', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .post('/api/services')
      .set(authHeader(token))
      .send({
        name: 'Test Service',
        url: 'https://example.com',
        description: 'A test service',
        access_level: 'public'
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Test Service');
    expect(res.body.url).toBe('https://example.com');
  });

  test('validates required fields', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .post('/api/services')
      .set(authHeader(token))
      .send({
        description: 'Missing name and url'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('rejects create without authentication', async () => {
    const res = await request(app)
      .post('/api/services')
      .send({
        name: 'Unauthorized',
        url: 'https://example.com'
      });

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/services/:id (update service)', () => {

  test('updates an existing service', async () => {
    // First create a service
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });

    const createRes = await request(app)
      .post('/api/services')
      .set(authHeader(token))
      .send({
        name: 'Service To Update',
        url: 'https://update-me.com',
        access_level: 'public'
      });

    const serviceId = createRes.body.id;

    const res = await request(app)
      .put(`/api/services/${serviceId}`)
      .set(authHeader(token))
      .send({
        name: 'Updated Service Name',
        url: 'https://updated.com',
        description: 'Updated description'
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Updated Service Name');
  });

  test('returns 404 for non-existent service', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .put('/api/services/99999')
      .set(authHeader(token))
      .send({ name: 'Ghost Service' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/services/:id', () => {

  test('deletes an existing service', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });

    // First create a service
    const createRes = await request(app)
      .post('/api/services')
      .set(authHeader(token))
      .send({
        name: 'Service To Delete',
        url: 'https://delete-me.com',
        access_level: 'public'
      });

    const serviceId = createRes.body.id;

    const res = await request(app)
      .delete(`/api/services/${serviceId}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);

    // Verify it's gone
    const getRes = await request(app)
      .get('/api/services')
      .set(authHeader(token));

    const deleted = getRes.body.find(s => s.id === serviceId);
    expect(deleted).toBeUndefined();
  });

  test('returns 404 for non-existent service', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .delete('/api/services/99999')
      .set(authHeader(token));

    expect(res.status).toBe(404);
  });
});

describe('POST /api/services/:id/health-check', () => {

  test('rejects health check for non-existent service', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .post('/api/services/99999/health-check')
      .set(authHeader(token));

    expect(res.status).toBe(404);
  });
});

describe('GET /api/services/templates', () => {

  test('returns available service templates', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email });
    const res = await request(app)
      .get('/api/services/templates')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('templates');
    expect(typeof res.body.templates).toBe('object');
    // Should contain some known templates
    const templateKeys = Object.keys(res.body.templates);
    expect(templateKeys).toContain('nextcloud');
    expect(templateKeys).toContain('plex');
  });
});

describe('POST /api/services/autodiscover', () => {

  test('rejects autodiscover with missing baseUrl', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .post('/api/services/autodiscover')
      .set(authHeader(token))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/base.?url/i);
  });

  test('rejects autodiscover with missing baseUrl for non-admin', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email, role: 'user' });
    const res = await request(app)
      .post('/api/services/autodiscover')
      .set(authHeader(token))
      .send({});

    expect(res.status).toBe(403);
  });
});
