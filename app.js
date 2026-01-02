// Updated app.js with referrer autofill, default fallback, user referral link, and downline summary

const STAKING_CONTRACT_ADDRESS = "0xd485183b9e0e3f053ae6235b61ef16733dc7b085";
const ZAMT_TOKEN_ADDRESS = "0xb3bDB7926ba1F781f2E0b7c91C0b89eb72e79a3c";
const DEFAULT_REFERRER = "0x7763F9b5cd1C70Cd26aaf38aD037741B9910B76f";

let stakingABI, zamtABI;
let signer, provider, stakingContract, zamtToken, userAddress;

async function init() {
    const stakingResponse = await fetch("abi/ZAMTStakingNexus.json");
    const stakingJson = await stakingResponse.json();
    stakingABI = stakingJson.abi;

    zamtABI = [
        "function balanceOf(address) view returns (uint256)",
        "function approve(address spender, uint256 amount) public returns (bool)",
        "function decimals() view returns (uint8)",
        "function allowance(address owner, address spender) view returns (uint256)"
    ];

    document.getElementById("connectBtn").addEventListener("click", connectWallet);
    document.getElementById("stakeBtn").addEventListener("click", stakeZAMT);

    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && ethers.isAddress(ref)) {
        document.getElementById("referrer").value = ref;
    }
}

async function loadRewardSummary() {
    try {
        const [stakeRewards, referralBonuses, downlineRewards] = await Promise.all([
            stakingContract.userStakingRewards(userAddress),
            stakingContract.userReferralBonuses(userAddress),
            stakingContract.userDownlineRewards(userAddress)
        ]);

        const decimals = await zamtToken.decimals();
        const format = (val) => ethers.formatUnits(val, decimals);

        document.getElementById("totalStakeRewards").innerText = `${format(stakeRewards)} ZAMT`;
        document.getElementById("referralBonuses").innerText = `${format(referralBonuses)} ZAMT`;
        document.getElementById("downlineRewards").innerText = `${format(downlineRewards)} ZAMT`;

    } catch (err) {
        console.error("Error loading reward summary:", err);
    }
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000); // convert seconds to milliseconds
    const pad = (n) => n.toString().padStart(2, '0');

    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1); // months are 0-based
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function calculateNextClaimTime(lastClaimInput) {
  // Accept either a Date object or a timestamp (ms or seconds)
  let lastClaimMs;
  if (lastClaimInput instanceof Date) {
    lastClaimMs = lastClaimInput.getTime();
  } else if (typeof lastClaimInput === 'number') {
    // treat as seconds if clearly small, otherwise as ms
    lastClaimMs = lastClaimInput > 1e12 ? lastClaimInput : lastClaimInput * 1000;
  } else {
    // invalid input -> return a Date for now to avoid throwing downstream
    return new Date();
  }

  const DAY_MS = 24 * 3600 * 1000;
  const now = Date.now();

  // Move forward in 24h intervals until we get a future reward time
  let nextClaimMs = lastClaimMs;
  // Safety: if lastClaim is somehow in far future, we still return it as-is
  if (nextClaimMs <= now) {
    // advance until > now
    while (nextClaimMs <= now) {
      nextClaimMs += DAY_MS;
      // optional safety guard (prevent infinite loop in pathological cases)
      // if you want to cap how far we can advance uncomment the next lines:
      // if (nextClaimMs - lastClaimMs > 365 * DAY_MS) break;
    }
  }

  return new Date(nextClaimMs);
}

function formatClaimTimestamp(date) {
    // Format: "December 28th, 2026, 10:56 PM (in 2 days 3 hours)"
    const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'Asia/Karachi' });
    const day = date.getDate();
    const year = date.getFullYear();
    const time = date.toLocaleString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true, 
        timeZone: 'Asia/Karachi' 
    });
    
    // Add ordinal suffix to day
    const ordinalSuffix = getOrdinalSuffix(day);
    
    // Get relative time string
    const relativeTimeString = getRelativeTimeString(date);
    
    return `${month} ${day}${ordinalSuffix}, ${year}, ${time} (${relativeTimeString})`;
}

