-- Venus: persist the product name + unit printed on each sales line (OESOC), so the
-- reorder-cycle view shows real names even for SKUs absent from the Product catalog.
ALTER TABLE "SaleLine" ADD COLUMN "name" TEXT;
ALTER TABLE "SaleLine" ADD COLUMN "unit" TEXT;
