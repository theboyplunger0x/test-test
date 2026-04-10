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
    signer: SignerWithAddress, marketId: bigint, side: number, amount: bigint, nonce: bigint
  ): Promise<string> {
    const domain = {
      name: "FUDVault", version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await vault.getAddress(),
    };
    const types = {
      Bet: [
        { name: "marketId", type: "uint256" }, { name: "user", type: "address" },
        { name: "side", type: "uint8" }, { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };
    return signer.signTypedData(domain, types, {
      marketId, user: signer.address, side, amount, nonce,
    });
  }

  beforeEach(async function () {
    [owner, operator, treasury, alice, bob, charlie] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", USDC_DECIMALS);
    const FUDVaultFactory = await ethers.getContractFactory("FUDVault");
    vault = await FUDVaultFactory.deploy(await usdc.getAddress(), operator.address, treasury.address);
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

  // ─── Resolve: fee split treasury + reward reserve ───────────────────────

  it("resolve — fee split 50/50 between treasury and reward reserve", async function () {
    await vault.connect(alice).deposit(usd(100));
    await vault.connect(bob).deposit(usd(100));

    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));

    const sigA = await signBet(alice, 0n, 0, usd(100), 0n); // LONG
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(100), 0, sigA);
    const sigB = await signBet(bob, 0n, 1, usd(100), 0n); // SHORT
    await vault.connect(operator).placeBet(0, bob.address, 1, usd(100), 0, sigB);

    await vault.connect(operator).resolveMarket(0, PRICE_1E8(110)); // LONG wins

    // Fee = 5% of $100 loser pool = $5
    // Treasury gets 50% of fee = $2.50
    // Reward reserve gets 50% = $2.50
    // Alice: $100 + ($100 - $5) * 100/100 = $195
    expect(await vault.balances(alice.address)).to.equal(usd(195));
    expect(await vault.balances(bob.address)).to.equal(0);
    expect(await vault.balances(treasury.address)).to.equal(usd(2.5));
    expect(await vault.rewardReserve()).to.equal(usd(2.5));
  });

  it("resolve — multiple winners proportional split", async function () {
    await vault.connect(alice).deposit(usd(300));
    await vault.connect(bob).deposit(usd(100));
    await vault.connect(charlie).deposit(usd(200));

    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));

    const sigA = await signBet(alice, 0n, 0, usd(300), 0n);
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(300), 0, sigA);
    const sigB = await signBet(bob, 0n, 0, usd(100), 0n);
    await vault.connect(operator).placeBet(0, bob.address, 0, usd(100), 0, sigB);
    const sigC = await signBet(charlie, 0n, 1, usd(200), 0n);
    await vault.connect(operator).placeBet(0, charlie.address, 1, usd(200), 0, sigC);

    await vault.connect(operator).resolveMarket(0, PRICE_1E8(110)); // LONG wins

    // Fee = 5% of $200 = $10. Treasury $5, Reserve $5
    // Net loser = $200 - $10 = $190
    // Alice: $300 + 300/400 * $190 = $300 + $142.50 = $442.50
    // Bob: $100 + 100/400 * $190 = $100 + $47.50 = $147.50
    expect(await vault.balances(alice.address)).to.equal(usd(442.5));
    expect(await vault.balances(bob.address)).to.equal(usd(147.5));
    expect(await vault.balances(treasury.address)).to.equal(usd(5));
    expect(await vault.rewardReserve()).to.equal(usd(5));
  });

  // ─── Draw + Cancel ──────────────────────────────────────────────────────

  it("draw → cancel + full refund, no fee", async function () {
    await vault.connect(alice).deposit(usd(100));
    await vault.connect(bob).deposit(usd(100));
    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));
    const sigA = await signBet(alice, 0n, 0, usd(100), 0n);
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(100), 0, sigA);
    const sigB = await signBet(bob, 0n, 1, usd(100), 0n);
    await vault.connect(operator).placeBet(0, bob.address, 1, usd(100), 0, sigB);

    await vault.connect(operator).resolveMarket(0, PRICE_1E8(100)); // draw

    expect(await vault.balances(alice.address)).to.equal(usd(100));
    expect(await vault.balances(bob.address)).to.equal(usd(100));
    expect(await vault.rewardReserve()).to.equal(0);
  });

  it("cancel refunds all", async function () {
    await vault.connect(alice).deposit(usd(100));
    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));
    const sig = await signBet(alice, 0n, 0, usd(100), 0n);
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(100), 0, sig);
    await vault.connect(operator).cancelMarket(0);
    expect(await vault.balances(alice.address)).to.equal(usd(100));
  });

  // ─── Reward System ──────────────────────────────────────────────────────

  it("accrueRewards credits users from reward reserve", async function () {
    // First create some reward reserve via a market resolution
    await vault.connect(alice).deposit(usd(100));
    await vault.connect(bob).deposit(usd(100));
    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));
    const sigA = await signBet(alice, 0n, 0, usd(100), 0n);
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(100), 0, sigA);
    const sigB = await signBet(bob, 0n, 1, usd(100), 0n);
    await vault.connect(operator).placeBet(0, bob.address, 1, usd(100), 0, sigB);
    await vault.connect(operator).resolveMarket(0, PRICE_1E8(110));

    // Reserve should have $2.50
    expect(await vault.rewardReserve()).to.equal(usd(2.5));

    // Operator accrues $1 cashback to alice, $0.50 referral to charlie
    await vault.connect(operator).accrueRewards(
      [alice.address, charlie.address],
      [usd(1), usd(0.5)],
      0
    );

    expect(await vault.rewardBalances(alice.address)).to.equal(usd(1));
    expect(await vault.rewardBalances(charlie.address)).to.equal(usd(0.5));
    expect(await vault.rewardReserve()).to.equal(usd(1)); // 2.5 - 1.5 = 1
  });

  it("accrueRewards reverts if exceeds reserve", async function () {
    await vault.connect(alice).deposit(usd(100));
    await vault.connect(bob).deposit(usd(100));
    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));
    const sigA = await signBet(alice, 0n, 0, usd(100), 0n);
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(100), 0, sigA);
    const sigB = await signBet(bob, 0n, 1, usd(100), 0n);
    await vault.connect(operator).placeBet(0, bob.address, 1, usd(100), 0, sigB);
    await vault.connect(operator).resolveMarket(0, PRICE_1E8(110));

    // Try to accrue more than reserve ($2.50)
    await expect(
      vault.connect(operator).accrueRewards([alice.address], [usd(10)], 0)
    ).to.be.revertedWith("Insufficient reward reserve");
  });

  it("claimRewards moves rewards to vault balance (not wallet)", async function () {
    await vault.connect(alice).deposit(usd(100));
    await vault.connect(bob).deposit(usd(100));
    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));
    const sigA = await signBet(alice, 0n, 0, usd(100), 0n);
    await vault.connect(operator).placeBet(0, alice.address, 0, usd(100), 0, sigA);
    const sigB = await signBet(bob, 0n, 1, usd(100), 0n);
    await vault.connect(operator).placeBet(0, bob.address, 1, usd(100), 0, sigB);
    await vault.connect(operator).resolveMarket(0, PRICE_1E8(110));

    // Accrue $2 to alice
    await vault.connect(operator).accrueRewards([alice.address], [usd(2)], 0);

    const balanceBefore = await vault.balances(alice.address);
    const walletBefore = await usdc.balanceOf(alice.address);
    await vault.connect(alice).claimRewards();

    // Rewards go to vault balance, NOT to wallet
    expect(await vault.balances(alice.address)).to.equal(balanceBefore + usd(2));
    expect(await usdc.balanceOf(alice.address)).to.equal(walletBefore); // wallet unchanged
    expect(await vault.rewardBalances(alice.address)).to.equal(0);
  });

  it("claimRewards reverts with no rewards", async function () {
    await expect(vault.connect(alice).claimRewards()).to.be.revertedWith("No rewards to claim");
  });

  // ─── Pausable ───────────────────────────────────────────────────────────

  it("pause blocks deposits, not withdrawals", async function () {
    await vault.connect(alice).deposit(usd(100));
    await vault.connect(owner).pause();
    await expect(vault.connect(alice).deposit(usd(100))).to.be.reverted;
    await vault.connect(alice).withdraw(usd(100)); // should work
  });

  // ─── Access Control ─────────────────────────────────────────────────────

  it("only operator can accrue rewards", async function () {
    await expect(
      vault.connect(alice).accrueRewards([alice.address], [usd(1)], 0)
    ).to.be.revertedWith("Not operator");
  });

  it("only owner can set operator/treasury", async function () {
    await expect(vault.connect(alice).setOperator(alice.address)).to.be.reverted;
    await expect(vault.connect(alice).setTreasury(alice.address)).to.be.reverted;
  });

  // ─── EIP-712 ────────────────────────────────────────────────────────────

  it("revert on invalid signature", async function () {
    await vault.connect(alice).deposit(usd(100));
    const closesAt = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    await vault.connect(operator).createMarket(closesAt, PRICE_1E8(100));
    const sig = await signBet(bob, 0n, 0, usd(50), 0n);
    await expect(vault.connect(operator).placeBet(0, alice.address, 0, usd(50), 0, sig))
      .to.be.revertedWith("Invalid signature");
  });
});
