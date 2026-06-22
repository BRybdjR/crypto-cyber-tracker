const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cors = require('cors');
const { Telegraf } = require('telegraf');

const app = express();
app.use(cors());
app.use(express.static('public'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Database initialization
const db = new sqlite3.Database('./arbitrage.db');

const runDb = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(err) { if(err) reject(err); else resolve(this); }));
const getDb = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => { if(err) reject(err); else resolve(row); }));
const allDb = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => { if(err) reject(err); else resolve(rows); }));

async function initDB() {
    await runDb(`CREATE TABLE IF NOT EXISTS users (
        telegram_id TEXT PRIMARY KEY, username TEXT, balance_usdt REAL DEFAULT 50000.0, rank TEXT DEFAULT 'Drop',
        total_trades INTEGER DEFAULT 0, profit_usdt REAL DEFAULT 0.0, active_loan REAL DEFAULT 0.0,
        loan_due_time INTEGER DEFAULT 0, exp INTEGER DEFAULT 0,
        ton_loops INTEGER DEFAULT 0, survive_115fz INTEGER DEFAULT 0,
        daily_ton_goal INTEGER DEFAULT 3, daily_115fz_goal INTEGER DEFAULT 1, daily_profit_goal REAL DEFAULT 5000.0,
        ton_bonus_claimed INTEGER DEFAULT 0, fz_bonus_claimed INTEGER DEFAULT 0, profit_bonus_claimed INTEGER DEFAULT 0
    )`);
    await runDb(`CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT, bank_name TEXT, limit_remaining REAL DEFAULT 300000.0,
        status TEXT DEFAULT 'Active', unblock_timer INTEGER DEFAULT 0
    )`);
    await runDb(`CREATE TABLE IF NOT EXISTS infrastructure (
        telegram_id TEXT PRIMARY KEY, proxies_count INTEGER DEFAULT 0, drops_count INTEGER DEFAULT 0, lawyers_count INTEGER DEFAULT 0
    )`);
}
initDB();

// Global State & Modifiers
let globalModifiers = {
    amlRiskMultiplier: 1.0, cardLimitMultiplier: 1.0, usdtSpreadWiden: 0.0, lockedCoin: null,
    priceDropCoin: null, priceDropAmount: 0.0, proxyDisabled: false, anomalyCoin: null,
    anomalyExchange: null, anomalyAmount: 0.0, anomalyExpiration: 0, syndicateSpreadModifier: 0.0,
    syndicateTimeMultiplier: 1.0, activeNews: null
};

