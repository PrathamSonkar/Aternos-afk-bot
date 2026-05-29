const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { createClient } = require('redis');
const http = require('http');
const { renderPanel } = require('./panel');

const OWNER_NAME = 'NinjaWarrior'; 
const botOptions = {
    host: 'carp.aternos.host', 
    port: 24606,               
    username: 'CommanderBot',
    version: '1.21.1'
};

let bot = null, afkInterval = null, holdInterval = null, autoEatInterval = null; 
let db = null, panelLogs = [], spawnTime = null, reconnectTimeout = null, isConnecting = false; 

const EDIBLE_FOODS = ['cooked_beef', 'cooked_chicken', 'cooked_porkchop', 'cooked_mutton', 'cooked_cod', 'cooked_salmon', 'bread', 'baked_potato', 'golden_carrot', 'apple', 'carrot', 'melon_slice', 'sweet_berries'];

function logger(msg) {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMsg = `[${timestamp}] ${msg}`;
    console.log(formattedMsg);
    panelLogs.push(formattedMsg);
    if (panelLogs.length > 20) panelLogs.shift(); 
}

async function checkAndEat() {
    if (!bot || !bot.inventory || bot.food >= 15) return;
    const foodItem = bot.inventory.items().find(item => EDIBLE_FOODS.includes(item.name));
    if (!foodItem) return; 
    logger(`🍖 Eating ${foodItem.name}...`);
    try {
        await bot.equip(foodItem, 'hand');
        await bot.consume();
    } catch (err) { logger(`❌ Eat failed: ${err.message}`); }
}

async function startDatabase() {
    const redisUrl = process.env.REDIS_URL || 'redis://default:NekSZswIGiFoekfVbXWQRkhuKKWFOorW@redis.railway.internal:6379';
    try {
        db = createClient({ url: redisUrl });
        db.on('error', (err) => logger(`[DB Error] ${err.message}`));
        await db.connect();
        logger('Connected to Railway Redis successfully!');
    } catch (err) { logger(`DB Connection failed: ${err.message}`); db = null; }
}

function triggerReconnect() {
    if (reconnectTimeout) return; 
    logger('🔄 Waiting 15 seconds to safely retry...');
    reconnectTimeout = setTimeout(() => { reconnectTimeout = null; startBot(); }, 15000);
}

function startBot() {
    if (bot || isConnecting) return logger('⚠️ Bot connection routine already running.');
    logger('🚀 Connecting bot...');
    isConnecting = true; 

    if (autoEatInterval) clearInterval(autoEatInterval);
    if (afkInterval) clearInterval(afkInterval);
    if (holdInterval) clearInterval(holdInterval);

    try {
        bot = mineflayer.createBot(botOptions);
        bot.loadPlugin(pathfinder);
    } catch (err) {
        logger(`❌ Creation error: ${err.message}`);
        isConnecting = false; triggerReconnect(); return;
    }

    bot.once('spawn', () => {
        logger(`✅ Bot joined! Owner: ${OWNER_NAME}`);
        isConnecting = false; spawnTime = Date.now(); 
        bot.pathfinder.setMovements(new Movements(bot));
        autoEatInterval = setInterval(checkAndEat, 5000);
    });

    bot.on('death', () => {
        logger('⚠️ Bot died! Respawning...');
        if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
        setTimeout(() => { if (bot && !bot.isAlive) bot.respawn(); }, 1000);
    });

    bot.on('chat', (username, message) => {
        if (username === OWNER_NAME) handleBotCommands(message.toLowerCase());
    });

    bot.on('kick', (r) => { logger(`❌ Kicked: ${r}`); stopBot(); triggerReconnect(); });
    bot.on('error', (e) => { logger(`❌ Error: ${e.message}`); stopBot(); triggerReconnect(); });
    bot.on('end', () => { logger('🔌 Disconnected.'); stopBot(); triggerReconnect(); });
}

function stopBot() {
    logger('🧹 Clearing instances...');
    spawnTime = null; isConnecting = false; 
    if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
    if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
    if (autoEatInterval) { clearInterval(autoEatInterval); autoEatInterval = null; }
    if (bot) {
        try { bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); } catch (e) {}
        bot.removeAllListeners(); bot = null;
    }
}

async function handleBotCommands(message) {
    const args = message.split(' ');
    const command = args[0]; 
    if (!bot && !['stop', 'status'].includes(command)) return;

    switch (command) {
        case 'setpos':
            const pos = bot.entity.position;
            const posData = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
            if (db) { await db.set('saved_bot_position', JSON.stringify(posData)); } 
            else { global.tempPos = posData; }
            bot.chat(`Saved Pos: X:${posData.x} Y:${posData.y} Z:${posData.z}`);
            break;
        case 'gopos':
            let target = db ? JSON.parse(await db.get('saved_bot_position')) : global.tempPos;
            if (!target) return bot.chat("Type 'setpos' first.");
            bot.pathfinder.setGoal(new goals.GoalBlock(target.x, target.y, target.z), false);
            break;
        case 'come':
            const p = bot.players[OWNER_NAME]?.entity;
            if (!p) return bot.chat("Can't see you.");
            bot.pathfinder.setGoal(new goals.GoalFollow(p, 1), true);
            break;
        case 'mine':
            const bType = bot.registry.blocksByName[args[1]];
            if (!bType) return bot.chat("Unknown block.");
            const block = bot.findBlock({ matching: bType.id, maxDistance: 32 });
            if (!block) return bot.chat("None found.");
            try {
                await bot.pathfinder.goto(new goals.GoalLookAtBlock(block.position, bot.world));
                await bot.dig(block);
            } catch (err) { bot.chat(`Error: ${err.message}`); }
            break;
        case 'hold':
            if (holdInterval) { clearInterval(holdInterval); holdInterval = null; bot.deactivateItem(); }
            else { holdInterval = setInterval(() => { bot.activateItem(); }, 200); }
            break;
        case 'afk':
            if (afkInterval) return;
            afkInterval = setInterval(() => {
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 500);
                bot.look(bot.entity.yaw + 1.5, 0);
            }, 2000);
            break;
        case 'stop':
            if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
            if (holdInterval) { clearInterval(holdInterval); holdInterval = null; bot.deactivateItem(); }
            bot.pathfinder.setGoal(null); bot.clearControlStates();
            break;
        case 'status':
            bot.chat(`HP: ${Math.round(bot.health)} | Food: ${bot.food}`);
            break;
    }
}

const webServer = http.createServer(async (req, res) => {
    try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        if (urlObj.pathname === '/action') {
            const action = urlObj.searchParams.get('cmd');
            if (action === 'start') startBot();
            if (action === 'stop') stopBot();
            if (action === 'afk') await handleBotCommands('afk');
            if (action === 'clear_stop') await handleBotCommands('stop');
            if (action === 'console' && urlObj.searchParams.has('text')) {
                const rawCmd = urlObj.searchParams.get('text').trim();
                if (rawCmd && bot) bot.chat(rawCmd);
            }
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(renderPanel({ bot, panelLogs, spawnTime }));
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Server Error: ${e.message}`);
    }
});

startDatabase().then(() => {
    startBot();
    webServer.listen(process.env.PORT || 3000, '0.0.0.0', () => {
        logger(`Server running on port ${process.env.PORT || 3000}`);
    });
});
