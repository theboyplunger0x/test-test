// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title FUDVault v2
 * @notice Singleton USDC vault + parimutuel prediction markets + reward system.
 *
 * Fee split on resolution:
 *  - REWARD_SHARE_BPS of the fee goes to rewardReserve (on-chain, for cashback/referral)
 *  - The rest goes to treasury
 *
 * Reward flow:
 *  1. Market resolves → fee split between treasury and rewardReserve
 *  2. Backend calculates rewards (cashback, referral) based on tiers
 *  3. Operator calls accrueRewards() to credit users from rewardReserve
 *  4. Users call claimRewards() to withdraw accrued rewards to their wallet
 */
contract FUDVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────────────────────

    enum Side { LONG, SHORT }
    enum MarketStatus { Open, Resolved, Cancelled }

    struct Market {
        uint256 id;
        uint256 closesAt;
        uint256 entryPrice;   // 1e8 precision
        uint256 exitPrice;
        uint256 longPool;     // USDC 6 decimals
        uint256 shortPool;
        MarketStatus status;
        Side winningSide;
    }

    struct Bet {
        address user;
        Side side;
        uint256 amount;
        bool claimed;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    address public operator;
    address public treasury;

    uint256 public constant FEE_BPS = 500;           // 5% total fee
    uint256 public constant REWARD_SHARE_BPS = 5000;  // 50% of fee → reward reserve
    uint256 public constant BPS = 10_000;

    uint256 public nextMarketId;

    // User trading balances (deposits)
    mapping(address => uint256) public balances;
    // User accrued rewards (cashback + referral, credited by operator)
    mapping(address => uint256) public rewardBalances;
    // Total reward reserve (funded from fee split, drawn down by accruals)
    uint256 public rewardReserve;

    mapping(uint256 => Market) public markets;
    mapping(uint256 => Bet[]) public bets;

    // EIP-712
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant BET_TYPEHASH = keccak256(
        "Bet(uint256 marketId,address user,uint8 side,uint256 amount,uint256 nonce)"
    );
    mapping(address => uint256) public nonces;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event MarketCreated(uint256 indexed marketId, uint256 closesAt, uint256 entryPrice);
    event BetPlaced(uint256 indexed marketId, address indexed user, Side side, uint256 amount);
    event MarketResolved(uint256 indexed marketId, Side winningSide, uint256 exitPrice, uint256 treasuryFee, uint256 rewardFee);
    event MarketCancelled(uint256 indexed marketId);
    event RewardsAccrued(address indexed user, uint256 amount, uint256 marketId);
    event RewardsClaimed(address indexed user, uint256 amount);
    event OperatorChanged(address indexed newOperator);
    event TreasuryChanged(address indexed newTreasury);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOperator() {
        require(msg.sender == operator, "Not operator");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _usdc, address _operator, address _treasury) Ownable(msg.sender) {
        require(_usdc != address(0), "Zero USDC address");
        require(_operator != address(0), "Zero operator");
        require(_treasury != address(0), "Zero treasury");

        usdc = IERC20(_usdc);
        operator = _operator;
        treasury = _treasury;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("FUDVault"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    // ─── User: Deposit / Withdraw ─────────────────────────────────────────────

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ─── User: Claim Rewards ──────────────────────────────────────────────────

    /**
     * @notice Claim accrued rewards (cashback + referral) to caller's vault balance.
     *         Rewards move from rewardBalances to balances — user can then withdraw
     *         whenever they want via withdraw(). This avoids micro-claims going
     *         directly to the wallet.
     */
    function claimRewards() external nonReentrant {
        uint256 amount = rewardBalances[msg.sender];
        require(amount > 0, "No rewards to claim");
        rewardBalances[msg.sender] = 0;
        balances[msg.sender] += amount;
        emit RewardsClaimed(msg.sender, amount);
    }

    // ─── Operator: Market Management ─────────────────────────────────────────

    function createMarket(uint256 closesAt, uint256 entryPrice) external onlyOperator whenNotPaused returns (uint256 marketId) {
        require(closesAt > block.timestamp, "Closes in past");
        require(entryPrice > 0, "Entry price must be > 0");
        marketId = nextMarketId++;
        markets[marketId] = Market({
            id: marketId,
            closesAt: closesAt,
            entryPrice: entryPrice,
            exitPrice: 0,
            longPool: 0,
            shortPool: 0,
            status: MarketStatus.Open,
            winningSide: Side.LONG
        });
        emit MarketCreated(marketId, closesAt, entryPrice);
    }

    function placeBet(
        uint256 marketId,
        address user,
        Side side,
        uint256 amount,
        uint256 nonce,
        bytes calldata userSig
    ) external onlyOperator nonReentrant whenNotPaused {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.Open, "Market not open");
        require(block.timestamp < market.closesAt, "Market closed");
        require(amount > 0, "Amount must be > 0");
        require(balances[user] >= amount, "Insufficient balance");
        require(nonces[user] == nonce, "Invalid nonce");

        bytes32 structHash = keccak256(abi.encode(BET_TYPEHASH, marketId, user, uint8(side), amount, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = _recoverSigner(digest, userSig);
        require(signer == user, "Invalid signature");

        nonces[user]++;
        balances[user] -= amount;

        if (side == Side.LONG) {
            market.longPool += amount;
        } else {
            market.shortPool += amount;
        }

        bets[marketId].push(Bet({ user: user, side: side, amount: amount, claimed: false }));
        emit BetPlaced(marketId, user, side, amount);
    }

    /**
     * @notice Resolve a market. Fee split: REWARD_SHARE_BPS to rewardReserve, rest to treasury.
     *         Draw (exit == entry) → cancel + refund.
     */
    function resolveMarket(uint256 marketId, uint256 exitPrice) external onlyOperator nonReentrant {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.Open, "Market not open");
        require(exitPrice > 0, "Exit price must be > 0");

        if (exitPrice == market.entryPrice) {
            _cancelAndRefund(marketId);
            return;
        }

        Side winningSide = exitPrice > market.entryPrice ? Side.LONG : Side.SHORT;
        market.status = MarketStatus.Resolved;
        market.winningSide = winningSide;
        market.exitPrice = exitPrice;

        uint256 winPool = winningSide == Side.LONG ? market.longPool : market.shortPool;
        uint256 losePool = winningSide == Side.LONG ? market.shortPool : market.longPool;

        if (winPool == 0) {
            market.status = MarketStatus.Cancelled;
            _refundAll(marketId);
            emit MarketCancelled(marketId);
            return;
        }

        // Fee from loser pool only
        uint256 totalFee = (losePool * FEE_BPS) / BPS;
        uint256 rewardFee = (totalFee * REWARD_SHARE_BPS) / BPS;
        uint256 treasuryFee = totalFee - rewardFee;
        uint256 netLoserPool = losePool - totalFee;

        // Split fee
        balances[treasury] += treasuryFee;
        rewardReserve += rewardFee;

        // Credit winners
        Bet[] storage marketBets = bets[marketId];
        for (uint256 i = 0; i < marketBets.length; i++) {
            Bet storage bet = marketBets[i];
            if (bet.side == winningSide) {
                uint256 payout = bet.amount + (bet.amount * netLoserPool) / winPool;
                balances[bet.user] += payout;
                bet.claimed = true;
            }
        }

        emit MarketResolved(marketId, winningSide, exitPrice, treasuryFee, rewardFee);
    }

    function cancelMarket(uint256 marketId) external onlyOperator nonReentrant {
        _cancelAndRefund(marketId);
    }

    // ─── Operator: Reward Distribution ────────────────────────────────────────

    /**
     * @notice Accrue rewards to users from the reward reserve.
     *         Called by operator after calculating cashback/referral amounts off-chain.
     * @param users Array of user addresses to credit
     * @param amounts Array of USDC amounts (6 decimals) to credit
     * @param marketId The market this reward relates to (for event tracking)
     */
    function accrueRewards(
        address[] calldata users,
        uint256[] calldata amounts,
        uint256 marketId
    ) external onlyOperator nonReentrant {
        require(users.length == amounts.length, "Length mismatch");
        uint256 total = 0;
        for (uint256 i = 0; i < users.length; i++) {
            total += amounts[i];
        }
        require(total <= rewardReserve, "Insufficient reward reserve");

        rewardReserve -= total;
        for (uint256 i = 0; i < users.length; i++) {
            if (amounts[i] > 0) {
                rewardBalances[users[i]] += amounts[i];
                emit RewardsAccrued(users[i], amounts[i], marketId);
            }
        }
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getBets(uint256 marketId) external view returns (Bet[] memory) {
        return bets[marketId];
    }

    function getBetCount(uint256 marketId) external view returns (uint256) {
        return bets[marketId].length;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setOperator(address newOperator) external onlyOwner {
        require(newOperator != address(0), "Zero address");
        operator = newOperator;
        emit OperatorChanged(newOperator);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Zero address");
        treasury = newTreasury;
        emit TreasuryChanged(newTreasury);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _cancelAndRefund(uint256 marketId) internal {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.Open, "Market not open");
        market.status = MarketStatus.Cancelled;
        _refundAll(marketId);
        emit MarketCancelled(marketId);
    }

    function _refundAll(uint256 marketId) internal {
        Bet[] storage marketBets = bets[marketId];
        for (uint256 i = 0; i < marketBets.length; i++) {
            balances[marketBets[i].user] += marketBets[i].amount;
        }
    }

    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(digest, v, r, s);
    }
}
