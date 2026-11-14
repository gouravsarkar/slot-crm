import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transportOptions } from '../src/notifications.js';

test('no SMTP host: emails are only logged', () => {
  assert.deepEqual(transportOptions({ host: '', port: 1025, secure: false, user: '', password: '' }), { jsonTransport: true });
});

test('local catcher (no login): plain connection, no TLS', () => {
  const o = transportOptions({ host: 'mailpit', port: 1025, secure: false, user: '', password: '' });
  assert.equal(o.ignoreTLS, true);
  assert.equal(o.secure, false);
  assert.equal(o.auth, undefined);
});

test('real provider on 465: implicit TLS with login', () => {
  const o = transportOptions({ host: 'smtp.gmail.com', port: 465, secure: true, user: 'me@gmail.com', password: 'app-pass' });
  assert.equal(o.secure, true);
  assert.equal(o.requireTLS, false);
  assert.deepEqual(o.auth, { user: 'me@gmail.com', pass: 'app-pass' });
  assert.equal(o.ignoreTLS, undefined);
});

test('real provider on 587: STARTTLS is mandatory', () => {
  const o = transportOptions({ host: 'smtp.gmail.com', port: 587, secure: false, user: 'me@gmail.com', password: 'p' });
  assert.equal(o.secure, false);
  assert.equal(o.requireTLS, true);
  assert.ok(o.auth);
});
