// HD Wallet — deterministic deposit address derivation
// EVM:     BIP44 m/44'/60'/0'/0/{index}
// Solana:  BIP44 m/44'/501'/{index}'/0'

import { HDKey }              from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { publicKeyToAddress } from "viem/accounts";
import { Keypair }            from "@solana/web3.js";
import { derivePath }         from "ed25519-hd-key";

let _seed: Buffer | null = null;
let _hdKey: HDKey | null = null;

function getSeed(): Buffer {
  if (!_seed) {
    const mnemonic = process.env.HD_MNEMONIC;
    if (!mnemonic) throw new Error("HD_MNEMONIC env var not set");
    _seed = Buffer.from(mnemonicToSeedSync(mnemonic));
  }
  return _seed;
}

function getHDKey(): HDKey {
  if (!_hdKey) _hdKey = HDKey.fromMasterSeed(getSeed());
  return _hdKey;
}

export function deriveEvmAddress(index: number): string {
  const child = getHDKey().derive(`m/44'/60'/0'/0/${index}`);
  if (!child.publicKey) throw new Error("Failed to derive EVM key");
  return publicKeyToAddress(`0x${Buffer.from(child.publicKey).toString("hex")}`);
}

export function deriveEvmPrivateKey(index: number): `0x${string}` {
  const child = getHDKey().derive(`m/44'/60'/0'/0/${index}`);
  if (!child.privateKey) throw new Error("Failed to derive EVM private key");
  return `0x${Buffer.from(child.privateKey).toString("hex")}`;
}

export function deriveSolAddress(index: number): string {
  const path = `m/44'/501'/${index}'/0'`;
  const { key } = derivePath(path, getSeed().toString("hex"));
  return Keypair.fromSeed(key).publicKey.toBase58();
}

export function deriveSolKeypair(index: number): Keypair {
  const path = `m/44'/501'/${index}'/0'`;
  const { key } = derivePath(path, getSeed().toString("hex"));
  return Keypair.fromSeed(key);
}
