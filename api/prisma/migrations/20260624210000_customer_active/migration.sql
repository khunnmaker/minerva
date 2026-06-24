-- Per-customer active flag: false hides the chat from the console queue
-- (set when staff tap "จบแชท"); a new inbound message flips it back to true.
ALTER TABLE "Customer" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
