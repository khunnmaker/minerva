-- Jupiter (accounting / consolidation — "the king"). ADD-ONLY: two brand-new tables, no
-- change to any existing column. JupiterCompany formalises the ad-hoc `entity` code
-- (PROM|DENL) on CeresExpense/CashMovement into the full group; JupiterTxn is a single-line
-- income/expense record feeding the Phase-1 cockpit + close pack (money as TEXT baht, the
-- same free-text convention as Payment/CeresExpense).

-- CreateTable
CREATE TABLE "JupiterCompany" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "nameTh" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#6D28D9',
    "taxId" TEXT NOT NULL DEFAULT '',
    "vatReg" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JupiterCompany_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "JupiterTxn" (
    "id" TEXT NOT NULL,
    "companyCode" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'expense',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "party" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "amount" TEXT NOT NULL DEFAULT '',
    "vatAmount" TEXT NOT NULL DEFAULT '',
    "whtAmount" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JupiterTxn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JupiterTxn_companyCode_date_idx" ON "JupiterTxn"("companyCode", "date");

-- CreateIndex
CREATE INDEX "JupiterTxn_direction_idx" ON "JupiterTxn"("direction");

-- CreateIndex
CREATE INDEX "JupiterTxn_source_idx" ON "JupiterTxn"("source");

-- CreateIndex
CREATE INDEX "JupiterTxn_sourceRef_idx" ON "JupiterTxn"("sourceRef");

-- AddForeignKey
ALTER TABLE "JupiterTxn" ADD CONSTRAINT "JupiterTxn_companyCode_fkey" FOREIGN KEY ("companyCode") REFERENCES "JupiterCompany"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
