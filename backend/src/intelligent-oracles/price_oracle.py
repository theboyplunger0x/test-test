# { "Depends": "py-genlayer:latest" }
# FUD.markets — GenLayer Price Oracle
# Uses DexScreener (covers ALL tokens including meme coins, no API key needed)
# Validators reach consensus on the price before returning — nobody can manipulate it.

from genlayer import *
import json
import re


class PriceOracle(gl.Contract):
    symbol: str
    chain: str
    price_usd_micro: u256   # price * 1_000_000_000 for precision (supports sub-penny meme coins)
    resolved: bool

    def __init__(self, symbol: str, chain: str):
        self.symbol = symbol.upper()
        self.chain = chain.lower()
        self.resolved = False

        # DexScreener search endpoint — free, no API key, covers all DEX tokens
        url = f"https://api.dexscreener.com/latest/dex/search?q={symbol}"

        def fetch_price():
            content = gl.nondet.web.render(url, mode="text")

            prompt = f"""
You are parsing a DexScreener API JSON response to find the current price of {symbol}.

The chain we care about: {chain} (solana, base, ethereum, bsc, etc.)

DexScreener API response (first 3000 chars):
{content[:3000]}

Rules:
1. Find pairs where baseToken.symbol == "{symbol}" (case-insensitive)
2. Prefer pairs on the "{chain}" chain
3. If multiple pairs on correct chain, pick the one with highest liquidity.usd
4. If no pairs on that chain, pick the highest-liquidity pair available
5. Use the priceUsd field

Return ONLY a valid JSON object with this exact format:
{{"price_usd": 0.000123456}}

Where price_usd is a decimal number. No markdown, no explanation.
"""
            return gl.nondet.exec_prompt(prompt)

        # ALL validators must return the exact same result (strict consensus)
        json_result = gl.eq_principle.strict_eq(fetch_price)

        clean = re.sub(r'^```(?:json)?\s*|\s*```$', '', json_result.strip())
        data = json.loads(clean)

        price = float(data["price_usd"])
        # Store with 9 decimal places of precision
        self.price_usd_micro = u256(int(price * 1_000_000_000))
        self.resolved = True

    @gl.public.view
    def get_price(self) -> dict:
        price = int(self.price_usd_micro) / 1_000_000_000
        return {
            "symbol": self.symbol,
            "chain": self.chain,
            "price_usd": price,
            "resolved": self.resolved,
        }
