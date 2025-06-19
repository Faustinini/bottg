console.log("Iniciando el bot...");

require('dotenv').config();
const { JsonRpcProvider, Contract, formatUnits, Interface } = require("ethers");
const axios = require("axios");


const provider = new JsonRpcProvider("https://base-mainnet.g.alchemy.com/v2/vdO2pboK_XDFHXKJ4mJ2dZrhYbmgZ-W6");

const wallets = [
  "0x20cc5957538463a193c6b0d6245211003854477a",
  "0x6f8d31769b8416c8c19ab9bb8baa40b6c071991b",
  "0x64b5a6d9ef017cdffb04d79abe853fa82aaf7d0c",
  "0x14ec81686f8bafb6126a0e99dc2c029a69b063f7",
  "0xd6ee7edd41d776701a40e5ba24b70c7c7cba49a0",
];

const LP_TOKEN = "0x55F618171d851d57906431ce9FEEe96Dc6f3877e";
const GAUGE = "0xc6fc7e3838bcb2b0cc6da0251c4f32b8865ed725";
const BRIBE_CONTRACT = "0xF317C3789130226b9f5b0bbA6bE193bd4acA57bc";
const BOTTO = "0x24914CB6BD01E6a0CF2a9c0478e33c25926e6a0c";
const WETH = "0x4200000000000000000000000000000000000006";
const AERO = "0x9d165f0cc6a6280a6b34f6a22b0415445b3aa17f";
const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY;


