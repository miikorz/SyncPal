# PayPal Sandbox tracking validation

Use the same application code in local development, hosted staging and production.
`PAYPAL_ENVIRONMENT=sandbox` selects PayPal Sandbox; `production` selects PayPal Live.
Hosting location and `NODE_ENV` do not select the payment environment. Keep credentials,
Shopify app identities, PostgreSQL databases and Redis instances separate between deployments.
Do not switch an existing Sandbox database to Live: stored seller connections are environment-specific.

## Prerequisites

- PostgreSQL is running and contains the connected SyncPal shop configuration.
- `.env` contains the Sandbox platform Client ID, secret, BN code and `PAYPAL_ENVIRONMENT=sandbox`.
- The connected seller is a Business Sandbox account, not the platform's own account.
- A distinct Personal Sandbox buyer can approve a EUR 1.00 test payment. Keep its password private.

## Validate PayPal independently

1. Run `npm run sandbox:paypal -- create-payment --shop <shop.myshopify.com>`.
2. Open the returned approval URL and approve with the Personal Sandbox buyer. No real money moves.
   The return page at example.com is a placeholder; save the PayPal order ID from the command.
3. Run `npm run sandbox:paypal -- capture-payment --shop <shop.myshopify.com> --order <paypal-order-id>`.
4. Run the Orders v2 send and verify commands in the next section with that order and capture.
5. Confirm the exact tracker in the verification output. The `send-tracking` and `verify-tracking`
   commands are legacy diagnostics only, not the current application path.
6. Sign in to sandbox.paypal.com as the connected Business seller and inspect the received payment.
   The API read-back is the authoritative tracking check if the Sandbox UI does not expose it.

The script refuses Live configuration. It creates no Shopify orders or synchronization logs.
A successful result proves that the platform can add and read tracking for this Sandbox seller's
test capture; it does not prove access to payments created by Shopify or historical third-party integrations.
If PayPal responds with an authorization error, review the platform capabilities and seller grants.
Do not substitute the platform's own payment for the seller's payment.

### Validate Orders v2 tracking independently

The legacy Tracking API is deprecated. Orders v2 provides
`POST /v2/checkout/orders/{id}/track` and requires both the PayPal order ID and its
seller capture ID. These are not Shopify order or payment IDs.

After completing the EUR 1.00 Sandbox payment above, run:

```bash
npm run sandbox:paypal -- send-order-tracking --shop <shop.myshopify.com> --order <paypal-order-id> --transaction <seller-capture-id> --tracking SYNCPAL-SANDBOX-001 --carrier UPS
npm run sandbox:paypal -- verify-order-tracking --shop <shop.myshopify.com> --order <paypal-order-id> --transaction <seller-capture-id> --tracking SYNCPAL-SANDBOX-001
```

This isolated probe supports UPS only and refuses Live. Before sending, it checks
the order's seller, amount and completed capture against the connected shop.
It sets `notify_payer: false`, skips an already-present capture/tracking pair, and
performs an independent order GET to verify the exact tracker ID and SHIPPED status.
Output excludes tokens, buyer information and full payment responses.

#### Observed result: October 18, 2026

The existing Platform credentials and connected Business Sandbox seller successfully
created and read back tracking with Orders v2:

- PayPal order: `7W418369W11889701`.
- Seller capture: `1KP04409DE262003N`.
- Tracking number: `SYNCPAL-SANDBOX-001`, carrier UPS.
- Preflight order GET: HTTP 200, debug ID `ca4c972b02bc2`.
- Tracking POST: HTTP 201, debug ID `ca4c972b7291c`.
- Independent order GET: HTTP 200, debug ID `ca4c972bcea61`.
- Exact tracker ID: `1KP04409DE262003N-SYNCPAL-SANDBOX-001`, status `SHIPPED`.

This succeeded without enabling `TRACKING_SHIPMENT_READWRITE` on the Platform app.
The previous legacy API 403 and Partner Referrals 422 do not establish that Orders v2
is unavailable. It does not establish Live access or access to Shopify-created payments.
The application worker now uses Orders v2. It resolves the order ID through
`GET /v2/payments/captures/{capture_id}`, checks the completed capture and seller,
and verifies the stored tracker with an independent order GET before recording SUCCESS.
Normal onboarding no longer requests the legacy `TRACKING_SHIPMENT_READWRITE` feature.
The isolated probe above does not create SyncLog rows.

