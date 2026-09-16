-- CreateTable
CREATE TABLE "PayPalOAuthState" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayPalOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayPalOAuthState_stateHash_key" ON "PayPalOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "PayPalOAuthState_expiresAt_idx" ON "PayPalOAuthState"("expiresAt");

-- AddForeignKey
ALTER TABLE "PayPalOAuthState" ADD CONSTRAINT "PayPalOAuthState_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "ShopConfig"("shopDomain") ON DELETE CASCADE ON UPDATE CASCADE;
