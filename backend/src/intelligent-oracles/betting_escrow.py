# { "Depends": "py-genlayer:latest" }
# FUD.markets — On-chain Betting Escrow
# Holds GEN from both sides, resolves price via DexScreener oracle consensus,
# and pays the winner automatically. Fully trustless.

from genlayer import *
import json
import re


class BettingEscrow(gl.Contract):
    # Market config
    symbol: str
    dex_url: str
    timeframe: str
    entry_price: str
    side_a: str          # "long" or "short" — party A's side
    party_a: Address
    party_b: Address

    # State
    deposit_a: u256
    deposit_b: u256
    status: str          # "waiting" | "active" | "resolved" | "cancelled"
    exit_price: str
    winner: Address
    winner_side: str

    def __init__(self, symbol: str, dex_url: str, timeframe: str, entry_price: str, side_a: str, party_a: Address):
        self.symbol = symbol
        self.dex_url = dex_url
        self.timeframe = timeframe
        self.entry_price = entry_price
        self.side_a = side_a
        self.party_a = party_a
        self.party_b = Address("0x0000000000000000000000000000000000000000")

        self.deposit_a = gl.message.value
        self.deposit_b = u256(0)
        self.status = "waiting"
        self.exit_price = "0"
        self.winner = Address("0x0000000000000000000000000000000000000000")
        self.winner_side = ""

    @gl.public.write
    def take_bet(self):
        """Party B takes the other side of the bet."""
        assert self.status == "waiting", "Bet is not open"
        assert gl.message.value > u256(0), "Must send GEN"

        self.party_b = gl.message.sender_address
        self.deposit_b = gl.message.value
        self.status = "active"

    @gl.public.write
    def resolve(self):
        """Fetch exit price via oracle consensus and pay the winner."""
        assert self.status == "active", "Bet is not active"

        # Fetch price from DexScreener via validator consensus
        def fetch_and_parse():
            response = gl.nondet.web.get(self.dex_url)
            body = response.body.decode("utf-8")
            prompt = f"Find the priceUsd for {self.symbol} from this DexScreener data: {body[:2000]}. Pick the pair with highest liquidity. Return ONLY the price number."
            return gl.nondet.exec_prompt(prompt)

        price_str = gl.eq_principle.prompt_comparative(
            fetch_and_parse,
            principle="The price number must be exactly the same"
        )

        self.exit_price = price_str.strip()

        # Determine winner
        entry = float(self.entry_price)
        exit_p = float(self.exit_price)

        if exit_p > entry:
            price_went_up = True
        elif exit_p < entry:
            price_went_up = False
        else:
            # Draw — refund both parties
            self.status = "cancelled"
            gl.get_contract_at(self.party_a).emit_transfer(value=self.deposit_a)
            gl.get_contract_at(self.party_b).emit_transfer(value=self.deposit_b)
            return

        # Long wins if price went up, short wins if down
        if (self.side_a == "long" and price_went_up) or (self.side_a == "short" and not price_went_up):
            self.winner = self.party_a
            self.winner_side = self.side_a
        else:
            self.winner = self.party_b
            self.winner_side = "short" if self.side_a == "long" else "long"

        # Pay winner the full pot (both deposits)
        total = u256(int(self.deposit_a) + int(self.deposit_b))
        gl.get_contract_at(self.winner).emit_transfer(value=total)

        self.status = "resolved"

    @gl.public.write
    def cancel(self):
        """Cancel if party B never showed up. Only party A can cancel."""
        assert self.status == "waiting", "Can only cancel while waiting"
        assert gl.message.sender_address == self.party_a, "Only party A can cancel"

        gl.get_contract_at(self.party_a).emit_transfer(value=self.deposit_a)
        self.status = "cancelled"

    @gl.public.view
    def get_state(self) -> dict:
        return {
            "symbol": self.symbol,
            "timeframe": self.timeframe,
            "entry_price": self.entry_price,
            "exit_price": self.exit_price,
            "side_a": self.side_a,
            "party_a": str(self.party_a),
            "party_b": str(self.party_b),
            "deposit_a": int(self.deposit_a),
            "deposit_b": int(self.deposit_b),
            "status": self.status,
            "winner": str(self.winner),
            "winner_side": self.winner_side,
            "balance": int(self.balance),
        }
