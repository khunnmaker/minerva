// Evidence-gated repair for suspicious Payment.transferAt months.
// Default is a read-only JSONL manifest. Pass --apply to update G1/G2 rows with an optimistic
// id + audited-transferAt guard; MANUAL rows are never written.
import 'dotenv/config';
import { prisma } from '../db/prisma.js';
import { isHealCandidate, selectHealEvidence } from './healTransferAtMonth.helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const apply = process.argv.includes('--apply');

try {
  const payments = await prisma.payment.findMany({
    where: { status: { not: 'void' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      reNumbers: true,
      billNos: true,
      customerName: true,
      amount: true,
      transferAt: true,
      createdAt: true,
      reconciled: true,
      bankMatches: {
        orderBy: { createdAt: 'asc' },
        select: {
          bankTxn: { select: { id: true, amount: true, txnAt: true, direction: true } },
        },
      },
    },
  });
  const targets = payments.filter(isHealCandidate);
  const createdTimes = targets.map((payment) => payment.createdAt.getTime());
  const inboundTxns = createdTimes.length === 0 ? [] : await prisma.bankTxn.findMany({
    where: {
      direction: 'in',
      txnAt: {
        gte: new Date(Math.min(...createdTimes) - 35 * DAY_MS),
        lte: new Date(Math.max(...createdTimes) + 35 * DAY_MS),
      },
    },
    orderBy: [{ txnAt: 'asc' }, { id: 'asc' }],
    select: { id: true, amount: true, txnAt: true, direction: true },
  });

  let g1 = 0;
  let g2 = 0;
  let manual = 0;
  let applied = 0;
  let skipped = 0;

  for (const payment of targets) {
    const evidence = selectHealEvidence(
      payment,
      payment.bankMatches.map((match) => match.bankTxn),
      inboundTxns,
    );
    if (evidence.evidenceClass === 'G1') g1++;
    else if (evidence.evidenceClass === 'G2') g2++;
    else manual++;

    console.log(JSON.stringify({
      id: payment.id,
      REs: payment.reNumbers,
      MBs: payment.billNos,
      name: payment.customerName,
      amount: payment.amount,
      currentTransferAt: payment.transferAt,
      proposed: evidence.proposed,
      evidence: evidence.evidenceClass,
      txnId: evidence.txnId,
      reconciled: payment.reconciled,
    }));

    if (!apply || evidence.evidenceClass === 'MANUAL') continue;
    const result = await prisma.payment.updateMany({
      where: { id: payment.id, transferAt: payment.transferAt },
      data: { transferAt: evidence.proposed },
    });
    if (result.count === 1) {
      applied++;
      console.log(`APPLIED id=${payment.id} evidence=${evidence.evidenceClass} txnId=${evidence.txnId}`);
    } else {
      skipped++;
      console.log(`SKIPPED id=${payment.id} reason=transferAt_changed_since_audit`);
    }
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', targets: targets.length, G1: g1, G2: g2, MANUAL: manual, applied, skipped }));
} finally {
  await prisma.$disconnect();
}
