import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { syncGitHub } from './github.ts';

let privateKey, publicKey;
before(() => { ({ privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})); });

const ok = (data, next = false) => Response.json(data, { headers: next ? { Link: '<https://evil.invalid>; rel="next"' } : {} });
const repo = (id, login, name = 'same') => ({ id, owner: { login }, name, default_branch: 'main', private: true, html_url: 'https://github.com/' + login + '/' + name });
const issue = (id, state, state_reason) => ({ id, number: id, title: 'Issue ' + id, state, state_reason });

function environment(overrides = {}) {
  const calls = [];
  const fetchImpl = async (input, options) => {
    const u = new URL(input);
    const h = new Headers(options.headers);
    calls.push({ method: options.method, path: u.pathname, query: u.searchParams, auth: h.get('authorization') });
    assert.equal(u.host, 'api.github.com');
    assert.equal(options.redirect, 'error');
    const app = u.pathname.match(/^\/app\/installations\/(\d+)(\/access_tokens)?$/);
    if (app) {
      if (overrides.revoke && app[1] === overrides.revoke) return Response.json({}, { status: 404 });
      const [head, claims, sig] = h.get('authorization').slice(7).split('.');
      assert.equal(JSON.parse(Buffer.from(head, 'base64url')).alg, 'RS256');
      assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).iss, 'test-app');
      assert.ok(createVerify('RSA-SHA256').update(head + '.' + claims).verify(publicKey, Buffer.from(sig, 'base64url')));
      if (app[2]) {
        assert.equal(options.method, 'POST'); // Only write-shaped call is authentication.
        return ok({ token: 't' + app[1] });
      }
      assert.equal(options.method, 'GET');
      return ok({ account: { login: 'owner-' + app[1], type: 'Organization' } });
    }
    if (u.pathname === '/installation/repositories') {
      if (h.get('authorization') === 'Bearer t1') {
        return u.searchParams.get('page') === '1' ? ok({ repositories: [repo(100, 'alpha')] }, true) : ok({ repositories: [repo(200, 'beta')] });
      }
      if (overrides.empty) return ok({ repositories: [] });
      return ok({ repositories: [repo(100, 'alpha')] });
    }
    assert.equal(options.method, 'GET');
    if (overrides.denyDetails && h.get('authorization') === 'Bearer t1') return Response.json({}, { status: 404 });
    if (u.pathname.endsWith('/actions/runs')) {
      if (overrides.capped) return ok({ workflow_runs: [{ id: +u.searchParams.get('page'), name: 'CI', status: 'completed', conclusion: 'success' }] }, true);
      if (overrides.rate) return Response.json({}, { status: 403, headers: { 'Retry-After': '30' } });
      return ok({ workflow_runs: [] });
    }
    if (u.pathname.endsWith('/issues')) {
      if (u.searchParams.has('milestone') && overrides.invalidScope) return ok([issue(2, 'closed')]);
      return ok([issue(1, 'closed', 'completed'), issue(1, 'closed', 'completed'), issue(2, 'open'), issue(3, 'closed', 'not_planned'), { ...issue(4, 'closed', 'completed'), pull_request: {} }, { ...issue(5, 'closed', 'completed'), sub_issues_summary: { total: 2 } }]);
    }
    if (u.pathname.endsWith('/pulls')) return ok([{ id: 4, number: 4, title: 'PR', state: 'closed', merged_at: '2026-01-01' }]);
    if (u.pathname.endsWith('/milestones')) return ok([{ number: 7, title: 'Phase 1', state: 'open', open_issues: 1, closed_issues: 3 }]);
    if (u.pathname.endsWith('/releases')) return ok([{ id: 9, tag_name: 'v0.1.0' }, { id: 10, tag_name: 'draft', draft: true }]);
    throw new Error('Unexpected ' + u.pathname);
  };
  return { calls, run: (allowedInstallations, progressMilestones) => syncGitHub({ appId: 'test-app', privateKey, allowedInstallations, progressMilestones, fetchImpl }) };
}

test('fail closed unless installation allowlist is explicit and valid', async () => {
  const { calls, run } = environment();
  assert.equal((await run([])).repositories.length, 0);
  assert.equal((await run(['1', 'all'])).repositories.length, 0);
  assert.equal(calls.length, 0);
});

test('signed auth, bounded pagination, stable repository IDs, explicit progress, no PR/cancelled credit', async () => {
  const { calls, run } = environment();
  const result = await run(['1', '2', '1'], { 100: 7 });
  assert.deepEqual(result.connections.map(c => [c.id, c.status]), [['1', 'synced'], ['2', 'synced']]);
  assert.equal(result.syncErrors, undefined);
  assert.deepEqual(result.repositories.map(r => r.fullName), ['alpha/same', 'beta/same']);
  assert.deepEqual(result.repositories[0].connectionIds, ['1', '2']);
  assert.deepEqual(result.repositories[0].progress, { completed: 1, total: 2, percent: 50, title: 'Phase 1' });
  assert.equal(result.repositories[1].progress, null);
  assert.deepEqual(result.repositories[0].issues.map(i => i.number), [1, 2, 3, 5]);
  assert.equal(result.repositories[0].pulls[0].merged, true);
  assert.deepEqual(result.repositories[0].releases.map(r => r.tag), ['v0.1.0']);
  assert.equal(calls.filter(x => x.path === '/app/installations/1/access_tokens').length, 1);
});

test('rate limit and missing closure evidence are not interpreted as empty and zero progress', async () => {
  const { run } = environment({ invalidScope: true, rate: true });
  const result = await run([2], { 100: 7 });
  assert.equal(result.repositories[0].progress, null);
  assert.equal(result.repositories[0].syncStatus, 'partial');
  assert.match(result.syncErrors.join(' '), /429/);
});

test('capped result stays partial and fails closed on revoked installation', async () => {
  const { run } = environment({ capped: true, revoke: '2' });
  const result = await run([1, 2]);
  assert.equal(result.connections[1].status, 'revoked');
  assert.equal(result.repositories[0].runs.length, 3);
  assert.deepEqual(result.repositories[0].connectionIds, ['1']);
  assert.match(result.syncErrors.join(' '), /page limit reached/);
});

test('zero repositories in a successful installation is a valid result', async () => {
  const { run } = environment({ empty: true });
  const result = await run([2]);
  assert.equal(result.connections[0].status, 'synced');
  assert.deepEqual(result.repositories, []);
  assert.equal(result.syncErrors, undefined);
});


test('repository lost during synchronization is hidden unless another allowed installation can still read it', async () => {
  const { run } = environment({ denyDetails: true });
  const result = await run([1, 2]);
  assert.deepEqual(result.repositories.map(r => r.fullName), ['alpha/same']);
  assert.equal(result.repositories[0].syncStatus, 'synced');
});