// 15 Comprehensive Cyber News Events
const cyberNewsEvents = [
    // Regulatory & AML Attacks
    { id: 1, title: "SEC Token Crackdown", type: "REGULATORY", desc: "SEC tightens token rules. AML risks triple, limits drop.", duration: 120000, mods: { amlRiskMultiplier: 3.0, cardLimitMultiplier: 0.6, usdtSpreadWiden: 0.025 } },
    { id: 2, title: "Central Bank AML Tightening", type: "REGULATORY", desc: "Banks enforce heavy AML. High block risk.", duration: 90000, mods: { amlRiskMultiplier: 3.0, cardLimitMultiplier: 0.6, usdtSpreadWiden: 0.025 } },
    { id: 3, title: "Tax Authority P2P Freeze", type: "REGULATORY", desc: "Massive tax sweeps on P2P merchants.", duration: 100000, mods: { amlRiskMultiplier: 3.0, cardLimitMultiplier: 0.6, usdtSpreadWiden: 0.025 } },
    { id: 4, title: "FATF Gray List Update", type: "REGULATORY", desc: "Global scrutiny increased on unregulated exchanges.", duration: 90000, mods: { amlRiskMultiplier: 3.0, cardLimitMultiplier: 0.6, usdtSpreadWiden: 0.025 } },
    // Technical Failures & Hacks
    { id: 5, title: "TON Network Outage", type: "TECH", desc: "TON withdrawals frozen. Proxies failing.", coin: "TON", duration: 80000, mods: { lockedCoin: "TON", proxyDisabled: true, priceDropCoin: "TON", priceDropAmount: 0.10 } },
    { id: 6, title: "Solana Bridge Exploit", type: "TECH", desc: "SOL hacked. 12% drop, bridging halted.", coin: "SOL", duration: 110000, mods: { lockedCoin: "SOL", proxyDisabled: true, priceDropCoin: "SOL", priceDropAmount: 0.12 } },
    { id: 7, title: "Euro Cloud Data Center Fire", type: "TECH", desc: "Routing fails. ETH drops, proxies disabled.", coin: "ETH", duration: 90000, mods: { lockedCoin: "ETH", proxyDisabled: true, priceDropCoin: "ETH", priceDropAmount: 0.08 } },
    { id: 8, title: "AWS Region Crash", type: "TECH", desc: "Global API instability. BTC dips 8%.", coin: "BTC", duration: 90000, mods: { lockedCoin: "BTC", proxyDisabled: true, priceDropCoin: "BTC", priceDropAmount: 0.08 } },
    { id: 9, title: "Binance Wallet Sync Bug", type: "TECH", desc: "BNB locked. Proxy network congestion.", coin: "BNB", duration: 75000, mods: { lockedCoin: "BNB", proxyDisabled: true, priceDropCoin: "BNB", priceDropAmount: 0.09 } },
    // Whale Manipulations & Whims
    { id: 10, title: "Elon Musk Doge Meme Tweet", type: "WHALE", desc: "DOGE flash pump on Binance!", coin: "DOGE", exchange: "Binance", duration: 30000, mods: { anomalyCoin: "DOGE", anomalyExchange: "Binance", anomalyAmount: 0.15 } },
    { id: 11, title: "Institutional Whale Dump on Binance", type: "WHALE", desc: "Massive BTC dump on Binance.", coin: "BTC", exchange: "Binance", duration: 30000, mods: { anomalyCoin: "BTC", anomalyExchange: "Binance", anomalyAmount: -0.12 } },
    { id: 12, title: "XRP Short Squeeze on Bybit", type: "WHALE", desc: "XRP squeezed by retail on Bybit.", coin: "XRP", exchange: "Bybit", duration: 30000, mods: { anomalyCoin: "XRP", anomalyExchange: "Bybit", anomalyAmount: 0.14 } },
    { id: 13, title: "KuCoin ADA Flash Crash", type: "WHALE", desc: "ADA crashes flashily on KuCoin.", coin: "ADA", exchange: "KuCoin", duration: 30000, mods: { anomalyCoin: "ADA", anomalyExchange: "KuCoin", anomalyAmount: -0.10 } },
    // Geopolitics & OTC Cash Transit
    { id: 14, title: "Dubai OTC Regulatory Shakeup", type: "GEO", desc: "Syndicate loops slowed, spreads increased to 8%.", duration: 120000, mods: { syndicateSpreadModifier: 0.08, syndicateTimeMultiplier: 2.0 } },
    { id: 15, title: "Turkey Fiat Loop Halt", type: "GEO", desc: "Turkish Lira crisis. OTC pools highly volatile.", duration: 100000, mods: { syndicateSpreadModifier: 0.08, syndicateTimeMultiplier: 2.0 } }
];

let newsTimer = null;
async function triggerNews() {
    const event = cyberNewsEvents[Math.floor(Math.random() * cyberNewsEvents.length)];
    globalModifiers = { amlRiskMultiplier: 1.0, cardLimitMultiplier: 1.0, usdtSpreadWiden: 0.0, lockedCoin: null, priceDropCoin: null, priceDropAmount: 0.0, proxyDisabled: false, anomalyCoin: null, anomalyExchange: null, anomalyAmount: 0.0, anomalyExpiration: 0, syndicateSpreadModifier: 0.0, syndicateTimeMultiplier: 1.0, activeNews: event };
    Object.assign(globalModifiers, event.mods);
    if(event.type === 'WHALE') globalModifiers.anomalyExpiration = Date.now() + event.duration;

    if(event.type === 'REGULATORY') {
        // Reduce active fiat bank card limits by 40%
        await runDb(`UPDATE cards SET limit_remaining = limit_remaining * 0.6 WHERE status = 'Active'`);
    }

    io.emit('cyber_news', event);

    setTimeout(() => {
        if(globalModifiers.activeNews && globalModifiers.activeNews.id === event.id) {
            globalModifiers = { amlRiskMultiplier: 1.0, cardLimitMultiplier: 1.0, usdtSpreadWiden: 0.0, lockedCoin: null, priceDropCoin: null, priceDropAmount: 0.0, proxyDisabled: false, anomalyCoin: null, anomalyExchange: null, anomalyAmount: 0.0, anomalyExpiration: 0, syndicateSpreadModifier: 0.0, syndicateTimeMultiplier: 1.0, activeNews: null };
            io.emit('cyber_news_end', { message: "Market normalized." });
        }
    }, event.duration);
}