Sources: [Orders v2 tracking endpoint](https://developer.paypal.com/api/orders/v2/orders-track-create)
and [Orders v2 tracking guide](https://developer.paypal.com/api/orders-v2/track-orders/use).

### Authorize legacy tracking for an existing seller

For the legacy Tracking API, Partner Referrals must request `TRACKING_SHIPMENT_READWRITE`. A seller connected before that
feature was requested must grant it explicitly; PAYMENT and REFUND alone do not establish tracking access.
Run `npm run sandbox:paypal -- authorize-tracking --shop <shop.myshopify.com>` and open the
returned link with the same connected Business Sandbox seller. The return page is a placeholder,
and the script does not replace the stored seller. Repeat send-tracking for the existing captured
payment after approval; no additional test purchase is required.

If PayPal still returns HTTP 403, inspect the platform's enabled capabilities and the seller's
granted tracking scopes. A new authorization link alone is not proof that PayPal enabled the API.

If referral creation returns HTTP 422 with `FEATURES_UNAUTHORIZED` for the tracking feature,
the REST app itself is not configured to request that capability. Seller reauthorization cannot
fix this until PayPal enables it. Review the Sandbox platform app's settings; if there is no
tracking option, contact PayPal Merchant Technical Support or your partner representative.
Include the app name, Sandbox environment, requested `TRACKING_SHIPMENT_READWRITE` feature,
endpoint and `debug_id`. Never include the client secret, access token or authorization headers.

Source: [PayPal Partner Referrals feature specification](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/customer_partner_referrals_v2.json).

## Validate Shopify association separately

### Explicit Sandbox fixture

Shopify's Bogus Gateway cannot produce a PayPal capture. To exercise the real webhook,
queue and worker with a Shopify test order, link that one order to a separately captured
Sandbox payment using `PAYPAL_SANDBOX_ORDER_BINDINGS` in `.env`:

```dotenv
PAYPAL_SANDBOX_ORDER_BINDINGS='[{"shopDomain":"example.myshopify.com","shopifyOrderId":"123456789","paypalMerchantId":"ABCDEFGHIJKLM","captureId":"ABCDEFGHIJKLMNOPQ"}]'
```

Replace all example values with actual IDs and restart both the web app and worker.
This fixture requires `PAYPAL_ENVIRONMENT=sandbox`, Shopify `order.test=true`, an exact
shop/order/seller match, and a unique capture binding. Non-empty bindings are rejected
in Live. It does not represent payment reconciliation: the two test payments may have
different amounts or currencies. SUCCESS logs and history explicitly label this source
as a Sandbox test association. Keep the variable empty outside this scoped test.

Fulfill the linked Shopify order with tracking and a carrier while `npm run dev` is
running. Verify the webhook delivery, the worker result, and PayPal read-back; a manual
initial-history sync is not a substitute for checking the webhook itself.

#### Observed webhook-to-worker result: October 18, 2026

- Shopify test order: `#1001`, ID `7027372589127`, Bogus Gateway, USD 13.00.
- Fulfillment created in Shopify Admin: `6622430756935`.
- Tracking: `SYNCPAL-SANDBOX-1001`, UPS; customer notification disabled.
- The real fulfillment webhook enqueued SyncLog `cmve6axkp0001k7mioy7shpoo`.
- Worker result: SUCCESS, one attempt, `associationSource=sandbox_fixture`.
- PayPal order/capture: `7W418369W11889701` / `1KP04409DE262003N`, EUR 1.00.
- Independent PayPal order GET: HTTP 200, debug ID `f748459b459a4`.
- Exact tracker: `1KP04409DE262003N-SYNCPAL-SANDBOX-1001`, SHIPPED.
- Dashboard after Refresh activity: Pending 0, Successful 1, Failed 0.

This verifies webhook ingestion, queue processing and Orders v2 tracking with an explicit
Sandbox fixture. It does not verify automatic reconciliation of a Shopify PayPal payment.
The dashboard currently polls every 10 seconds only while its loaded pending count is
positive; use Refresh activity to discover a new webhook after an idle dashboard.

### Actual Shopify PayPal payments

Use a Shopify order with a successful PayPal SALE or CAPTURE and a provider transaction reference
that belongs to the connected seller in the same PayPal environment. A Shopify Bogus Gateway payment
or a manually marked paid order does not create a PayPal transaction.

The compatibility lookup uses `OrderTransaction.authorizationCode`, which Shopify has deprecated.
It never uses Shopify-specific `paymentId` as a PayPal transaction ID or guesses from `receiptJson`.
Missing references, multiple captures and environment mismatches require manual review.
This association still needs verification against actual Shopify PayPal payment data before Live rollout.

Fulfill the selected order with tracking and carrier, then verify the webhook, queue, worker result
and PayPal tracking read-back. The worker records SUCCESS only after a GET confirms the
exact capture/tracking pair and SHIPPED or DELIVERED status. Access to real Shopify-created
PayPal captures and their order IDs still needs verification before Live rollout.

## Sources

- [Shopify payment ID migration](https://shopify.dev/changelog/deprecation-of-ordertransaction-authorizationcode-in-favor-of-ordertransactionpaymentid)
- [Shopify OrderTransaction](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/OrderTransaction)
- [PayPal Add Tracking integration](https://developer.paypal.com/api/tracking/track-orders/use/)
- [PayPal Orders API](https://developer.paypal.com/docs/api/orders/v2/)
