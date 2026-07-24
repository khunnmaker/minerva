import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  hashPassword: vi.fn(async (value: string) => `test-hash-for:${value}`),
  env: { AGENT_PINS: '', EMPLOYEE_PINS: '', STAFF_PINS: '' },
}));

vi.mock('../src/db/prisma.js', () => ({
  prisma: {
    agent: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      update: mocks.update,
      deleteMany: mocks.deleteMany,
    },
  },
}));
vi.mock('../src/auth/password.js', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: vi.fn(async () => false),
}));
vi.mock('../src/kb/historyKb.js', () => ({ HISTORY_KB: [] }));
vi.mock('../src/memory/embeddings.js', () => ({
  embed: vi.fn(), embeddingsAvailable: vi.fn(() => false), storeKbEmbedding: vi.fn(),
  kbEmbeddingText: vi.fn(), kbTextHash: vi.fn(),
}));
vi.mock('../src/llm/prewarm.js', () => ({ prewarmDraftCache: vi.fn() }));
vi.mock('../src/env.js', () => ({ env: mocks.env }));
vi.mock('../src/catalog/productEmbeddings.js', () => ({ backfillProductEmbeddings: vi.fn() }));

import { STAFF, syncStaff } from '../src/db/ensureSeeded.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SEED_PASSWORD', 'test-supervisor-password');
  vi.stubEnv('GM_PASSWORD', 'test-gm-password');
  vi.stubEnv('MD_PASSWORD', 'test-legacy-fallback-password');
  mocks.env.AGENT_PINS = '';
  mocks.env.EMPLOYEE_PINS = '';
  mocks.env.STAFF_PINS = '';
  mocks.findUnique.mockResolvedValue(null);
  mocks.upsert.mockResolvedValue({});
  mocks.update.mockResolvedValue({});
  mocks.deleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => vi.unstubAllEnvs());

describe('syncStaff role seeding', () => {
  it('upserts Noon from GM_PASSWORD as gm and the three PIN-auth staff as central', async () => {
    mocks.env.EMPLOYEE_PINS = 'poopae:295374,win:306485,mail:417596';

    await syncStaff();

    const writes = mocks.upsert.mock.calls.map(([args]) => args);
    const noon = writes.find((w) => w.where.email === 'nun@prominent.local');
    expect(noon?.update).toMatchObject({ role: 'gm', passwordHash: 'test-hash-for:test-gm-password' });
    expect(noon?.create).toMatchObject({
      email: 'nun@prominent.local',
      role: 'gm',
      passwordHash: 'test-hash-for:test-gm-password',
      apps: [],
    });
    for (const slug of ['poopae', 'win', 'mail']) {
      const write = writes.find((w) => w.where.email === `${slug}@prominent.local`);
      expect(write?.update.role).toBe('central');
      expect(write?.create.role).toBe('central');
    }
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', ''],
    ['present but deprecated', ',nun:928374'],
  ])('a %s nun PIN neither skips Noon nor freezes pruning', async (_label, nunPin) => {
    const allStaffPins = STAFF
      .filter((staff) => staff.slug !== 'nun')
      .map((staff, index) => `${staff.slug}:${200000 + index}`)
      .join(',');
    mocks.env.EMPLOYEE_PINS = `${allStaffPins}${nunPin}`;

    await syncStaff();

    expect(STAFF.some((staff) => staff.slug === 'nun')).toBe(false);
    const noonWrites = mocks.upsert.mock.calls
      .map(([args]) => args)
      .filter((write) => write.where.email === 'nun@prominent.local');
    expect(noonWrites).toHaveLength(1);
    expect(noonWrites[0].update.passwordHash).toBe('test-hash-for:test-gm-password');
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
  });

  it('skips the new Central Office accounts while their PINs are absent and keeps pruning paused', async () => {
    await syncStaff();

    const emails = mocks.upsert.mock.calls.map(([args]) => args.where.email);
    expect(emails).not.toContain('poopae@prominent.local');
    expect(emails).not.toContain('win@prominent.local');
    expect(emails).not.toContain('mail@prominent.local');
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('grants Mail (Central Office) juno access without widening win or poopae (2026-07-21)', () => {
    const mail = STAFF.find((e) => e.slug === 'mail');
    expect(mail?.apps).toContain('juno');
    expect(mail?.role).toBe('central');
    for (const slug of ['win', 'poopae']) {
      const staff = STAFF.find((e) => e.slug === slug);
      expect(staff?.apps).not.toContain('juno');
    }
  });

  it('declares Nadeer with her messenger apps and Way with Benz-equivalent Finance apps', () => {
    const nadeer = STAFF.find((e) => e.slug === 'nadeer');
    expect(nadeer).toMatchObject({
      name: 'นาเดียร์',
      apps: ['ceres', 'apollo'],
      group: 'messengers',
      gender: 'female',
    });

    const benz = STAFF.find((e) => e.slug === 'benz');
    const way = STAFF.find((e) => e.slug === 'way');
    expect(way).toEqual({
      slug: 'way',
      name: 'เวย์',
      apps: ['minerva', 'juno', 'ceres', 'apollo'],
      group: benz?.group,
      gender: benz?.gender,
    });
  });

  it('declares Apollo access for every staff member', () => {
    expect(STAFF.every((staff) => staff.apps.includes('apollo'))).toBe(true);
  });

  it('idempotently resets only Nadeer to her declared grants by email', async () => {
    let nadeerApps = ['minerva', 'ceres', 'apollo'];
    mocks.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) => (
      where.email === 'nadeer@prominent.local'
        ? { passwordHash: 'existing-hash', apps: nadeerApps }
        : null
    ));
    mocks.update.mockImplementation(async ({ data }: { data: { apps: string[] } }) => {
      nadeerApps = [...data.apps];
      return {};
    });

    await syncStaff();
    await syncStaff();

    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { email: 'nadeer@prominent.local' },
      data: { apps: ['ceres', 'apollo'] },
    });
  });

  it('treats Nadeer exact grants in either order as already fixed', async () => {
    mocks.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) => (
      where.email === 'nadeer@prominent.local'
        ? { passwordHash: 'existing-hash', apps: ['apollo', 'ceres'] }
        : null
    ));

    await syncStaff();

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('STAFF_PINS (canonical) overrides a conflicting slug in EMPLOYEE_PINS and AGENT_PINS', async () => {
    mocks.env.AGENT_PINS = 'poopae:111111';
    mocks.env.EMPLOYEE_PINS = 'poopae:222222';
    mocks.env.STAFF_PINS = 'poopae:333333,win:444444,mail:555555';

    await syncStaff();

    const writes = mocks.upsert.mock.calls.map(([args]) => args);
    const poopae = writes.find((w) => w.where.email === 'poopae@prominent.local');
    // hashPassword is called with the raw secret, so the mock hash reveals which PIN won.
    expect(poopae?.create.passwordHash).toBe('test-hash-for:333333');
  });
});
