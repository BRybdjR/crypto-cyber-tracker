const express = require('express');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Инициализация базы данных SQLite для симулятора кошелька
const dbPath = path.resolve(__dirname, 'arbitrage.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        telegram_id TEXT PRIMARY KEY,
        username TEXT,
        balance_usdt REAL DEFAULT 50000.0,
        total_trades INTEGER DEFAULT 0
    )`);
});

// Настройка Телеграм-бота
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    const webAppUrl = process.env.WEBAPP_URL || 'https://google.com';
    ctx.reply(
        `📈 Добро пожаловать в Cyber Arbitrage Terminal!\n\n` +
        `🤖 Я круглосуточно сканирую биржи: Binance, Bybit, OKX, KuCoin.\n` +
        `валюты под прицелом: BTC, ETH, TON, SOL, BNB, XRP, DOGE, ADA.\n\n` +
        `Жми кнопку ниже, чтобы открыть интерактивный терминал и крутить связки!`,
        Markup.inlineKeyboard([
            [Markup.button.webApp('🚀 Открыть Терминал', webAppUrl)]
        ])
    );
});

bot.launch().then(() => console.log('Telegram bot successfully started'));

// Глобальное хранилище цен
let cryptoPrices = {};
let arbitrageSpreads = [];

const COINS = ['BTC', 'ETH', 'TON', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA'];

// Функция безопасного запроса к биржам
async function fetchPrices() {
    const tempPrices = { Binance: {}, Bybit: {}, OKX: {}, KuCoin: {} };

    // 1. Сбор с Binance
    try {
        const res = await axios.get('https://api.binance.com/api/v3/ticker/price');
        res.data.forEach(t => {
            COINS.forEach(coin => {
                if (t.symbol === `${coin}USDT`) tempPrices.Binance[coin] = parseFloat(t.price);
            });
        });
    } catch (e) { console.log('Binance fetch error'); }

    // 2. Сбор с Bybit
    try {
        const res = await axios.get('https://api.bybit.com/v5/market/tickers?category=spot');
        res.data.result.list.forEach(t => {
            COINS.forEach(coin => {
                if (t.symbol === `${coin}USDT`) tempPrices.Bybit[coin] = parseFloat(t.lastPrice);
            });
        });
    } catch (e) { console.log('Bybit fetch error'); }

    // 3. Сбор с OKX
    try {
        const res = await axios.get('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
        res.data.data.forEach(t => {
            COINS.forEach(coin => {
                if (t.instId === `${coin}-USDT`) tempPrices.OKX[coin] = parseFloat(t.last);
            });
        });
    } catch (e) { console.log('OKX fetch error'); }

    // 4. Сбор с KuCoin
    try {
        const res = await axios.get('https://api.kucoin.com/api/v1/market/allTickers');
        res.data.data.ticker.forEach(t => {
            COINS.forEach(coin => {
                if (t.symbol === `${coin}-USDT`) tempPrices.KuCoin[coin] = parseFloat(t.last);
            });
        });
    } catch (e) { console.log('KuCoin fetch error'); }

    cryptoPrices = tempPrices;
    calculateSpreads();
}

// Расчет лучших межбиржевых связок
function calculateSpreads() {
    const exchanges = Object.keys(cryptoPrices);
    const newSpreads = [];

    COINS.forEach(coin => {
        let minExchange = null, minPrice = Infinity;
        let maxExchange = null, maxPrice = -Infinity;

        exchanges.forEach(exch => {
            const price = cryptoPrices[exch][coin];
            if (price) {
                if (price < minPrice) { minPrice = price; minExchange = exch; }
                if (price > maxPrice) { maxPrice = price; maxExchange = exch; }
            }
        });

        if (minExchange && maxExchange && minExchange !== maxExchange) {
            const spread = ((maxPrice - minPrice) / minPrice) * 100;
            // Показываем только прибыльные круги с учетом комиссий
            if (spread > 0.05) {
                newSpreads.push({
                    coin,
                    buyFrom: minExchange,
                    buyPrice: minPrice,
                    sellTo: maxExchange,
                    sellPrice: maxPrice,
                    spread: spread.toFixed(2)
                });
            }
        }
    });

    // Сортируем связки от самых прибыльных к меньшим
    arbitrageSpreads = newSpreads.sort((a, b) => b.spread - a.spread);
}

// Запускаем сбор данных каждые 8 секунд
setInterval(fetchPrices, 8000);
fetchPrices();

// API Эндпоинты для нашего будущего красивого Mini App интерфейса
app.get('/api/prices', (req, res) => res.json(cryptoPrices));
app.get('/api/spreads', (req, res) => res.json(arbitrageSpreads));

app.get('/', (req, res) => {
    res.send('<h1>🤖 Cyber Arbitrage Terminal Backend is Online!</h1>');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
