import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWithSessionRenewal,
  isPantheonSite,
  portalLoginUrl,
  shouldRedirectToPortal,
  wantsLocalLogin,
} from '../../packages/pantheon-ui/src/sso.ts';

interface Agent { id: string }

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shared session renewal fetch', () => {
  it('collapses concurrent 401s into one renewal and retries each request once', async () => {
    let releaseRenewal!: (response: Response) => void;
    const renewal = new Promise<Response>((resolve) => { releaseRenewal = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) return renewal;
      const auth = new Headers(init?.headers).get('authorization');
      return new Response(null, { status: auth === 'Bearer fresh-token' ? 200 : 401 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const setSession = vi.fn();
    const options = { apiUrl: 'https://api.example.test', getToken: () => 'expired-token', setSession };
    const first = fetchWithSessionRenewal<Agent>('https://api.example.test/api/one', { method: 'POST', body: '{}' }, options);
    const second = fetchWithSessionRenewal<Agent>('https://api.example.test/api/two', undefined, options);

    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/me'))).toHaveLength(1));
    releaseRenewal(new Response(JSON.stringify({ token: 'fresh-token', agent: { id: 'a1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(Promise.all([first, second])).resolves.toMatchObject([{ status: 200 }, { status: 200 }]);
    expect(setSession).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('performs only one retry when the renewed bearer is also rejected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/api/auth/me')
      ? new Response(JSON.stringify({ token: 'still-bad', agent: { id: 'a1' } }), { status: 200 })
      : new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSessionRenewal<Agent>(
      'https://api.example.test/api/write',
      { method: 'PATCH', body: '{}' },
      { apiUrl: 'https://api.example.test', getToken: () => 'expired', setSession: vi.fn() },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('portal login redirect decisions', () => {
  it('recognizes only the explicit local=1 break-glass query', () => {
    expect(wantsLocalLogin('?local=1')).toBe(true);
    expect(wantsLocalLogin('?local=true')).toBe(false);
    expect(wantsLocalLogin('?redirect=x&local=0')).toBe(false);
  });

  it('recognizes the production suite domain without admitting lookalikes', () => {
    expect(isPantheonSite('ceres.prominentdental.com')).toBe(true);
    expect(isPantheonSite('prominentdental.com')).toBe(true);
    expect(isPantheonSite('prominentdental.com.example.test')).toBe(false);
  });

  it('redirects only from the production suite while preserving local break-glass', () => {
    expect(shouldRedirectToPortal('', 'ceres.prominentdental.com')).toBe(true);
    expect(shouldRedirectToPortal('?local=1', 'ceres.prominentdental.com')).toBe(false);
    expect(shouldRedirectToPortal('', 'localhost')).toBe(false);
  });

  it('builds a portal URL that preserves the complete Ceres return URL', () => {
    const ceresUrl = 'https://ceres.prominentdental.com/requests/123?tab=mine#detail';
    const redirect = portalLoginUrl('https://pantheon.prominentdental.com/', ceresUrl);
    expect(redirect).toBe(`https://pantheon.prominentdental.com/?redirect=${encodeURIComponent(ceresUrl)}`);
  });
});
