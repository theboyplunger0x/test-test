import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const account = createAccount(`0x${(process.env.GENLAYER_PRIVATE_KEY ?? "").replace(/^0x/, "")}`);
const rpcUrl = process.env.GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api";

const client = createClient({
  chain: { ...studionet, rpcUrls: { default: { http: [rpcUrl] } } },
  account,
});

console.log(`Testing GenLayer at ${rpcUrl}...`);

const code = `
from genlayer import *
class Test(gl.Contract):
    value: str
    def __init__(self):
        self.value = "hello"
    @gl.public.view
    def get_value(self) -> str:
        return self.value
`;

async function main() {
  try {
    console.log("Deploying test contract...");
    const hash = await client.deployContract({ code, args: [], leaderOnly: false });
    console.log("TX hash:", hash);

    console.log("Waiting for receipt...");
    const receipt = await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 15, interval: 2000 });
    console.log("Receipt:", JSON.stringify(receipt?.data, null, 2));
    console.log("SUCCESS — GenLayer is working!");
  } catch (e: any) {
    console.error("FAILED:", e.message);
    if (e.cause) console.error("Cause:", e.cause);
  }
}

main();
