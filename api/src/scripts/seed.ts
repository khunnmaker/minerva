import { prisma } from '../db/prisma.js';
import { HISTORY_KB } from '../kb/historyKb.js';

// Manual KB (re)seed. Staff logins are NOT handled here — they are reconciled on
// every API boot from env passwords (see api/src/db/ensureSeeded.ts syncStaff),
// so this script never touches the agent table.
//
// NOTE: this re-applies the canonical KB answers — run it for initial setup, not
// after supervisors have edited entries in the console (it would overwrite them).
async function main() {
  // Retire any leftover placeholder sample KB (source 'manual') so it can't feed drafts.
  const archived = await prisma.kbEntry.updateMany({
    where: { source: 'manual', status: 'active' },
    data: { status: 'archived' },
  });
  if (archived.count) {
    // eslint-disable-next-line no-console
    console.log(`archived ${archived.count} placeholder sample KB entries`);
  }

  // Real knowledge base distilled from chat history (idempotent by fixed id).
  for (const k of HISTORY_KB) {
    await prisma.kbEntry.upsert({
      where: { id: k.id },
      update: {
        category: k.category,
        questionVariants: k.questionVariants,
        answer: k.answer,
        sensitivity: k.sensitivity,
        status: 'active',
        source: 'chat-history',
        lastVerifiedAt: new Date(),
      },
      create: {
        id: k.id,
        category: k.category,
        questionVariants: k.questionVariants,
        answer: k.answer,
        sensitivity: k.sensitivity,
        status: 'active',
        source: 'chat-history',
      },
    });
  }
  // eslint-disable-next-line no-console
  console.log(`seeded ${HISTORY_KB.length} KB entries (chat-history)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