function getOrdinalSuffix(day) {
    if (day >= 11 && day <= 13) {
        return 'th';
    }
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

function getRelativeTimeString(targetDate) {
    const now = new Date();
    const diffMs = targetDate.getTime() - now.getTime();
    const isFuture = diffMs > 0;
    const absDiffMs = Math.abs(diffMs);
    
    // Convert to seconds
    let remainingSeconds = Math.floor(absDiffMs / 1000);
    
    // Calculate time units
    const days = Math.floor(remainingSeconds / 86400);
    remainingSeconds %= 86400;
    
    const hours = Math.floor(remainingSeconds / 3600);
    remainingSeconds %= 3600;
    
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    
    // Build array of non-zero time units (max 2)
    const units = [];
    
    if (days > 0 && units.length < 2) {
        units.push(`${days} day${days !== 1 ? 's' : ''}`);
    }
    if (hours > 0 && units.length < 2) {
        units.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    }
    if (minutes > 0 && units.length < 2) {
        units.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    }
    if (seconds > 0 && units.length < 2) {
        units.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
    }
    
    // If no units found (target is very close), show "moments"
    if (units.length === 0) {
        return 'in moments';
    }
    
    const prefix = isFuture ? 'in' : 'ago';
    return `${prefix} ${units.join(' ')}`;
}

async function connectWallet() {
    if (!window.ethereum) {
        alert("Please install MetaMask!");
        return;
    }

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    stakingContract = new ethers.Contract(STAKING_CONTRACT_ADDRESS, stakingABI, signer);
    zamtToken = new ethers.Contract(ZAMT_TOKEN_ADDRESS, zamtABI, signer);

    document.getElementById("walletAddress").innerHTML =
        `Wallet: <a href="https://bscscan.com/address/${userAddress}" target="_blank" style="color: #ffd700; text-decoration: underline;">${userAddress}</a>`;

    const referralLink = `${window.location.origin}/dapp?ref=${userAddress}`;
    document.getElementById("referralLink").innerHTML = `
    <p>Your Referral Code:</p>
    <input type="text" value="${userAddress}" readonly style="width:100%; padding:8px; background:#222; color:#ffd700;" onclick="this.select()">
    <p>Your Invite Link:</p>
    <input type="text" value="${referralLink}" readonly style="width:100%; padding:8px; background:#222; color:#ffd700;" onclick="this.select()">
  `;
    document.getElementById("connectBtn").style.display = "none";

    await updateZAMTBalance();
    await loadMissingReward();
    await loadUserStakes();
    await loadDownlineSummary();
    await loadRewardSummary();
    await loadFullDownline();

}

async function loadMissingReward() {
    try {
        const reward = await stakingContract.lostReferralRewards(userAddress);
        const decimals = await zamtToken.decimals();
        const formatted = ethers.formatUnits(reward, decimals);

        const container = document.getElementById("missingReward");
        const textNode = container.querySelector("span");

        if (textNode) {
            textNode.textContent = `Lost Reward: ${formatted} ZAMT`;
        }
    } catch (err) {
        console.error("Failed to load missing reward", err);

        const container = document.getElementById("missingReward");
        const textNode = container.querySelector("span");

        if (textNode) {
            textNode.textContent = "❌ Error loading missing reward";
        }
    }
}

async function updateZAMTBalance() {
    const balance = await zamtToken.balanceOf(userAddress);
    const decimals = await zamtToken.decimals();
    const readableBalance = ethers.formatUnits(balance, decimals);
    document.getElementById("zamtAmount").innerText = readableBalance;
}

async function getActiveStakeCount(userAddress) {
    const data = await stakingContract.getStakes(userAddress);
    const total = data[0].length;

    const stakePromises = [];
    for (let i = 0; i < total; i++) {
        stakePromises.push(stakingContract.userStakes(userAddress, i));
    }

    const stakes = await Promise.all(stakePromises);
    return stakes.filter(stake => stake.active).length;
}

async function stakeZAMT() {
    const amountInput = document.getElementById("amount").value;
    const lockDaysInput = document.getElementById("lockDays").value;
    const referrerInput = document.getElementById("referrer").value.trim();
    const referrer = (referrerInput && ethers.isAddress(referrerInput)) ? referrerInput : DEFAULT_REFERRER;

// this enables the invalid referrer modal
// TODO: use getreferrer from referralmanager to detect if no referrer
//   if (!ethers.isAddress(referrerInput)) {
//     if (!localStorage.getItem("referrerDismissed")) {
//       openReferrerReminderOnce();
//       return;
//     }
//   }

    if (!amountInput || !lockDaysInput) {
        document.getElementById("status").innerText = "\u2757 Please enter amount and lock days.";
        return;
    }

    const decimals = await zamtToken.decimals();
    const parsedAmount = ethers.parseUnits(amountInput, decimals);

    try {
        const [minimum, cooldown, lastTime] = await Promise.all([
            stakingContract.minimumStake(),
            stakingContract.stakeCooldown(),
            stakingContract.lastStakeTime(userAddress)
        ]);

        //const activeCount = await stakingContract.getStakes(userAddress).then(data => data[0].length);
        const activeCount = await getActiveStakeCount(userAddress);

        if (parsedAmount < minimum) throw new Error("Below minimum stake");

        const currentTime = Math.floor(Date.now() / 1000);
        if (currentTime < (Number(lastTime) + Number(cooldown))) {
            throw new Error("Stake cooldown not passed yet");
        }

        if (activeCount >= 5) {
            throw new Error("Maximum active stakes reached");
        }

        const allowance = await zamtToken.allowance(userAddress, STAKING_CONTRACT_ADDRESS);
        if (allowance < parsedAmount) {
            const approveTx = await zamtToken.approve(STAKING_CONTRACT_ADDRESS, parsedAmount);
            await approveTx.wait();
        }

        document.getElementById("status").innerText = "⏳ Estimating gas...";
        await stakingContract.stake.estimateGas(parsedAmount, referrer, parseInt(lockDaysInput));

        document.getElementById("status").innerText = "📥 Staking...";
        const stakeTx = await stakingContract.stake(parsedAmount, referrer, parseInt(lockDaysInput));
        await stakeTx.wait();

        document.getElementById("status").innerText = "✅ Stake successful!";
        setTimeout(() => document.getElementById("status").innerText = "", 4000);

        await updateZAMTBalance();
        await loadUserStakes();

        openBackupModal();

    } catch (err) {
        console.error("❌ Stake process failed", err);
        document.getElementById("status").innerText = `❌ Error: ${err?.reason || err.message}`;
    }
}

async function loadUserStakes() {
    try {
        const result = await stakingContract.getStakes(userAddress);
        const [amounts, lockDurations, daysSinceClaim, currentRates, claimables] = result;

        const SECONDS_PER_DAY = 86400;
        const currentTime = Math.floor(Date.now() / 1000);
        const decimals = await zamtToken.decimals();
        const container = document.getElementById("stakesContainer");
        container.innerHTML = "";

        for (let i = 0; i < amounts.length; i++) {


            const amount = ethers.formatUnits(amounts[i], decimals);
            const claimable = ethers.formatUnits(claimables[i], decimals);
            const rate = Number(currentRates[i]) / 100;

            const stakeStruct = await stakingContract.userStakes(userAddress, i);
            if (!stakeStruct.active) continue; // skip closed/unstaked
            const stakeTime = Number(stakeStruct.startTime);
            const lockDays = Number(stakeStruct.lockDurationDays);
            const lastClaimTime = Number(stakeStruct.lastClaimTime);
            const unlockTime = stakeTime + lockDays * SECONDS_PER_DAY;
            const timeLeft = unlockTime - currentTime;
            const daysRemaining = Math.ceil(timeLeft / SECONDS_PER_DAY);
            const isUnlocked = timeLeft <= 0;

            // Calculate next claim time
            const lastClaimDate = new Date(lastClaimTime * 1000); // convert seconds to milliseconds
            const nextClaimTime = calculateNextClaimTime(lastClaimDate);
            const nextClaimFormatted = formatClaimTimestamp(nextClaimTime);

            const unlockButtonHTML = isUnlocked
                ? `<button onclick="unstake(${i})">🔓 Unstake</button>`
                : `<button disabled>🔒 Locked (${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left)</button>`;

            const card = document.createElement("div");
            card.className = "stake-card";
            card.innerHTML = `
        <h3>Stake: ${formatTimestamp(stakeTime)}</h3>
        <p><b>Amount:</b> <span style="color:#fff">${amount}</span> ZAMT</p>
        <p><b>Lock Days:</b> <span style="color:#fff">${lockDays}</span></p>
        <p><b>Days Since Last Claim:</b> <span style="color:#fff">${daysSinceClaim[i]}</span></p>
        <p><b>Current Rate:</b> <span style="color:#fff">${rate}%</span></p>
        <p><b>Claimable:</b> <span style="color:#fff">${claimable}</span> ZAMT</p>
        <p><b>Next Claim Time:</b> <span style="color:#fff">${nextClaimFormatted}</span></p>
        <div class="stake-actions">
          <button onclick="claimReward(${i})">💰 Claim</button>
          ${unlockButtonHTML}
        </div>
      `;
            container.appendChild(card);
        }
    } catch (err) {
        console.error("Failed to load stakes", err);
        document.getElementById("stakesContainer").innerHTML = "<p>❌ Failed to load stakes</p>";
    }
}

async function claimReward(index) {
    try {
        const tx = await stakingContract.claimReward(index);
        await tx.wait();
        document.getElementById("status").innerText = `✅ Claimed reward for stake #${index + 1}`;
        setTimeout(() => document.getElementById("status").innerText = "", 4000);
        await updateZAMTBalance();
        await loadUserStakes();
    } catch (err) {
        console.error("Claim error:", err);
        document.getElementById("status").innerText = `❌ Claim failed: ${err?.reason || err.message}`;
    }
}

/*
async function unstake(index) {
  try {
    const tx = await stakingContract.unstake(index);
    await tx.wait();
    document.getElementById("status").innerText = `✅ Unstaked stake #${index + 1}`;
    setTimeout(() => document.getElementById("status").innerText = "", 4000);
    await updateZAMTBalance();
    await loadUserStakes();
    await loadDownlineSummary();
  } catch (err) {
    console.error("Unstake error:", err);
    document.getElementById("status").innerText = `❌ Unstake failed: ${err?.reason || err.message}`;
  }
}
*/
async function unstake(index) {
    try {
        const stakeStruct = await stakingContract.userStakes(userAddress, index);
        const decimals = await zamtToken.decimals();
        const amount = ethers.formatUnits(stakeStruct.amount, decimals);

        const confirmUnstake = confirm(
            `⚠️ Are you sure you want to unstake ${amount} ZAMT?\n\nA 7% fee will be deducted from your staked amount.`
        );

        if (!confirmUnstake) return;

        const tx = await stakingContract.unstake(index);
        await tx.wait();
        document.getElementById("status").innerText = `✅ Unstaked stake #${index + 1}`;
        setTimeout(() => document.getElementById("status").innerText = "", 4000);
        await updateZAMTBalance();
        await loadUserStakes();
    } catch (err) {
        console.error("Unstake error:", err);
        document.getElementById("status").innerText = `❌ Unstake failed: ${err?.reason || err.message}`;
    }
}


async function loadDownlineSummary() {
    try {
        const summary = await stakingContract.getDownlineStakeSummary(userAddress);
        const [l1Count, l2Count, l3Count, l1Stake, l2Stake, l3Stake] = summary;

        document.getElementById("downlineSummary").innerHTML = `
      <h3>Referral Downline Summary</h3>
      <table border="1" style="width:100%; text-align:center; border-collapse:collapse;">
        <tr><th>Level</th><th>Count</th><th>Total Stake</th></tr>
        <tr><td>1</td><td>${l1Count}</td><td>${ethers.formatUnits(l1Stake, 4)}</td></tr>
        <tr><td>2</td><td>${l2Count}</td><td>${ethers.formatUnits(l2Stake, 4)}</td></tr>
        <tr><td>3</td><td>${l3Count}</td><td>${ethers.formatUnits(l3Stake, 4)}</td></tr>
      </table>
    `;
    } catch (err) {
        console.error("Failed to load downline summary", err);
        document.getElementById("downlineSummary").innerHTML = `<p>❌ Failed to load downline summary</p>`;
    }
}

async function loadFullDownline() {
    try {
        const [
            level1Users,
            level1Stakes,
            level2Users,
            level2Stakes,
            level3Users,
            level3Stakes
        ] = await stakingContract.getDownlineWithSumOfStakes();

        const formatList = (users, stakes) => {
            if (users.length === 0) return `<tr><td colspan="3">No users</td></tr>`;
            const decimals = 4;
            return users.map((user, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${user}</td>
          <td>${ethers.formatUnits(stakes[i], decimals)}</td>
        </tr>
      `).join("");
        };

        const table = `
      <div class="summary-table">
        <h3>Level 1 Users</h3>
        <table>
          <tr><th>#</th><th>Address</th><th>Total Stake</th></tr>
          ${formatList(level1Users, level1Stakes)}
        </table>
        <h3>Level 2 Users</h3>
        <table>
          <tr><th>#</th><th>Address</th><th>Total Stake</th></tr>
          ${formatList(level2Users, level2Stakes)}
        </table>
        <h3>Level 3 Users</h3>
        <table>
          <tr><th>#</th><th>Address</th><th>Total Stake</th></tr>
          ${formatList(level3Users, level3Stakes)}
        </table>
      </div>
    `;

        document.getElementById("fullDownlineSummary").innerHTML = table;
    } catch (err) {
        console.error("Failed to load full downline", err);
        document.getElementById("fullDownlineSummary").innerHTML = `<p>❌ Error loading full downline</p>`;
    }
}

function openEarnModal() {
    document.getElementById('earn-modal').classList.add('active');
}

function closeEarnModal() {
    document.getElementById('earn-modal').classList.remove('active');
}

function openReferrerReminderOnce() {
    if (!localStorage.getItem('referrerDismissed')) {
        document.getElementById('referrer-modal').classList.add('active');
    }
}

function dismissReferrerReminder() {
    localStorage.setItem('referrerDismissed', 'true');
    document.getElementById('referrer-modal').classList.remove('active');
}

function openBackupModal() {
    document.getElementById("backup-modal").classList.add('active');
}

function closeBackupModal() {
    document.getElementById("backup-modal").classList.remove('active');
}

function openInfoModal() {
    document.getElementById("rewardInfoModal").classList.add('active');
}

function closeInfoModal() {
    document.getElementById("rewardInfoModal").classList.remove('active');
}

// Referral Rewards Modal Functions
let countdownInterval;

function openReferralRewardsModal() {
    const modal = document.getElementById('referral-rewards-modal');
    const closeBtn = document.getElementById('referral-close-btn');
    const countdownEl = document.getElementById('referral-countdown');

    // Show modal
    modal.classList.add('active');

    // Prevent closing modal when clicking on overlay
    modal.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    // Start countdown from 5
    let count = 5;
    countdownEl.textContent = count;
    countdownEl.style.display = 'block';
    closeBtn.style.display = 'none';

    countdownInterval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownEl.textContent = count;
        } else {
            // Countdown finished, show close button
            clearInterval(countdownInterval);
            countdownEl.style.display = 'none';
            closeBtn.style.display = 'block';
        }
    }, 1000);
}

function closeReferralRewardsModal() {
    const modal = document.getElementById('referral-rewards-modal');

    // Clear countdown interval if still running
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    // Hide modal
    modal.classList.remove('active');

    // Reset for next time (in case modal is reopened)
    const closeBtn = document.getElementById('referral-close-btn');
    const countdownEl = document.getElementById('referral-countdown');
    closeBtn.style.display = 'none';
    countdownEl.style.display = 'block';
}

// Open referral rewards modal on page load
document.addEventListener('DOMContentLoaded', function () {
    // Small delay to ensure page is fully loaded
    setTimeout(openReferralRewardsModal, 500);
});

init();

