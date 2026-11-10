import type { NearConnector } from "@hot-labs/near-connect";
import { CONTRACT_ID, NETWORK } from "./config";

let connector: Promise<NearConnector> | null = null;

/** One wallet connector for the page, created on first use and only in the browser. */
function getConnector(): Promise<NearConnector> {
  connector ??= import("@hot-labs/near-connect").then(
    ({ NearConnector }) => new NearConnector({ network: NETWORK, features: { testnet: true }, footerBranding: null }),
  );
  return connector;
}

/** The account already signed in from an earlier visit, if any. */
export async function restoreWallet(): Promise<string | null> {
  try {
    const { accounts } = await (await getConnector()).getConnectedWallet();
    return accounts[0]?.accountId ?? null;
  } catch {
    return null;
  }
}

/** Opens the wallet chooser. Resolves to the account id, or null if the person backs out. */
export async function connectWallet(): Promise<string | null> {
  const c = await getConnector();
  await c.whenManifestLoaded;
  const wallet = await c.connect();
  const accounts = await wallet.getAccounts({ network: NETWORK });
  return accounts[0]?.accountId ?? null;
}

export async function disconnectWallet(): Promise<void> {
  await (await getConnector()).disconnect().catch(() => undefined);
}

/** Calls back whenever the wallet signs in or out, including from another tab's flow. */
export async function onWalletChange(cb: (accountId: string | null) => void): Promise<() => void> {
  const c = await getConnector();
  const signedIn = (e: { accounts: { accountId: string }[] }) => cb(e.accounts[0]?.accountId ?? null);
  const signedOut = () => cb(null);
  c.on("wallet:signIn", signedIn);
  c.on("wallet:signOut", signedOut);
  return () => { c.off("wallet:signIn", signedIn); c.off("wallet:signOut", signedOut); };
}

function failureMessage(failure: unknown): string {
  const text = JSON.stringify(failure);
  const m = /Smart contract panicked: ([^"\\]+)/.exec(text);
  return m ? m[1].trim() : text.slice(0, 300);
}

/**
 * Asks the connected wallet to sign one call to the CarPass contract and
 * waits for the final result. `deposit` is yoctoNEAR.
 */
export async function walletCall(method: string, args: Record<string, unknown>, deposit = "0") {
  const wallet = await (await getConnector()).wallet();
  let outcome;
  try {
    outcome = await wallet.signAndSendTransaction({
      receiverId: CONTRACT_ID,
      actions: [{ type: "FunctionCall", params: { methodName: method, args, gas: "60000000000000", deposit } }],
    });
  } catch (e) {
    throw new Error(failureMessage((e as Error)?.message ?? e));
  }
  const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
  if (status?.Failure) throw new Error(failureMessage(status.Failure));
  let result: unknown = null;
  try {
    result = status?.SuccessValue ? JSON.parse(atob(status.SuccessValue)) : null;
  } catch { /* a non-JSON return value is not needed by the UI */ }
  return { txHash: outcome.transaction.hash as string, result };
}
