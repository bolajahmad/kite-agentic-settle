import WDK from "@tetherto/wdk";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
export async function createKiteWallet(seedPhrase, rpcUrl) {
    const wdk = new WDK(seedPhrase).registerWallet("kite", WalletManagerEvm, {
        provider: rpcUrl,
    });
    const account = await wdk.getAccount("kite", 0);
    const address = await account.getAddress();
    return { wdk, account, address };
}
export function generateSeedPhrase() {
    return WDK.getRandomSeedPhrase();
}
