/**
 * Notifications Tests — sendNotification handles events gracefully
 */
const { setupTestEnvironment, teardownTestEnvironment } = require('./helpers');

const notifications = require('../routes/notifications');

beforeAll(async () => {
  await setupTestEnvironment();
});

afterAll(async () => {
  await teardownTestEnvironment();
});

describe('sendNotification()', () => {

  test('handles login event gracefully (no crash)', async () => {
    let error = null;
    try {
      await notifications.sendNotification('login', {
        username: 'Test User',
        email: 'test@test.com',
        ipAddress: '127.0.0.1'
      });
    } catch (e) {
      error = e;
    }
    // sendNotification has internal error handling; should not throw
    expect(error).toBeNull();
  });

  test('handles logout event gracefully', async () => {
    let error = null;
    try {
      await notifications.sendNotification('logout', {
        username: 'Test User',
        email: 'test@test.com',
        ipAddress: '127.0.0.1'
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  });

  test('handles security event gracefully', async () => {
    let error = null;
    try {
      await notifications.sendNotification('security', {
        securityEvent: 'Failed Login Attempt',
        email: 'test@test.com',
        ipAddress: '10.0.0.1',
        severity: 'High'
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  });

  test('handles user-activity event gracefully', async () => {
    let error = null;
    try {
      await notifications.sendNotification('user-activity', {
        username: 'Test User',
        action: 'User Created'
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  });

  test('handles errors event gracefully', async () => {
    let error = null;
    try {
      await notifications.sendNotification('errors', {
        error: 'Something went wrong',
        stack: 'Error: test error',
        type: 'test'
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  });

  test('handles app-start event gracefully', async () => {
    let error = null;
    try {
      await notifications.sendNotification('app-start', {
        message: 'App started',
        port: 3001
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  });

  test('handles app-stop event gracefully', async () => {
    let error = null;
    try {
      await notifications.sendNotification('app-stop', {
        message: 'App stopping',
        reason: 'SIGINT'
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  });

  test('handles unknown event type gracefully', async () => {
    let error = null;
    try {
      await notifications.sendNotification('non-existent-event', {});
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  });

  test('handles empty event data gracefully', async () => {
    let error = null;
    try {
      await notifications.sendNotification('login', {});
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  });
});
