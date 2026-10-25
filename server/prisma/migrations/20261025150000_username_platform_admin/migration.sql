-- AlterTable
ALTER TABLE "User" ADD COLUMN     "platformAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