const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];
const PAIR_ABI = [
  "function getReserves() view returns (uint112, uint112, uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

const BASESCAN_API = "https://api.basescan.org/api";
const NOTIFY_SIG = "notifyRewardAmount(address,uint256)";
const NOTIFY_SELECTOR = "0xb66503cf";

async function getClaimedAero(wallet) {
  const SELECTOR_GETREWARD = "0xc00007b0";
  const txUrl = `${BASESCAN_API}?module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&sort=asc&apikey=${BASESCAN_API_KEY}`;
  const txRes = await axios.get(txUrl);
  if (txRes.data.status !== "1") return 0;

  const getRewardTxs = txRes.data.result.filter(tx =>
    tx.to.toLowerCase() === GAUGE.toLowerCase() &&
    tx.input.startsWith(SELECTOR_GETREWARD)
  );

  let total = 0;
  const transferUrl = `${BASESCAN_API}?module=account&action=tokentx&address=${wallet}&startblock=0&endblock=99999999&sort=asc&apikey=${BASESCAN_API_KEY}`;
  const transferRes = await axios.get(transferUrl);
  if (transferRes.data.status !== "1") return 0;

  for (const tx of getRewardTxs) {
    const transfers = transferRes.data.result.filter(log =>
      log.hash === tx.hash &&
      log.tokenSymbol.toUpperCase() === "AERO" &&
      log.from.toLowerCase() === GAUGE.toLowerCase() &&
      log.to.toLowerCase() === wallet.toLowerCase()
    );
    for (const transfer of transfers) {
      total += parseFloat(formatUnits(transfer.value, 18));
    }
  }
  return total;

}

async function getBribesViaNotifyRewardAmount(epochNumber, prices) {
  const EPOCH_DURATION = 7 * 24 * 60 * 60;
  const BASE_TIMESTAMP = 1692835200;
  const startTime = BASE_TIMESTAMP + (epochNumber - 1) * EPOCH_DURATION;
  const endTime = BASE_TIMESTAMP + epochNumber * EPOCH_DURATION;

  const latestBlock = await provider.getBlockNumber();
  const latestTimestamp = (await provider.getBlock(latestBlock)).timestamp;
  const avgBlockTime = 2;

  const blocksAgoStart = Math.floor((latestTimestamp - startTime) / avgBlockTime);
  const blocksAgoEnd = Math.floor((latestTimestamp - endTime) / avgBlockTime);
  const startBlock = latestBlock - blocksAgoStart;
  const endBlock = latestBlock - blocksAgoEnd;

  const url = `${BASESCAN_API}?module=account&action=txlist&address=${BRIBE_CONTRACT}&startblock=${startBlock}&endblock=${endBlock}&apikey=${process.env.BASESCAN_API_KEY}`;
  const res = await axios.get(url);
  if (!res.data || res.data.status !== "1" || !Array.isArray(res.data.result)) {
    console.error("❌ Basescan devolvió una respuesta inválida:", res.data);
    return [];
  }

  const txs = res.data.result;
  const iface = new Interface([`function ${NOTIFY_SIG}`]);
  const results = [];

  for (const tx of txs) {
    if (tx.input && typeof tx.input === 'string' && tx.input.startsWith(NOTIFY_SELECTOR)) {
      try {
        const decoded = iface.decodeFunctionData(NOTIFY_SIG, tx.input);
        const tokenAddr = decoded[0];
        const amountRaw = decoded[1];

        const token = new Contract(tokenAddr, ERC20_ABI, provider);
        const [symbol, decimals] = await Promise.all([
          token.symbol(),
          token.decimals()
        ]);

        const amount = parseFloat(formatUnits(amountRaw, decimals));
        const price = prices[symbol.toUpperCase()] || 0;

        results.push({
          symbol,
          amount,
          usd: amount * price
        });
      } catch (e) {
        console.error(`❌ Error decodificando TX ${tx.hash}:`, e.message);
      }
    }
  }

  return results;
}

async function getTokenPrices() {
  const bottoRes = await axios.get("https://api.dexscreener.com/latest/dex/pairs/base/0x55F618171d851d57906431ce9FEEe96Dc6f3877e");
  const bottoPrice = parseFloat(bottoRes.data?.pair?.priceUsd || 0);

  const aeroRes = await axios.get("https://api.dexscreener.com/latest/dex/pairs/base/0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d");
  const aeroPrice = parseFloat(aeroRes.data?.pair?.priceUsd || 0);

  const coingecko = await axios.get("https://api.coingecko.com/api/v3/simple/price?ids=weth,usd-coin&vs_currencies=usd");
  const wethPrice = coingecko.data.weth.usd;
  const usdcPrice = coingecko.data['usd-coin']?.usd || 0;

  return {
    BOTTO: bottoPrice,
    WETH: wethPrice,
    AERO: aeroPrice,
    USDC: usdcPrice
  };
}


async function getLPDetails() {
  const lp = new Contract(LP_TOKEN, [...ERC20_ABI, ...PAIR_ABI], provider);
  const [totalSupplyRaw, token0, token1, reserves] = await Promise.all([
    lp.totalSupply(),
    lp.token0(),
    lp.token1(),
    lp.getReserves()
  ]);
  const decimals = await lp.decimals();
  return {
    totalSupply: parseFloat(formatUnits(totalSupplyRaw, decimals)),
    reserves: [parseFloat(formatUnits(reserves[0], decimals)), parseFloat(formatUnits(reserves[1], decimals))],
    tokens: [token0.toLowerCase(), token1.toLowerCase()]
  };
}

async function getGaugeEmissions() {
  const gauge = new Contract(GAUGE, [
    "function rewardRate() view returns (uint256)",
    "function periodFinish() view returns (uint256)"
  ], provider);

  const [rewardRateRaw, periodFinishRaw] = await Promise.all([
    gauge.rewardRate(),
    gauge.periodFinish()
  ]);

  const rewardRate = parseFloat(formatUnits(rewardRateRaw));
  const periodFinish = Number(periodFinishRaw);
  const duration = 7 * 24 * 60 * 60;
  const totalAero = rewardRate * duration;

  const epochStart = new Date((periodFinish - duration) * 1000);
  const epochEnd = new Date(periodFinish * 1000);
  const BASE_TIMESTAMP = 1692835200;
  const epochNumber = Math.floor((periodFinish - duration - BASE_TIMESTAMP) / duration);

  return { totalAero, epochStart, epochEnd, epochNumber };
}

async function processWallet(wallet, gaugeContract, lpInfo, gaugeInfo, prices) {
  const rawStaked = await gaugeContract.balanceOf(wallet);
  const stakedBalance = parseFloat(formatUnits(rawStaked));
  const share = stakedBalance / lpInfo.totalSupply;

  const [res0, res1] = lpInfo.reserves;
  const token0Amount = res0 * share;
  const token1Amount = res1 * share;

  const bottoAmount = lpInfo.tokens[0] === BOTTO.toLowerCase() ? token0Amount : token1Amount;
  const wethAmount = lpInfo.tokens[0] === WETH.toLowerCase() ? token0Amount : token1Amount;
  const valueUSD = bottoAmount * prices.BOTTO + wethAmount * prices.WETH;
  const percentage = share * 100;
  const aeroEstimated = (percentage / 100) * gaugeInfo.totalAero;

  console.log(`\nWallet: ${wallet}`);
  console.log(`🔒 LP stakeado: ${stakedBalance.toFixed(8)} LP`);
  console.log(`📈 Participación en pool: ${percentage.toFixed(6)}%`);
  console.log(`   → BOTTO: ${bottoAmount.toFixed(6)}`);
  console.log(`   → WETH:  ${wethAmount.toFixed(6)}`);
  console.log(`💰 Valor estimado USD: $${valueUSD.toFixed(2)}`);
  console.log(`🎯 AERO estimado del epoch: ${aeroEstimated.toFixed(4)} AERO`);

  return {
    wallet,
    lp: stakedBalance,
    percentage,
    botto: bottoAmount,
    weth: wethAmount,
    usd: valueUSD,
    epoch: gaugeInfo.epochNumber,
    emissions: gaugeInfo.totalAero,
    aero: aeroEstimated
  };
}

async function getAllBribesByWallet() {
  const txRes = await axios.get(`${BASESCAN_API}?module=account&action=txlist&address=${BRIBE_CONTRACT}&startblock=0&endblock=99999999&sort=asc&apikey=${BASESCAN_API_KEY}`);
  if (!txRes.data || txRes.data.status !== "1") return {};

  const transferRes = await axios.get(`${BASESCAN_API}?module=account&action=tokentx&address=${BRIBE_CONTRACT}&startblock=0&endblock=99999999&sort=asc&apikey=${BASESCAN_API_KEY}`);
  if (!transferRes.data || transferRes.data.status !== "1") return {};

  const notifyTxs = txRes.data.result.filter(tx => tx.input?.startsWith(NOTIFY_SELECTOR));
  const transfers = transferRes.data.result;

  const bribesByWallet = {};

  for (const tx of notifyTxs) {
    const txHash = tx.hash;
    const matchedTransfers = transfers.filter(t =>
      t.hash === txHash &&
      t.to.toLowerCase() === BRIBE_CONTRACT.toLowerCase()
    );

    for (const tr of matchedTransfers) {
      const from = tr.from.toLowerCase();
      const symbol = tr.tokenSymbol;
      const amount = parseFloat(formatUnits(tr.value, parseInt(tr.tokenDecimal)));

      if (!bribesByWallet[from]) {
        bribesByWallet[from] = { count: 0, tokens: {} };
      }

      bribesByWallet[from].count += 1;
      if (!bribesByWallet[from].tokens[symbol]) {
        bribesByWallet[from].tokens[symbol] = 0;
      }
      bribesByWallet[from].tokens[symbol] += amount;
    }
  }

  return bribesByWallet;
}

async function main() {
  
const bribesByWallet = await getAllBribesByWallet();

console.log("📊 Bribes históricos por wallet:");
for (const [wallet, info] of Object.entries(bribesByWallet)) {
  console.log(`\n🧾 Wallet: ${wallet}`);
  console.log(`🔁 Veces que bribeó: ${info.count}`);
  for (const [symbol, amount] of Object.entries(info.tokens)) {
    console.log(`   → ${symbol}: ${amount.toFixed(2)}`);
  }
}
 console.log(`\n=== Aerodrome LP Bot (stake only) - ${new Date().toLocaleString()} ===\n`);

  const [prices, lpInfo, gaugeInfo] = await Promise.all([
    getTokenPrices(),
    getLPDetails(),
    getGaugeEmissions()
  ]);
let [res0, res1] = lpInfo.reserves;
if (lpInfo.tokens[0] !== BOTTO.toLowerCase()) {
  [res0, res1] = [res1, res0]; // Aseguramos que res0 = BOTTO, res1 = WETH
}
const totalTVL = res0 * prices.BOTTO + res1 * prices.WETH;
console.log(`🏦 TVL total de la pool: $${totalTVL.toFixed(2)}`);
const apr = ((gaugeInfo.totalAero * prices.AERO) / totalTVL) * 52 * 100;
console.log(`📈 APR estimado: ${apr.toFixed(2)}%`);


  const bribes = await getBribesViaNotifyRewardAmount(gaugeInfo.epochNumber, prices);

  console.log(`🏭 Emisiones AERO del epoch #${gaugeInfo.epochNumber}: ${gaugeInfo.totalAero.toFixed(2)} AERO`);
  console.log(`⏳ Desde: ${gaugeInfo.epochStart.toLocaleString()} hasta ${gaugeInfo.epochEnd.toLocaleString()}`);
  console.log(`\n=== Aerodrome LP Bot (stake only) - ${new Date().toLocaleString()} ===\n`);
  if (bribes.length) {
    console.log("💸 Bribes detectados:");
    for (const b of bribes) {
      console.log(`→ ${b.symbol}: ${b.amount.toFixed(2)} ($${b.usd.toFixed(2)})`);
    }
  } else {
    console.log("💸 No se detectaron bribes activos para este epoch.");
  }

  const gaugeContract = new Contract(GAUGE, ERC20_ABI, provider);

  const sheetRows = [];
  let totalPoolPercentage = 0;
  let totalUSDAccum = 0;
  let totalAeroWallets = 0;

  for (const wallet of wallets) {
const row = await processWallet(wallet, gaugeContract, lpInfo, gaugeInfo, prices);
const claimed = await getClaimedAero(wallet);
row.claimed = claimed;
sheetRows.push(row);

totalPoolPercentage += row.percentage;
totalUSDAccum += row.usd;
totalAeroWallets += row.aero;

console.log(`💸 AERO claimeado por ${wallet}: ${claimed.toFixed(4)} AERO`);
if (bribesByWallet[wallet.toLowerCase()]) {
  const info = bribesByWallet[wallet.toLowerCase()];
  console.log(`🔁 Veces que bribeó: ${info.count}`);
  for (const [symbol, amount] of Object.entries(info.tokens)) {
    console.log(`   → ${symbol}: ${amount.toFixed(2)}`);
  }
}

  }

  await updateSheet(sheetRows, prices, bribes, bribesByWallet, totalTVL, apr);

  console.log("\n==============================================");
  console.log(`🧾 Participación total (stakeado): ${totalPoolPercentage.toFixed(6)}%`);
  console.log(`💼 Valor total estimado USD:      $${totalUSDAccum.toFixed(2)}`);
  console.log(`🎯 Total AERO estimado (wallets): ${totalAeroWallets.toFixed(2)} AERO`);
  console.log("==============================================\n");
}

module.exports = async function generateReport() {
  const [prices, lpInfo, gaugeInfo] = await Promise.all([
    getTokenPrices(),
    getLPDetails(),
    getGaugeEmissions()
  ]);

  const [res0, res1] = lpInfo.tokens[0] === BOTTO.toLowerCase()
    ? lpInfo.reserves
    : lpInfo.reserves.slice().reverse();

  const totalTVL = res0 * prices.BOTTO + res1 * prices.WETH;
  const apr = ((gaugeInfo.totalAero * prices.AERO) / totalTVL) * 52 * 100;

  const bribes = await getBribesViaNotifyRewardAmount(gaugeInfo.epochNumber, prices);

  const gaugeContract = new Contract(GAUGE, ERC20_ABI, provider);
  let texto = `*📊 Pool BOTTO/WETH — Epoch #${gaugeInfo.epochNumber}*\n`;
  texto += `*🏦 TVL:* $${totalTVL.toLocaleString("pt-PT", { minimumFractionDigits: 2 })}\n`;
  texto += `*📈 APR estimado:* ${apr.toFixed(2)}%\n`;
  texto += `*🪙 Emisiones AERO:* ${gaugeInfo.totalAero.toFixed(2)} AERO ($${(gaugeInfo.totalAero * prices.AERO).toFixed(2)})\n`;

  if (bribes.length > 0) {
   // Agrupar total por símbolo
const bribesResumen = {};
for (const b of bribes) {
  const symbol = b.symbol.toUpperCase();
  if (!bribesResumen[symbol]) {
    bribesResumen[symbol] = { amount: 0, usd: 0 };
  }
  bribesResumen[symbol].amount += b.amount;
  bribesResumen[symbol].usd += b.usd;
}

// Mostrar un total por token
const resumen = Object.entries(bribesResumen)
  .map(([symbol, data]) =>
    `${data.amount.toFixed(2)} ${symbol} ($${data.usd.toFixed(2)})`)
  .join(", ");

texto += `*🎁 Bribes:* ${resumen}\n\n`;


  } else {
    texto += `🎁 Bribes: (ninguno)\n\n`;
  }

  texto += `*💰 Recompensas estimadas:*\n`;
let totalPoolPercentage = 0;

  for (const wallet of wallets) {
    const row = await processWallet(wallet, gaugeContract, lpInfo, gaugeInfo, prices);
    const usd = row.aero * prices.AERO;
    const nombre = wallet === "0x20cc5957538463a193c6b0d6245211003854477a" ? "EY TB"
      : wallet === "0x6f8d31769b8416c8c19ab9bb8baa40b6c071991b" ? "EY T2"
      : wallet === "0x64b5a6d9ef017cdffb04d79abe853fa82aaf7d0c" ? "EY liq sw"
      : wallet === "0x14ec81686f8bafb6126a0e99dc2c029a69b063f7" ? "EY B L H"
      : "Carbono";

    texto += `- *${nombre}:* ${row.aero.toFixed(2)} AERO ($${usd.toFixed(2)})\n`;
    totalPoolPercentage += row.percentage;
  }
texto += `\n*📊 Participación total (stakeado):* ${totalPoolPercentage.toFixed(2)}%`;

  return texto;
};