setInterval(triggerNews, 45000); // Ticks every 45 seconds

// Market Data Fetching via Live APIs
const coins = ['BTC', 'ETH', 'TON', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA'];
const exchanges = ['Binance', 'Bybit', 'OKX', 'KuCoin'];

// Fallback base prices if APIs fail
let fallbackBasePrices = { BTC: 64000, ETH: 3500, TON: 7.2, SOL: 145, BNB: 600, XRP: 0.55, DOGE: 0.16, ADA: 0.45 };
let lastLivePrices = {};

async function fetchLivePrices() {
    let newPrices = {};
    for (let c of coins) newPrices[c] = {};

    try {
        // Binance
        try {
            let res = await axios.get('https://api.binance.com/api/v3/ticker/price');
            for(let c of coins) {
                let match = res.data.find(d => d.symbol === c + 'USDT');
                if(match) newPrices[c]['Binance'] = parseFloat(match.price);
            }
        } catch(e) {}

        // Bybit
        try {
            let res = await axios.get('https://api.bybit.com/v5/market/tickers?category=spot');
            if(res.data && res.data.result && res.data.result.list) {
                for(let c of coins) {
                    let match = res.data.result.list.find(d => d.symbol === c + 'USDT');
                    if(match) newPrices[c]['Bybit'] = parseFloat(match.lastPrice);
                }
            }
        } catch(e) {}

        // OKX
        try {
            let res = await axios.get('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
            if(res.data && res.data.data) {
                for(let c of coins) {
                    let match = res.data.data.find(d => d.instId === c + '-USDT');
                    if(match) newPrices[c]['OKX'] = parseFloat(match.last);
                }
            }
        } catch(e) {}

        // KuCoin
        try {
            let res = await axios.get('https://api.kucoin.com/api/v1/market/allTickers');
            if(res.data && res.data.data && res.data.data.ticker) {
                for(let c of coins) {
                    let match = res.data.data.ticker.find(d => d.symbol === c + '-USDT');
                    if(match) newPrices[c]['KuCoin'] = parseFloat(match.last);
                }
            }
        } catch(e) {}

        lastLivePrices = newPrices;
    } catch(e) {
        console.error("Live Price Fetch Error", e.message);
    }
}

setInterval(fetchLivePrices, 10000); // Update live prices every 10 seconds
fetchLivePrices(); // Initial fetch

function generateMarketData() {
    let market = [];
    for(let coin of coins) {
        let exchPrices = {};

        let basePrice = fallbackBasePrices[coin];
        // If we have live data for this coin, use average as base to simulate missing exchanges if needed
        let liveVals = lastLivePrices[coin] ? Object.values(lastLivePrices[coin]).filter(v=>v) : [];
        if(liveVals.length > 0) {
            basePrice = liveVals.reduce((a,b)=>a+b,0)/liveVals.length;
        }

        if(globalModifiers.priceDropCoin === coin) {
            basePrice *= (1 - globalModifiers.priceDropAmount * 0.1); // Gradual drop
        }

        for(let ex of exchanges) {
            // Use live price if available, otherwise fallback with slight variation
            let p = lastLivePrices[coin] && lastLivePrices[coin][ex] ? lastLivePrices[coin][ex] : basePrice * (1 + (Math.random() * 0.004 - 0.002));

            if(globalModifiers.priceDropCoin === coin) {
                p *= (1 - globalModifiers.priceDropAmount * 0.1);
            }

            if(globalModifiers.anomalyCoin === coin && globalModifiers.anomalyExchange === ex && Date.now() < globalModifiers.anomalyExpiration) {
                p *= (1 + globalModifiers.anomalyAmount);
            }
            exchPrices[ex] = p;
        }

        let prices = Object.values(exchPrices);
        let min = Math.min(...prices);
        let max = Math.max(...prices);
        let spread = ((max - min) / min) * 100;

        if(globalModifiers.usdtSpreadWiden > 0) spread += (globalModifiers.usdtSpreadWiden * 100);

        let buyEx = Object.keys(exchPrices).find(k => exchPrices[k] === min);
        let sellEx = Object.keys(exchPrices).find(k => exchPrices[k] === max);

        market.push({
            coin,
            buyEx,
            sellEx,
            spread: spread.toFixed(2),
            price: min.toFixed(4),
            locked: globalModifiers.lockedCoin === coin
        });
    }
    return market;
}

setInterval(() => {
    io.emit('market_update', generateMarketData());
}, 2000);

// Global Background Loop for Unblock Timers and Loans
setInterval(async () => {
    try {
        let users = await allDb('SELECT * FROM users WHERE active_loan > 0');
        for (let u of users) {
            if(Date.now() > u.loan_due_time) {
                // Liquidate
                let infra = await getDb('SELECT * FROM infrastructure WHERE telegram_id = ?', [u.telegram_id]);
                if(infra && infra.lawyers_count > 0) {
                    await runDb('UPDATE users SET active_loan = 0, balance_usdt = balance_usdt - ? WHERE telegram_id = ?', [u.active_loan * 1.05, u.telegram_id]);
                } else {
                    await runDb('UPDATE users SET active_loan = 0, balance_usdt = balance_usdt - ? WHERE telegram_id = ?', [u.active_loan * 1.25, u.telegram_id]);
                    await runDb('UPDATE infrastructure SET proxies_count = 0, drops_count = 0 WHERE telegram_id = ?', [u.telegram_id]);
                }
                io.to(u.telegram_id).emit('loan_liquidated');
            }
        }

        let blockedCards = await allDb("SELECT * FROM cards WHERE status = 'Blocked (115-FZ)' AND unblock_timer > 0");
        for(let c of blockedCards) {
            let newTimer = c.unblock_timer - 1000;
            if(newTimer <= 0) {
                await runDb('UPDATE cards SET status = ?, unblock_timer = 0 WHERE id = ?', ['Active', c.id]);
                await runDb('UPDATE users SET survive_115fz = survive_115fz + 1 WHERE telegram_id = ?', [c.telegram_id]); // Survived!
                await addExp(c.telegram_id, 20); // Reward for surviving
            } else {
                await runDb('UPDATE cards SET unblock_timer = ? WHERE id = ?', [newTimer, c.id]);
            }
        }

        // Send state updates to active clients
        const clients = io.sockets.adapter.rooms;
        for (let [socketId, room] of clients) {
            let socket = io.sockets.sockets.get(socketId);
            if(socket && socket.tg_id) {
                socket.emit('state_update', await getFullState(socket.tg_id));
            }
        }
    } catch (e) {
        console.error("Global background loop error", e);
    }
}, 1000);


// Helper for leveling up & checking Daily Pass Contracts
async function addExp(tg_id, amount) {
    const user = await getDb(`SELECT * FROM users WHERE telegram_id = ?`, [tg_id]);
    if(!user) return;

    let newExp = user.exp + amount;

    // Check Daily Pass Contracts (only claim once)
    if(user.ton_loops >= user.daily_ton_goal && !user.ton_bonus_claimed) {
        newExp += 50;
        await runDb(`UPDATE users SET ton_bonus_claimed = 1 WHERE telegram_id = ?`, [tg_id]);
    }
    if(user.survive_115fz >= user.daily_115fz_goal && !user.fz_bonus_claimed) {
        newExp += 50;
        await runDb(`UPDATE users SET fz_bonus_claimed = 1 WHERE telegram_id = ?`, [tg_id]);
    }
    if(user.profit_usdt >= user.daily_profit_goal && !user.profit_bonus_claimed) {
        newExp += 50;
        await runDb(`UPDATE users SET profit_bonus_claimed = 1 WHERE telegram_id = ?`, [tg_id]);
    }

    let newRank = user.rank;
    if(newExp >= 1000 && newRank === 'Drop') newRank = 'Merchant';
    if(newExp >= 5000 && newRank === 'Merchant') newRank = 'P2P Boss';

    await runDb(`UPDATE users SET exp = ?, rank = ? WHERE telegram_id = ?`, [newExp, newRank, tg_id]);
}

io.on('connection', (socket) => {
    socket.on('auth', async (data) => {
        let { tg_id, username } = data;
        socket.tg_id = tg_id; // Attach to socket for global loop
        socket.join(tg_id); // Join room corresponding to their ID

        let user = await getDb('SELECT * FROM users WHERE telegram_id = ?', [tg_id]);
        if(!user) {
            await runDb(`INSERT INTO users (telegram_id, username) VALUES (?, ?)`, [tg_id, username || 'CyberRunner']);
            await runDb(`INSERT INTO infrastructure (telegram_id) VALUES (?)`, [tg_id]);
            await runDb(`INSERT INTO cards (telegram_id, bank_name) VALUES (?, ?), (?, ?), (?, ?)`,
                [tg_id, 'Sber', tg_id, 'Tinkoff', tg_id, 'Raiffeisen']);
            user = await getDb('SELECT * FROM users WHERE telegram_id = ?', [tg_id]);
        }

        socket.emit('state_update', await getFullState(tg_id));
        socket.emit('cyber_news_sync', globalModifiers.activeNews);
    });

    socket.on('execute_arbitrage', async (data) => {
        let { tg_id, coin, spread } = data;
        let state = await getFullState(tg_id);
        if(globalModifiers.lockedCoin === coin) return socket.emit('error_msg', 'Coin withdrawals locked by Network Outage!');

        let activeCard = state.cards.find(c => c.status === 'Active' && c.limit_remaining > 0);
        if(!activeCard) return socket.emit('error_msg', 'No active cards with remaining limits!');

        let executionDelay = 3000 - (state.infra.proxies_count * 400);
        if(globalModifiers.proxyDisabled) executionDelay += 2000;
        if(executionDelay < 500) executionDelay = 500;

        setTimeout(async () => {
            // Check 115-FZ
            let blockRisk = 0.05 * globalModifiers.amlRiskMultiplier;
            if(state.infra.proxies_count > 0) {
                blockRisk = 0; // Proxies eliminate P2P scam event risks entirely
            }

            if(Math.random() < blockRisk) {
                let unblockTime = 60000;
                // Correctly apply reduction exponentially so it doesn't become negative
                unblockTime = unblockTime * Math.pow(0.7, state.infra.lawyers_count);
                await runDb(`UPDATE cards SET status = 'Blocked (115-FZ)', unblock_timer = ? WHERE id = ?`, [unblockTime, activeCard.id]);
                socket.emit('alert_msg', `Card Blocked 115-FZ! Funds locked.`);
                return socket.emit('state_update', await getFullState(tg_id));
            }

            let tradeAmount = Math.min(10000, activeCard.limit_remaining); // Max 10k per trade
            let profit = tradeAmount * (spread / 100);

            let newLimit = activeCard.limit_remaining - tradeAmount;
            let status = newLimit <= 0 ? 'Drained' : 'Active';

            await runDb('UPDATE cards SET limit_remaining = ?, status = ? WHERE id = ?', [newLimit, status, activeCard.id]);
            await runDb('UPDATE users SET balance_usdt = balance_usdt + ?, profit_usdt = profit_usdt + ?, total_trades = total_trades + 1 WHERE telegram_id = ?', [profit, profit, tg_id]);

            if(coin === 'TON') {
                await runDb('UPDATE users SET ton_loops = ton_loops + 1 WHERE telegram_id = ?', [tg_id]);
            }

            await addExp(tg_id, 10);

            socket.emit('arbitrage_success', { profit: profit.toFixed(2), coin });
            socket.emit('state_update', await getFullState(tg_id));
        }, executionDelay);
    });

    socket.on('buy_infra', async (data) => {
        let { tg_id, type } = data;
        let costs = { proxy: 500, drop: 1500, lawyer: 5000 };
        let cost = costs[type];
        let user = await getDb('SELECT balance_usdt FROM users WHERE telegram_id = ?', [tg_id]);
        if(user.balance_usdt >= cost) {
            await runDb(`UPDATE users SET balance_usdt = balance_usdt - ? WHERE telegram_id = ?`, [cost, tg_id]);
            let field = type === 'proxy' ? 'proxies_count' : type === 'drop' ? 'drops_count' : 'lawyers_count';
            await runDb(`UPDATE infrastructure SET ${field} = ${field} + 1 WHERE telegram_id = ?`, [tg_id]);

            // If drop bought, spawn new card
            if(type === 'drop') {
                let banks = ['Sber', 'Tinkoff', 'Raiffeisen'];
                let b = banks[Math.floor(Math.random()*banks.length)];
                await runDb('INSERT INTO cards (telegram_id, bank_name, limit_remaining) VALUES (?, ?, ?)', [tg_id, b, 300000 * globalModifiers.cardLimitMultiplier]);
            }
            socket.emit('state_update', await getFullState(tg_id));
        }
    });

    socket.on('take_loan', async (data) => {
        let { tg_id, amount } = data;
        let user = await getDb('SELECT active_loan FROM users WHERE telegram_id = ?', [tg_id]);
        if(user.active_loan > 0) return socket.emit('error_msg', 'Already have an active loan!');
        if(amount > 25000) return socket.emit('error_msg', 'Max loan is $25,000!');
        let dueTime = Date.now() + 180000; // 3 mins
        await runDb('UPDATE users SET balance_usdt = balance_usdt + ?, active_loan = ?, loan_due_time = ? WHERE telegram_id = ?', [amount, amount, dueTime, tg_id]);
        socket.emit('state_update', await getFullState(tg_id));
    });

    socket.on('repay_loan', async (data) => {
        let { tg_id } = data;
        let user = await getDb('SELECT balance_usdt, active_loan FROM users WHERE telegram_id = ?', [tg_id]);
        if(user.active_loan > 0 && user.balance_usdt >= user.active_loan) {
            await runDb('UPDATE users SET balance_usdt = balance_usdt - ?, active_loan = 0, loan_due_time = 0 WHERE telegram_id = ?', [user.active_loan, tg_id]);
            socket.emit('state_update', await getFullState(tg_id));
        }
    });

    socket.on('start_syndicate', async (data) => {
        let { tg_id, amount } = data;
        let user = await getDb('SELECT balance_usdt FROM users WHERE telegram_id = ?', [tg_id]);
        if(user.balance_usdt < amount) return socket.emit('error_msg', 'Insufficient funds for syndicate pool!');
        await runDb('UPDATE users SET balance_usdt = balance_usdt - ? WHERE telegram_id = ?', [amount, tg_id]);
        socket.emit('state_update', await getFullState(tg_id));

        let execTime = (15000 + Math.random() * 5000) * globalModifiers.syndicateTimeMultiplier;
        let baseSpread = 0.04 + Math.random() * 0.05;
        if(globalModifiers.syndicateSpreadModifier > 0) baseSpread = globalModifiers.syndicateSpreadModifier;

        setTimeout(async () => {
            let profit = amount * baseSpread;
            await runDb('UPDATE users SET balance_usdt = balance_usdt + ?, profit_usdt = profit_usdt + ? WHERE telegram_id = ?', [amount + profit, profit, tg_id]);
            await addExp(tg_id, 50);
            socket.emit('syndicate_complete', { profit: profit.toFixed(2) });
            socket.emit('state_update', await getFullState(tg_id));
        }, execTime);
    });
});

app.get('/api/leaderboard', async (req, res) => {
    let top = await allDb('SELECT username, profit_usdt FROM users ORDER BY profit_usdt DESC LIMIT 10');
    res.json(top);
});

async function getFullState(tg_id) {
    let user = await getDb('SELECT * FROM users WHERE telegram_id = ?', [tg_id]);
    let cards = await allDb('SELECT * FROM cards WHERE telegram_id = ?', [tg_id]);
    let infra = await getDb('SELECT * FROM infrastructure WHERE telegram_id = ?', [tg_id]);
    return { user, cards, infra };
}

// Telegram Bot Initialization
if (process.env.BOT_TOKEN) {
    const bot = new Telegraf(process.env.BOT_TOKEN);

    bot.start((ctx) => {
        ctx.reply(
            "🔥 Welcome to *Crypto Cyber Tracker & P2P Empire*! 🔥\n\n" +
            "Dive into the chaotic world of spot and P2P crypto-arbitrage.\n" +
            "Manage infrastructure, dodge 115-FZ blocks, and become the ultimate P2P Boss.\n\n" +
            "Click below to launch the Netrunner Terminal:",
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "💻 Launch Web App",
                                web_app: { url: "https://crypto-cyber-tracker-1.onrender.com" }
                            }
                        ]
                    ]
                }
            }
        );
    });

    bot.launch();
    console.log('Telegraf Bot launched.');

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
    console.warn("BOT_TOKEN is not defined in the environment. Telegram bot will not start.");
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Cyber Tracker Server listening on port ${PORT}`);
});
