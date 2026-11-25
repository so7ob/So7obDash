import { createSign } from 'node:crypto';

type ID = string;
type Progress = { completed: number; total: number; percent: number; title: string };
type Issue = { id: ID; number: number; title: string; state: string; stateReason?: string; url: string; updatedAt?: string };
type Pull = { id: ID; number: number; title: string; state: string; merged?: boolean; draft?: boolean; url: string; baseRef?: string };
type Run = { id: ID; name: string; status: string; conclusion?: string; branch?: string; url: string };
type Release = { id: ID; name: string; tag: string; url: string; publishedAt?: string };
type Milestone = { number: number; title: string; state: string; openIssues: number; closedIssues: number };
type Connection = { id: ID; account: string; ownerType: string; status: string; lastSync?: string };
type Repository = {
  id: ID; owner: string; name: string; fullName: string; private: boolean; defaultBranch: string;
  description?: string; updatedAt?: string; url: string; connectionIds: ID[];
  issues: Issue[]; pulls: Pull[]; runs: Run[]; releases: Release[]; milestones: Milestone[];
  progress: Progress | null; syncStatus: string;
};
type Json = Record<string, unknown>;
type Config = {
  appId: string; privateKey: string; allowedInstallations: Iterable<string | number>;
  fetchImpl?: typeof fetch; progressMilestones?: Readonly<Record<string, number>>;
};
const service = 'https://api.github.com';
const perPage = 100;
const itemPages = 3;
const repoPages = 10;
const record = (x: unknown): Json => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Json : {};
const str = (x: unknown): string => typeof x === 'string' ? x : '';
const optional = (x: unknown): string | undefined => str(x) || undefined;
const num = (x: unknown): number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : 0;
const id = (x: unknown): ID => str(x) || (num(x) ? String(x) : '');
function uniqueRows(items: Json[], getId: (x: Json) => ID = x => id(x.id)): Json[] {
  const seen = new Set<ID>();
  return items.filter(item => {
    const itemId = getId(item);
    if (!itemId || seen.has(itemId)) return false;
    seen.add(itemId);
    return true;
  });
}
const rows = (x: unknown): Json[] => {
  if (!Array.isArray(x) || x.some(v => v === null || typeof v !== 'object' || Array.isArray(v))) throw new Error('malformed response');
  return x as Json[];
};
function appJWT(appId: string, key: string): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (x: unknown): string => Buffer.from(JSON.stringify(x)).toString('base64url');
  const payload = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iat: now - 60, exp: now + 540, iss: appId });
  const signature = createSign('RSA-SHA256').update(payload).sign(key.replace(/\\n/g, '\n')).toString('base64url');
  return payload + '.' + signature;
}
function authFailure(code: number): boolean {
  return code === 401 || code === 403 || code === 404;
}
class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, reason = '') {
    super(reason || `HTTP ${status}`);
    this.status = status;
  }
}
function explain(error: unknown): string {
  return error instanceof GitHubError ? error.message : 'network or response error';
}
export async function syncGitHub({
  appId, privateKey, allowedInstallations, fetchImpl = fetch, progressMilestones = {},
}: Config): Promise<{ mode: 'live'; connections: Connection[]; repositories: Repository[]; syncErrors?: string[] }> {
  const connections: Connection[] = [], syncErrors: string[] = [];
  const repositories = new Map<ID, Repository>();
  const unresolved = new Set<ID>();
  const configured = [...new Set([...allowedInstallations].map(String))];
  if (!configured.length || configured.some(value => !/^[1-9]\d*$/.test(value))) {
    return { mode: 'live', connections, repositories: [], syncErrors: ['No valid explicit installation allowlist.'] };
  }
  if (!appId || !privateKey) return { mode: 'live', connections, repositories: [], syncErrors: ['GitHub App credentials are missing.'] };
  let jwt: string;
  try { jwt = appJWT(appId, privateKey); } catch { return { mode: 'live', connections, repositories: [], syncErrors: ['GitHub App credentials are invalid.'] }; }

  async function request(path: string, token: string, method = 'GET'): Promise<{ json: unknown; hasNext: boolean }> {
    const response = await fetchImpl(service + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(12_000),
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) {
      const rateLimited = response.status === 429 || (response.status === 403 &&
        (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
      throw new GitHubError(rateLimited ? 429 : response.status);
    }
    return { json: await response.json(), hasNext: /\brel="next"/.test(response.headers.get('link') ?? '') };
  }
  async function paginate(path: string, token: string, limit: number, key?: string): Promise<{items: Json[]; partial: boolean; error?: string}> {
    const items: Json[] = [];
    for (let page = 1; page <= limit; page++) {
      try {
        const result = await request(path + (path.includes('?') ? '&' : '?') + `per_page=${perPage}&page=${page}`, token);
        const batch = rows(key ? record(result.json)[key] : result.json);
        items.push(...batch);
        if (!result.hasNext) return { items, partial: false };
      } catch (error) {
        return { items, partial: true, error: explain(error) };
      }
    }
    return { items, partial: true, error: 'page limit reached' };
  }
  const tokens = new Map<ID, string>();
  for (const installationId of configured) {
    const connection: Connection = { id: installationId, account: 'Unknown', ownerType: 'Unknown', status: 'error' };
    connections.push(connection);
    try {
      const installation = record((await request('/app/installations/' + installationId, jwt)).json);
      const account = record(installation.account);
      connection.account = str(account.login) || 'Unknown';
      connection.ownerType = str(account.type) || 'Unknown';
      if (installation.suspended_at) {
        connection.status = 'revoked';
        syncErrors.push(`Installation ${installationId}: suspended.`);
        continue;
      }
      const access = record((await request('/app/installations/' + installationId + '/access_tokens', jwt, 'POST')).json);
      const token = str(access.token);
      if (!token) throw new Error('missing token');
      const result = await paginate('/installation/repositories', token, repoPages, 'repositories');
      if (result.error) {
        syncErrors.push(`Installation ${installationId} repositories: ${result.error}.`);
        const invalidAccess = ['HTTP 401','HTTP 403','HTTP 404'].includes(result.error);
        connection.status = invalidAccess ? 'revoked' : (result.items.length ? 'partial' : 'error');
        if (invalidAccess) continue;
      } else connection.status = 'synced';
      tokens.set(installationId, token);
      if (!result.partial) connection.lastSync = new Date().toISOString();
      for (const entry of result.items) {
        const repoId = id(entry.id), owner = str(record(entry.owner).login), name = str(entry.name);
        if (!repoId || !owner || !name) {
          connection.status = 'partial';
          syncErrors.push(`Installation ${installationId}: omitted a malformed repository.`);
          continue;
        }
        const old = repositories.get(repoId);
        if (old) {
          // Conflicting inventory snapshots can occur during a rename or transfer.
          // Do not select a canonical path by installation order.
          if (old.fullName.toLowerCase() !== (owner + '/' + name).toLowerCase()) {
            unresolved.add(repoId);
            connection.status = 'partial';
            for (const source of connections) {
              if (old.connectionIds.includes(source.id)) source.status = 'partial';
            }
          }
          if (!old.connectionIds.includes(installationId)) old.connectionIds.push(installationId);
          continue;
        }
        repositories.set(repoId, {
          id: repoId, owner, name, fullName: owner + '/' + name, private: entry.private !== false,
          defaultBranch: str(entry.default_branch), description: optional(entry.description), updatedAt: optional(entry.updated_at),
          url: str(entry.html_url), connectionIds: [installationId],
          issues: [], pulls: [], runs: [], releases: [], milestones: [], progress: null, syncStatus: 'synced',
        });
      }
    } catch (error) {
      connection.status = error instanceof GitHubError && authFailure(error.status) ? 'revoked' : 'error';
      syncErrors.push(`Installation ${installationId}: ${explain(error)}.`);
    }
  }
  async function details(repo: Repository): Promise<void> {
    const path = '/repos/' + encodeURIComponent(repo.owner) + '/' + encodeURIComponent(repo.name);
    const fetchDetails = (token: string) => Promise.all([
      paginate(path + '/issues?state=all&sort=updated&direction=desc', token, itemPages),
      paginate(path + '/pulls?state=all&sort=updated&direction=desc', token, itemPages),
      paginate(path + '/actions/runs', token, itemPages, 'workflow_runs'),
      paginate(path + '/releases', token, itemPages),
      paginate(path + '/milestones?state=all', token, itemPages),
    ]);
    const candidates = repo.connectionIds.map(connectionId => tokens.get(connectionId)).filter((t): t is string => !!t);
    let token = candidates.shift();
    if (!token) { repo.syncStatus = 'partial'; return; }
    let datasets = await fetchDetails(token);
    const denied = (set: typeof datasets): boolean => set.every(data => data.error && ['HTTP 401','HTTP 403','HTTP 404'].includes(data.error));
    while (denied(datasets) && candidates.length) {
      const alternate = candidates.shift();
      if (!alternate) break;
      token = alternate;
      datasets = await fetchDetails(token);
    }
    const [issues, pulls, runs, releases, milestones] = datasets;
    const descriptors = [['issues', issues], ['pull requests', pulls], ['actions', runs], ['releases', releases], ['milestones', milestones]] as const;
    for (const [resource, data] of descriptors) {
      if (data.partial) {
        repo.syncStatus = 'partial';
        syncErrors.push(`${repo.fullName} ${resource}: ${data.error ?? 'incomplete'}.`);
      }
    }
    if (denied(datasets)) {
      repo.syncStatus = 'inaccessible';
      return;
    }
    repo.issues = uniqueRows(issues.items.filter(x => !x.pull_request)).map(x => ({
      id: id(x.id), number: num(x.number), title: str(x.title), state: str(x.state),
      stateReason: optional(x.state_reason), url: str(x.html_url), updatedAt: optional(x.updated_at),
    }));
    repo.pulls = uniqueRows(pulls.items).map(x => ({
      id: id(x.id), number: num(x.number), title: str(x.title), state: str(x.state),
      merged: x.merged_at ? true : x.merged_at === null ? false : undefined, draft: typeof x.draft === 'boolean' ? x.draft : undefined,
      url: str(x.html_url), baseRef: optional(record(x.base).ref),
    }));
    repo.runs = uniqueRows(runs.items).map(x => ({
      id: id(x.id), name: str(x.name), status: str(x.status), conclusion: optional(x.conclusion), branch: optional(x.head_branch), url: str(x.html_url),
    }));
    repo.releases = uniqueRows(releases.items.filter(x => x.draft !== true)).map(x => ({
      id: id(x.id), name: str(x.name) || str(x.tag_name), tag: str(x.tag_name), url: str(x.html_url), publishedAt: optional(x.published_at),
    }));
    repo.milestones = uniqueRows(milestones.items, x => id(x.number)).map(x => ({
      number: num(x.number), title: str(x.title), state: str(x.state), openIssues: num(x.open_issues), closedIssues: num(x.closed_issues),
    }));
    const chosen = progressMilestones[repo.id];
    const milestone = Number.isSafeInteger(chosen) ? repo.milestones.find(item => item.number === chosen) : undefined;
    if (!milestone) return;
    const scoped = await paginate(path + '/issues?state=all&milestone=' + milestone.number, token, itemPages);
    if (scoped.partial) {
      repo.syncStatus = 'partial';
      syncErrors.push(`${repo.fullName} milestone scope: ${scoped.error ?? 'incomplete'}.`);
      return;
    }
    const unique = uniqueRows(scoped.items.filter(x => !x.pull_request && !num(record(x.sub_issues_summary).total)));
    let completed = 0, total = 0;
    for (const item of unique) {
      if (item.state === 'open') { total++; continue; }
      if (item.state !== 'closed') return;
      if (item.state_reason === 'completed') { completed++; total++; }
      else if (item.state_reason !== 'not_planned' && item.state_reason !== 'duplicate') return;
    }
    if (scoped.items.some(x => !x.pull_request && !id(x.id))) return;
    if (total) repo.progress = { completed, total, percent: Math.round(completed / total * 1000) / 10, title: milestone.title };
  }
  for (const repoId of unresolved) {
    syncErrors.push('Repository ' + repoId + ': inventory identity unresolved; retry synchronization.');
  }
  const list = [...repositories.values()].filter(repo => !unresolved.has(repo.id));
  for (let i = 0; i < list.length; i += 2) await Promise.all(list.slice(i, i + 2).map(details));
  return { mode: 'live', connections, repositories: list.filter(repo => repo.syncStatus !== 'inaccessible'), ...(syncErrors.length ? { syncErrors } : {}) };
}
