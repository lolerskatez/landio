/**
 * Users Tests — CRUD operations, admin-only access, user management
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

describe('GET /api/users', () => {

  test('lists users for admin', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .get('/api/users')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  test('rejects list for non-admin', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email, role: 'user' });
    const res = await request(app)
      .get('/api/users')
      .set(authHeader(token));

    expect(res.status).toBe(403);
  });

  test('rejects without authentication', async () => {
    const res = await request(app)
      .get('/api/users');

    expect(res.status).toBe(401);
  });

  test('supports pagination with page and limit', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .get('/api/users?page=1&limit=10')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.users).toBeDefined();
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(10);
  });

  test('supports search filtering', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .get(`/api/users?search=${encodeURIComponent('admin')}&page=1&limit=10`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    // With pagination params, the route returns { users, pagination }
    expect(res.body.users).toBeDefined();
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.some(u => u.email && u.email.includes('admin'))).toBe(true);
  });
});

describe('POST /api/users (create user)', () => {

  test('admin can create a new user', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .post('/api/users')
      .set(authHeader(token))
      .send({
        name: 'New User',
        email: 'newuser@test.com',
        password: 'NewUser123!',
        role: 'user'
      });

    expect(res.status).toBe(201);
    // POST /api/users returns the user object directly, not wrapped in {user: ...}
    expect(res.body.id).toBeDefined();
    expect(res.body.email).toBe('newuser@test.com');
  });

  test('rejects duplicate email', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .post('/api/users')
      .set(authHeader(token))
      .send({
        name: 'Duplicate',
        email: TEST_ADMIN.email,
        password: 'DupPass123!',
        role: 'user'
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/email|exists|unique/i);
  });

  test('rejects create for non-admin', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email, role: 'user' });
    const res = await request(app)
      .post('/api/users')
      .set(authHeader(token))
      .send({
        name: 'Should Not Create',
        email: 'shouldnot@test.com',
        password: 'TestPass123!',
        role: 'user'
      });

    expect(res.status).toBe(403);
  });
});

describe('PUT /api/users/:id (update user)', () => {

  test('admin can update a user', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .put('/api/users/2')
      .set(authHeader(token))
      .send({
        name: 'Updated User Name',
        role: 'poweruser'
      });

    expect(res.status).toBe(200);
    // PUT /api/users/:id returns the user object directly
    expect(res.body.id).toBeDefined();
  });

  test('rejects update for non-admin', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email, role: 'user' });
    const res = await request(app)
      .put('/api/users/1')
      .set(authHeader(token))
      .send({ name: 'Hacked Name' });

    expect(res.status).toBe(403);
  });

  test('returns 404 for non-existent user', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .put('/api/users/99999')
      .set(authHeader(token))
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/users/:id', () => {

  test('admin can delete a user', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .delete('/api/users/2')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    // DELETE /api/users/:id returns { message: 'User deleted successfully' }
    expect(res.body.message).toMatch(/deleted/i);

    // Verify the user is gone
    const getRes = await request(app)
      .get('/api/users')
      .set(authHeader(token));
    const users = Array.isArray(getRes.body) ? getRes.body : getRes.body.users || [];
    const deletedUser = users.find(u => u.id === 2);
    expect(deletedUser).toBeUndefined();
  });

  test('rejects self-deletion', async () => {
    // Re-create user 2 for testing
    const datalayer = require('../lib/datalayer');
    const bcrypt = require('bcryptjs');
    let user = await datalayer.users.findByEmail(TEST_USER.email);
    if (!user) {
      const hash = await bcrypt.hash('User1234!', 10);
      await datalayer.run(
        `INSERT INTO users (username, name, display_name, email, password_hash, role, avatar, groups, permissions, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['regularuser', 'Regular User', 'Regular User', 'user@test.com', hash, 'user', 'RU', JSON.stringify(['users']), JSON.stringify({}), 1]
      );
    }

    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .delete('/api/users/1')
      .set(authHeader(token));

    // Admin should not be able to delete themselves
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot delete your own account/i);
  });
});

describe('GET /api/users/:id/2fa-status', () => {

  test('admin can view any user 2FA status', async () => {
    const token = createAuthToken({ id: 1, email: TEST_ADMIN.email, role: 'admin' });
    const res = await request(app)
      .get('/api/users/2/2fa-status')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('twoFactorEnabled');
  });

  test('user can view own 2FA status', async () => {
    // Re-create user 2 as it may have been deleted in the DELETE test
    const datalayer = require('../lib/datalayer');
    const bcrypt = require('bcryptjs');
    let user = await datalayer.users.findByEmail(TEST_USER.email);
    if (!user) {
      const hash = await bcrypt.hash('User1234!', 10);
      await datalayer.run(
        `INSERT INTO users (username, name, display_name, email, password_hash, role, avatar, groups, permissions, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['regularuser', 'Regular User', 'Regular User', 'user@test.com', hash, 'user', 'RU', JSON.stringify(['users']), JSON.stringify({}), 1]
      );
    }

    // Re-fetch user to get the correct ID (SQLite AUTOINCREMENT may assign a different ID after deletion)
    user = await datalayer.users.findByEmail(TEST_USER.email);
    const token = createAuthToken({ id: user.id, email: TEST_USER.email });
    const res = await request(app)
      .get(`/api/users/${user.id}/2fa-status`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('twoFactorEnabled');
  });

  test('user cannot view another user 2FA status', async () => {
    const token = createAuthToken({ id: 2, email: TEST_USER.email });
    const res = await request(app)
      .get('/api/users/1/2fa-status')
      .set(authHeader(token));

    // Regular user should not be able to see admin's 2FA status
    expect(res.status).toBe(403);
  });
});
