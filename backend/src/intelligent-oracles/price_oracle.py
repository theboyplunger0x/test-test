# { "Depends": "py-genlayer:latest" }

from genlayer import *


class PriceOracle(gl.Contract):
    symbol: str
    url: str
    price: str
    resolved: bool

    def __init__(self, symbol: str, url: str):
        self.symbol = symbol
        self.url = url
        self.price = "0"
        self.resolved = False

    @gl.public.write
    def resolve(self):
        def fetch_and_parse():
            response = gl.nondet.web.get(self.url)
            body = response.body.decode("utf-8")
            prompt = f"Find the priceUsd for {self.symbol} from this DexScreener data: {body[:2000]}. Pick the pair with highest liquidity. Return ONLY the price number."
            return gl.nondet.exec_prompt(prompt)

        price_str = gl.eq_principle.prompt_comparative(
            fetch_and_parse,
            principle="The price number must be exactly the same"
        )

        self.price = price_str.strip()
        self.resolved = True

    @gl.public.view
    def get_price(self) -> dict:
        return {"symbol": self.symbol, "price": self.price, "resolved": self.resolved}
