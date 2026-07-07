-- Party (canonical customer/vendor identity — punch #9). ADD-ONLY: two brand-new tables, no
-- change to any existing column. Party is the dedup spine; PartyIdentity.(channel,key) is
-- globally unique. Nothing else is rewired yet — existing tables gain an optional partyId later.

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'customer',
    "displayName" TEXT NOT NULL DEFAULT '',
    "primaryPhone" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyIdentity" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "rawKey" TEXT NOT NULL DEFAULT '',
    "confidence" TEXT NOT NULL DEFAULT 'confirmed',
    "source" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Party_kind_idx" ON "Party"("kind");

-- CreateIndex
CREATE INDEX "Party_mergedIntoId_idx" ON "Party"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyIdentity_channel_key_key" ON "PartyIdentity"("channel", "key");

-- CreateIndex
CREATE INDEX "PartyIdentity_partyId_idx" ON "PartyIdentity"("partyId");

-- AddForeignKey
ALTER TABLE "PartyIdentity" ADD CONSTRAINT "PartyIdentity_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
