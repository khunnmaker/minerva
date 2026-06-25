-- Learned cross-sell relationships (anchor product -> cross-sell product, scored).
CREATE TABLE "CrossSellLink" (
    "id" TEXT NOT NULL,
    "anchorSku" TEXT NOT NULL,
    "crossSku" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "shownCount" INTEGER NOT NULL DEFAULT 0,
    "chosenCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrossSellLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrossSellLink_anchorSku_crossSku_key" ON "CrossSellLink"("anchorSku", "crossSku");

-- CreateIndex
CREATE INDEX "CrossSellLink_anchorSku_idx" ON "CrossSellLink"("anchorSku");
