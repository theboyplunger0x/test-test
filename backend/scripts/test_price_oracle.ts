import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORACLE_PATH = path.join(__dirname, "../src/intelligent-oracles/price_oracle.py");

const account = createAccount(`0x${(process.env.GENLAYER_PRIVATE_KEY ?? "").replace(/^0x/, "")}`);
const rpcUrl = process.env.GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api";

const client = createClient({
  chain: { ...studionet, rpcUrls: { default: { http: [rpcUrl] } } },
  account,
});

async function main() {
  const oracleCode = readFileSync(ORACLE_PATH, "utf-8");
  const symbol = "PEPE";
  const chain = "ethereum";

  console.log(`Step 1: Deploy oracle for ${symbol}/${chain}...`);

  try {
    const deployHash = await client.deployContract({
      code: oracleCode,
      args: [symbol, chain],
      leaderOnly: false,
    });
    console.log("Deploy TX:", deployHash);

    const deployReceipt = await client.waitForTransactionReceipt({
      hash: deployHash,
      status: "FINALIZED",
      retries: 30,
      interval: 2000,
    });

    const addr = deployReceipt.data?.contract_address;
    console.log("Contract address:", addr);

    const execResult = deployReceipt.consensus_data?.leader_receipt?.[0]?.execution_result;
    console.log("Execution result:", execResult);

    if (execResult === "ERROR") {
      console.error("Deploy execution failed:", JSON.stringify(deployReceipt.consensus_data?.leader_receipt?.[0]?.result, null, 2));
      return;
    }

    if (!addr) { console.error("No contract address"); return; }

    console.log(`\nStep 2: Call resolve()...`);
    const resolveHash = await client.writeContract({
      address: addr,
      functionName: "resolve",
      args: [],
      leaderOnly: true,
    });
    console.log("Resolve TX:", resolveHash);

    const resolveReceipt = await client.waitForTransactionReceipt({
      hash: resolveHash,
      status: "FINALIZED",
      retries: 60,
      interval: 3000,
    });
    console.log("Resolve result:", resolveReceipt.consensus_data?.leader_receipt?.[0]?.execution_result);

    console.log(`\nStep 3: Read price...`);
    const result = await client.readContract({
      address: addr,
      functionName: "get_price",
      args: [],
    });
    console.log("Price:", result);
    console.log("\nSUCCESS!");
  } catch (e: any) {
    console.error("FAILED:", e.message);
  }
}

main();
