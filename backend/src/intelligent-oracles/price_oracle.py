# { "Depends": "py-genlayer:latest" }

from genlayer import *


class PriceOracle(gl.Contract):
    symbol: str
    chain: str
    price: str
    resolved: bool

    def __init__(self, symbol: str, chain: str):
        self.symbol = symbol
        self.chain = chain
        self.price = "0"
        self.resolved = False

    @gl.public.write
    def resolve(self):
        url = f"https://api.dexscreener.com/latest/dex/search?q={self.symbol}"

        def fetch_and_parse():
            response = gl.nondet.web.get(url)
            body = response.body.decode("utf-8")
            prompt = f"Find the priceUsd for {self.symbol} on {self.chain} chain from this DexScreener data: {body[:2000]}. Return ONLY the price number."
            return gl.nondet.exec_prompt(prompt)

        price_str = gl.eq_principle.prompt_comparative(
            fetch_and_parse,
            principle="The price number must be exactly the same"
        )

        self.price = price_str.strip()
        self.resolved = True

    @gl.public.view
    def get_price(self) -> dict:
        return {"symbol": self.symbol, "chain": self.chain, "price": self.price, "resolved": self.resolved}
