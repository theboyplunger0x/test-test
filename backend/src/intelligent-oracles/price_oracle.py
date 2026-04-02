# { "Depends": "py-genlayer:latest" }

from genlayer import *
import json
import re


class PriceOracle(gl.Contract):
    symbol: str
    chain: str
    price_usd_str: str
    resolved: bool

    def __init__(self, symbol: str, chain: str):
        self.symbol = symbol.upper()
        self.chain = chain.lower()
        self.price_usd_str = "0"
        self.resolved = False

    @gl.public.write
    def resolve(self):
        url = f"https://api.dexscreener.com/latest/dex/search?q={self.symbol}"

        def fetch_and_parse():
            response = gl.nondet.web.get(url)
            body = response.body.decode("utf-8")

            prompt = f"""
You are parsing a DexScreener API JSON response to find the current price of {self.symbol}.

The chain we care about: {self.chain} (solana, base, ethereum, bsc, etc.)

DexScreener API response (first 3000 chars):
{body[:3000]}

Rules:
1. Find pairs where baseToken.symbol == "{self.symbol}" (case-insensitive)
2. Prefer pairs on the "{self.chain}" chain
3. If multiple pairs on correct chain, pick the one with highest liquidity.usd
4. If no pairs on that chain, pick the highest-liquidity pair available
5. Use the priceUsd field

Return ONLY the price as a decimal number string. Example: 0.000003450
No JSON, no markdown, just the number.
"""
            return gl.nondet.exec_prompt(prompt)

        price_str = gl.eq_principle.prompt_comparative(
            fetch_and_parse,
            principle="The price number must be exactly the same"
        )

        self.price_usd_str = price_str.strip()
        self.resolved = True

    @gl.public.view
    def get_price(self) -> dict:
        return {
            "symbol": self.symbol,
            "chain": self.chain,
            "price_usd": self.price_usd_str,
            "resolved": self.resolved,
        }
