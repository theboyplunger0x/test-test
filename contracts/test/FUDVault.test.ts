import { expect } from "chai";
import { ethers } from "hardhat";
import { FUDVault } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("FUDVault", function () {
  let vault: FUDVault;
  let usdc: any;
  let owner: SignerWithAddress;
  let operator: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  const USDC_DECIMALS = 6;
  const usd = (n: number) => ethers.parseUnits(n.toString(), USDC_DECIMALS);
  const PRICE_1E8 = (n: number) => BigInt(Math.round(n * 1e8));

  async function signBet(
    signer: SignerWithAddress,
    marketId: bigint,
    side: number, // 0=LONG, 1=SHORT
    amount: bigint,
    nonce: bigint
  ): Promise<string> {
    const domain = {
      name: "FUDVault",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await vault.getAddress(),
    };
    const types = {
      Bet: [
        { name: "marketId", type: "uint256" },
        { name: "user", type: "address" },
        { name: "side", type: "uint8" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };
    const value = {
      marketId,
      user: signer.address,
      side,
      amount,
      nonce,
    };
    return signer.signTypedData(domain, types, value);
  }

  beforeEach(async function () {
    [owner, operator, treasury, alice, bob, charlie] = await ethers.getSigners();

    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", USDC_DECIMALS);

    // Deploy vault
    const FUDVaultFactory = await ethers.getContractFactory("FUDVault");
    vault = await FUDVaultFactory.deploy(
      await usdc.getAddress(),
      operator.address,
      treasury.address
    );

    // Mint USDC to users and approve vault
    for (const user of [alice, bob, charlie]) {
      await usdc.mint(user.address, usd(10_000));
      await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    }
  });

  // ─── Deposit / Withdraw ─────────────────────────────────────────────────

  it("deposit and withdraw", async function () {
    await vault.connect(alice).deposit(usd(100));
    expect(await vault.balances(alice.address)).to.equal(usd(100));

    await vault.connect(alice).withdraw(usd(40));
    expect(await vault.balances(alice.address)).to.equal(usd(60));
  });

  it("withdraw reverts on insufficient balance", async function () {
    await vault.connect(alice).deposit(usd(10));
    await expect(vault.connect(alice).withdraw(usd(20))).to.be.revertedWith("Insufficient balance");
  });

  it("deposit emits event", async function () {
    await expect(vault.connect(alice).deposit(usd(50)))
      .to.emit(vault, "Deposited")
      .withArgs(alice.address, usd(50));
  });

  // ─── Market Lifecycle ───────────────────────────────────────────────────

  it("create market", async function () {
    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const tx = await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));
    await expect(tx).to.emit(vault, "MarketCreated").withArgs(0, closesAt, PRICE_1E8(100));

    const market = await vault.getMarket(0);
    expect(market.status).to.equal(0); // Open
    expect(market.entryPrice).to.equal(PRICE_1E8(100));
  });

  it("only operator can create market", async function () {
    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await expect(vault.connect(alice).createMarket(closesAt, PRICE_1E8(100)))
      .to.be.revertedWith("Not operator");
  });

  // ─── Place Bet (EIP-712) ────────────────────────────────────────────────

  it("place bet with valid EIP-712 signature", async function () {
    await vault.connect(alice).deposit(usd(100));

    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));

    const sig = await signBet(alice, 0n, 0, usd(50), 0n); // LONG
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(50), 0, sig);

    expect(await vault.balances(alice.address)).to.equal(usd(50));
    const market = await vault.getMarket(0);
    expect(market.longPool).to.equal(usd(50));
  });

  it("revert on invalid signature", async function () {
    await vault.connect(alice).deposit(usd(100));
    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));

    // Bob signs, but we claim it's alice
    const sig = await signBet(bob, 0n, 0, usd(50), 0n);
    await expect(vault.connect(operator).placeBet(0, alice.address, 0, usd(50), 0, sig))
      .to.be.revertedWith("Invalid signature");
  });

  it("revert on wrong nonce", async function () {
    await vault.connect(alice).deposit(usd(100));
    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));

    const sig = await signBet(alice, 0n, 0, usd(50), 1n); // nonce should be 0
    await expect(vault.connect(operator).placeBet(0, alice.address, 0, usd(50), 1, sig))
      .to.be.revertedWith("Invalid nonce");
  });

  // ─── Resolve Market ─────────────────────────────────────────────────────

  it("resolve market — LONG wins, fee from loser pool only", async function () {
    await vault.connect(alice).deposit(usd(100));
    await vault.connect(bob).deposit(usd(100));

    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));

    // Alice bets LONG $100, Bob bets SHORT $100
    const sigA = await signBet(alice, 0n, 0, usd(100), 0n);
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(100), 0, sigA);

    const sigB = await signBet(bob, 0n, 1, usd(100), 0n);
    await vault.connect(operator).placeBet(0, bob.address, 1, usd(100), 0, sigB);

    // Price goes up → LONG wins
    await vault.connect(operator).resolveMarket(0, PRICE_1E8(110));

    const market = await vault.getMarket(0);
    expect(market.status).to.equal(1); // Resolved
    expect(market.winningSide).to.equal(0); // LONG

    // Alice gets: her $100 back + $100 loser pool * 0.95 = $195
    expect(await vault.balances(alice.address)).to.equal(usd(195));
    // Bob gets nothing
    expect(await vault.balances(bob.address)).to.equal(0);
    // Treasury gets 5% of loser pool = $5
    expect(await vault.balances(treasury.address)).to.equal(usd(5));
  });

  it("resolve market — SHORT wins", async function () {
    await vault.connect(alice).deposit(usd(200));
    await vault.connect(bob).deposit(usd(100));

    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));

    // Alice LONG $200, Bob SHORT $100
    const sigA = await signBet(alice, 0n, 0, usd(200), 0n);
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(200), 0, sigA);

    const sigB = await signBet(bob, 0n, 1, usd(100), 0n);
    await vault.connect(operator).placeBet(0, bob.address, 1, usd(100), 0, sigB);

    // Price goes down → SHORT wins
    await vault.connect(operator).resolveMarket(0, PRICE_1E8(90));

    // Bob gets: $100 (stake) + $200 (loser) * 0.95 = $290
    expect(await vault.balances(bob.address)).to.equal(usd(290));
    // Alice gets nothing
    expect(await vault.balances(alice.address)).to.equal(0);
    // Treasury gets 5% of loser pool ($200) = $10
    expect(await vault.balances(treasury.address)).to.equal(usd(10));
  });

  it("resolve market — multiple winners split proportionally", async function () {
    await vault.connect(alice).deposit(usd(300));
    await vault.connect(bob).deposit(usd(100));
    await vault.connect(charlie).deposit(usd(200));

    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));

    // Alice LONG $300, Bob LONG $100, Charlie SHORT $200
    const sigA = await signBet(alice, 0n, 0, usd(300), 0n);
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(300), 0, sigA);

    const sigB = await signBet(bob, 0n, 0, usd(100), 0n);
    await vault.connect(operator).placeBet(0, bob.address, 0, usd(100), 0, sigB);

    const sigC = await signBet(charlie, 0n, 1, usd(200), 0n);
    await vault.connect(operator).placeBet(0, charlie.address, 1, usd(200), 0, sigC);

    // LONG wins
    await vault.connect(operator).resolveMarket(0, PRICE_1E8(110));

    // Loser pool = $200, fee = $10, net = $190
    // Alice: $300 + (300/400) * $190 = $300 + $142.5 = $442.50
    // Bob:   $100 + (100/400) * $190 = $100 + $47.5  = $147.50
    expect(await vault.balances(alice.address)).to.equal(usd(442.5));
    expect(await vault.balances(bob.address)).to.equal(usd(147.5));
    expect(await vault.balances(charlie.address)).to.equal(0);
    expect(await vault.balances(treasury.address)).to.equal(usd(10));
  });

  // ─── Draw (cancel + refund) ─────────────────────────────────────────────

  it("draw (exit == entry) → cancel + full refund", async function () {
    await vault.connect(alice).deposit(usd(100));
    await vault.connect(bob).deposit(usd(100));

    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));

    const sigA = await signBet(alice, 0n, 0, usd(100), 0n);
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(100), 0, sigA);
    const sigB = await signBet(bob, 0n, 1, usd(100), 0n);
    await vault.connect(operator).placeBet(0, bob.address, 1, usd(100), 0, sigB);

    // Exit == Entry → draw
    await vault.connect(operator).resolveMarket(0, PRICE_1E8(100));

    const market = await vault.getMarket(0);
    expect(market.status).to.equal(2); // Cancelled

    // Full refund, no fee
    expect(await vault.balances(alice.address)).to.equal(usd(100));
    expect(await vault.balances(bob.address)).to.equal(usd(100));
    expect(await vault.balances(treasury.address)).to.equal(0);
  });

  // ─── Cancel Market ──────────────────────────────────────────────────────

  it("cancel market refunds all bets", async function () {
    await vault.connect(alice).deposit(usd(100));
    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));

    const sig = await signBet(alice, 0n, 0, usd(100), 0n);
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(100), 0, sig);

    await vault.connect(operator).cancelMarket(0);

    expect(await vault.balances(alice.address)).to.equal(usd(100));
    const market = await vault.getMarket(0);
    expect(market.status).to.equal(2); // Cancelled
  });

  // ─── Pausable ───────────────────────────────────────────────────────────

  it("pause blocks deposits and new markets", async function () {
    await vault.connect(owner).pause();

    await expect(vault.connect(alice).deposit(usd(100))).to.be.reverted;

    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await expect(vault.connect(operator).createMarket(closesAt, PRICE_1E8(100))).to.be.reverted;
  });

  it("pause does not block withdrawals", async function () {
    await vault.connect(alice).deposit(usd(100));
    await vault.connect(owner).pause();

    // Withdraw should still work (users can always exit)
    await vault.connect(alice).withdraw(usd(100));
    expect(await vault.balances(alice.address)).to.equal(0);
  });

  // ─── Access Control ─────────────────────────────────────────────────────

  it("only owner can pause/unpause", async function () {
    await expect(vault.connect(alice).pause()).to.be.reverted;
    await vault.connect(owner).pause();
    await expect(vault.connect(alice).unpause()).to.be.reverted;
    await vault.connect(owner).unpause();
  });

  it("only owner can set operator/treasury", async function () {
    await expect(vault.connect(alice).setOperator(alice.address)).to.be.reverted;
    await expect(vault.connect(alice).setTreasury(alice.address)).to.be.reverted;
  });
});
