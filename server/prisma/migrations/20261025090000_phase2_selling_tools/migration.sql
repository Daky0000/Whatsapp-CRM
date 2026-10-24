-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "audioSeconds" INTEGER,
ADD COLUMN     "transcript" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentChannel" TEXT,
ADD COLUMN     "paymentPesewas" INTEGER,
ADD COLUMN     "paymentReference" TEXT,
ADD COLUMN     "paymentUrl" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "dailySummaryEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "dailySummarySentOn" TEXT,
ADD COLUMN     "merchantPaystackKeyEnc" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_paymentReference_key" ON "Order"("paymentReference");

