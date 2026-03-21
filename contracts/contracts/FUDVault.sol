// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FUDVault
 * @notice USDC vault + prediction markets for FUDmarkets
 *
 * Flow:
 *  1. User calls deposit(amount) → USDC transferred from user to this contract
 *  2. Backend operator calls createMarket() on-chain
 *  3. User signs EIP-712 bet message off-chain, backend calls placeBet() on their behalf
 *  4. Backend calls resolveMarket() after price check → distributes winnings
 *  5. User calls withdraw(amount) to get USDC back
 */
contract FUDVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────────────────────

    enum Side { LONG, SHORT }

    enum MarketStatus { Open, Resolved, Cancelled }

    struct Market {
        uint256 id;
        uint256 closesAt;
        uint256 entryPrice;   // 1e8 precision (same as Chainlink)
        uint256 exitPrice;    // set on resolution
        uint256 longPool;     // total USDC bet LONG (6 decimals)
        uint256 shortPool;    // total USDC bet SHORT (6 decimals)
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

    uint256 public constant FEE_BPS = 500; // 5%
    uint256 public constant BPS = 10_000;

    uint256 public nextMarketId;

    mapping(address => uint256) public balances;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => Bet[]) public bets; // marketId => Bet[]
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

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
    event MarketResolved(uint256 indexed marketId, Side winningSide, uint256 exitPrice);
    event MarketCancelled(uint256 indexed marketId);
    event WinningsClaimed(address indexed user, uint256 indexed marketId, uint256 amount);
    event OperatorChanged(address indexed newOperator);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOperator() {
        require(msg.sender == operator, "Not operator");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _usdc, address _operator, address _treasury) Ownable(msg.sender) {
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

    /**
     * @notice Deposit USDC into vault. User must approve this contract first.
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw USDC from vault to caller's wallet.
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ─── Operator: Market Management ─────────────────────────────────────────

    /**
     * @notice Create a new prediction market.
     */
    function createMarket(uint256 closesAt, uint256 entryPrice) external onlyOperator returns (uint256 marketId) {
        require(closesAt > block.timestamp, "Closes in past");
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

    /**
     * @notice Place a bet on behalf of a user (EIP-712 signed by user).
     * The user signs off-chain; operator submits on-chain.
     */
    function placeBet(
        uint256 marketId,
        address user,
        Side side,
        uint256 amount,
        uint256 nonce,
        bytes calldata userSig
    ) external onlyOperator nonReentrant {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.Open, "Market not open");
        require(block.timestamp < market.closesAt, "Market closed");
        require(amount > 0, "Amount must be > 0");
        require(balances[user] >= amount, "Insufficient balance");
        require(nonces[user] == nonce, "Invalid nonce");

        // Verify EIP-712 signature from user
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
     * @notice Resolve a market. Credits winners' balances.
     * @param winningSide LONG if exit > entry, SHORT if exit < entry
     */
    function resolveMarket(uint256 marketId, Side winningSide, uint256 exitPrice) external onlyOperator nonReentrant {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.Open, "Market not open");

        market.status = MarketStatus.Resolved;
        market.winningSide = winningSide;
        market.exitPrice = exitPrice;

        uint256 totalPool = market.longPool + market.shortPool;
        uint256 fee = (totalPool * FEE_BPS) / BPS;
        uint256 netPool = totalPool - fee;

        // Send fee to treasury balance
        balances[treasury] += fee;

        uint256 winningPool = winningSide == Side.LONG ? market.longPool : market.shortPool;

        // Credit each winner proportionally
        Bet[] storage marketBets = bets[marketId];
        for (uint256 i = 0; i < marketBets.length; i++) {
            Bet storage bet = marketBets[i];
            if (bet.side == winningSide) {
                uint256 payout = (bet.amount * netPool) / winningPool;
                balances[bet.user] += payout;
                bet.claimed = true;
            }
        }

        emit MarketResolved(marketId, winningSide, exitPrice);
    }

    /**
     * @notice Cancel a market and refund all bets.
     */
    function cancelMarket(uint256 marketId) external onlyOperator nonReentrant {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.Open, "Market not open");
        market.status = MarketStatus.Cancelled;

        Bet[] storage marketBets = bets[marketId];
        for (uint256 i = 0; i < marketBets.length; i++) {
            balances[marketBets[i].user] += marketBets[i].amount;
        }

        emit MarketCancelled(marketId);
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
        operator = newOperator;
        emit OperatorChanged(newOperator);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        treasury = newTreasury;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

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
