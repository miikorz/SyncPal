import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [{ title: "Privacy | SyncPal" }];

export default function Privacy() {
  return (
    <main>
      <h1>Privacy</h1>
      <p>
        SyncPal processes the minimum order-related information needed to send
        fulfillment tracking details to PayPal on a merchant&apos;s behalf.
      </p>

      <h2>Data we process</h2>
      <p>
        SyncPal processes Shopify order and fulfillment identifiers, the PayPal
        transaction identifier, tracking number, carrier, and synchronization
        status. It does not request customer names, email addresses, phone
        numbers, or addresses.
      </p>

      <h2>Purpose and sharing</h2>
      <p>
        We use this information only to synchronize shipment tracking with
        PayPal. Tracking information and the related PayPal transaction
        identifier are sent to PayPal solely for that purpose.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Synchronization logs are retained for up to 90 days for history,
        support, and retry handling. PayPal OAuth tokens are deleted immediately
        when a merchant disconnects PayPal. Shop-related configuration and logs
        are deleted when the app is uninstalled.
      </p>

      <h2>Security</h2>
      <p>
        PayPal OAuth tokens are encrypted before storage and decrypted only in
        memory for API requests. SyncPal uses HTTPS for communications with
        Shopify and PayPal.
      </p>

      <h2>Contact</h2>
      <p>For privacy questions, contact the SyncPal merchant support channel.</p>
    </main>
  );
}