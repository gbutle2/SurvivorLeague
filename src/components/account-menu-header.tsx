import { AccountMenu } from "@/components/account-menu";
import { loadAccountMenuIdentity } from "@/lib/account/load-menu-identity";

/**
 * Server slot that loads the signed-in user's identity for the account menu.
 * Renders nothing when unauthenticated (login / redirects).
 */
export async function AccountMenuHeader() {
  const identity = await loadAccountMenuIdentity();
  if (!identity) {
    return null;
  }

  return (
    <AccountMenu
      displayName={identity.displayName}
      email={identity.email}
    />
  );
}
