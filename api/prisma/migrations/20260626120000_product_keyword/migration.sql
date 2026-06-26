-- CreateTable: team-taught keyword→product associations
CREATE TABLE "ProductKeyword" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductKeyword_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductKeyword_sku_keyword_key" ON "ProductKeyword"("sku", "keyword");
CREATE INDEX "ProductKeyword_keyword_idx" ON "ProductKeyword"("keyword");
