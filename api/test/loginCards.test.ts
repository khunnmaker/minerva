import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('../src/db/prisma.js', () => ({
  prisma: { agent: { findMany: mocks.findMany } },
}));
vi.mock('../src/db/ensureSeeded.js', () => ({
  TIER_ACCOUNTS: [
    { email: 'drm@prominent.local', name: 'Dr. M', role: 'supervisor', group: 'ceo', gender: 'male' },
    { email: 'md@prominent.local', name: 'Nee', role: 'gm', group: 'gm', gender: 'female' },
    { email: 'nun@prominent.local', name: 'Noon', role: 'gm', group: 'gm', gender: 'female' },
  ],
  STAFF: [
    { slug: 'sales', name: 'Sales', apps: ['ceres', 'apollo'], group: 'sales', gender: 'female' },
    { slug: 'nadeer', name: 'Nadeer', apps: ['ceres', 'apollo'], group: 'messengers', gender: 'female' },
    { slug: 'poopae', name: 'Poopae', apps: ['ceres', 'apollo'], role: 'central', group: 'central', gender: 'female' },
    { slug: 'win', name: 'Win', apps: ['ceres', 'apollo'], role: 'central', group: 'central', gender: 'male' },
    // Mail carries the Central Office juno grant; win/poopae deliberately stay without Juno.
    { slug: 'mail', name: 'Mail', apps: ['minerva', 'ceres', 'apollo', 'juno'], role: 'central', group: 'central', gender: 'female' },
    { slug: 'way', name: 'Way', apps: ['minerva', 'juno', 'ceres', 'apollo'], group: 'finance', gender: 'female' },
  ],
  staffEmail: (slug: string) => `${slug}@prominent.local`,
}));
vi.mock('../src/auth/jwt.js', () => ({
  GM_APPS: ['ceres', 'minerva', 'juno', 'apollo'],
}));

import { buildLoginCards } from '../src/auth/loginCards.js';
import { STAFF } from '../src/db/ensureSeeded.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockImplementation(async ({ where }: { where: { email: { in: string[] } } }) =>
    where.email.in.map((email) => ({ email })),
  );
});

describe('buildLoginCards', () => {
  it('returns supervisor, both password GMs, Central Office, then staff in order', async () => {
    const cards = await buildLoginCards('ceres');

    expect(cards.slice(0, 6).map(({ email, kind }) => ({ email, kind }))).toEqual([
      { email: 'drm@prominent.local', kind: 'password' },
      { email: 'md@prominent.local', kind: 'password' },
      { email: 'nun@prominent.local', kind: 'password' },
      { email: 'poopae@prominent.local', kind: 'pin' },
      { email: 'win@prominent.local', kind: 'pin' },
      { email: 'mail@prominent.local', kind: 'pin' },
    ]);
    expect(cards.filter((card) => card.email === 'nun@prominent.local')).toEqual([
      expect.objectContaining({ kind: 'password', group: 'gm', gender: 'female' }),
    ]);
    expect(cards.slice(6).every((card) => card.kind === 'pin')).toBe(true);
    expect(cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'nadeer@prominent.local', group: 'messengers' }),
      expect.objectContaining({ email: 'way@prominent.local', group: 'finance' }),
    ]));
  });

  it('shows juno login cards for Mail and Way, not win or poopae', async () => {
    const cards = await buildLoginCards('juno');
    const emails = cards.map((card) => card.email);
    expect(emails).toContain('mail@prominent.local');
    expect(emails).toContain('way@prominent.local');
    expect(emails).not.toContain('win@prominent.local');
    expect(emails).not.toContain('poopae@prominent.local');
    // gm (Nee/Noon) keep their implicit GM_APPS juno access, unaffected by Mail's per-person grant.
    expect(emails).toEqual(expect.arrayContaining(['md@prominent.local', 'nun@prominent.local']));
  });

  it('removes Nadeer from Minerva cards while admitting Way', async () => {
    const emails = (await buildLoginCards('minerva')).map((card) => card.email);
    expect(emails).not.toContain('nadeer@prominent.local');
    expect(emails).toContain('way@prominent.local');
  });

  it('shows Apollo cards for every declared staff member, including Nadeer and Way', async () => {
    const emails = (await buildLoginCards('apollo')).map((card) => card.email);
    for (const staff of STAFF) {
      expect(emails).toContain(`${staff.slug}@prominent.local`);
    }
  });
});
