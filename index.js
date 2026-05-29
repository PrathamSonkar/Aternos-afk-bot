const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { createClient } = require('redis');
const http = require('http');
const { renderPanel } = require('./panel');

const OWNER_NAME = 'NinjaWarrior'; 
const botOptions = { host: 'SurvivalSeries125.aternos.me', port: 24606, username: 'CommanderBot', version: '1.21.1' };

let bot = null, afkInterval = null, holdInterval = null, autoEatInterval = null; 
let db = null, panelLogs = [], spawnTime = null, reconnectTimeout = null, isConnecting = false, autoSleepMode = false; 

const EDIBLE_FOODS = ['cooked_beef', 'cooked_chicken', 'cooked_porkchop', 'cooked_mutton', 'cooked_cod', 'cooked_salmon', 'bread', 'baked_potato', 'golden_carrot', 'apple', 'carrot', 'melon_slice', 'sweet_berries'];

function logger(msg) {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMsg = `[${timestamp}] ${msg}`;
    console.log(formattedMsg); panelLogs.push(formattedMsg);
    if (panelLogs.length > 20) panelLogs.shift(); 
}

async function checkAndEat() {
    if (!bot?.inventory || bot.food >= 15 || bot.isSleeping) return;
    const foodItem = bot.inventory.items().find(item => EDIBLE_FOODS.includes(item.name));
    if (!foodItem) return; 
    try { await bot.equip(foodItem, 'hand'); await bot.consume(); } catch (err) { logger(`❌ Eat failed: ${err.message}`); }
}

async function executeSleepRoutine() {
    if (!bot || bot.isSleeping || !autoSleepMode) return;
    const bedBlock = bot.findBlock({ matching: (b) => b.name.includes('bed'), maxDistance: 32 });
    if (!bedBlock) return logger("⚠️ Auto-Sleep: No beds nearby.");
    try {
        await bot.pathfinder.goto(new goals.GoalLookAtBlock(bedBlock.position, bot.world));
        await bot.sleep(bedBlock); logger("💤 Bot is sleeping.");
    } catch (err) { logger(`❌ Sleep error: ${err.message}`); }
}

async function startDatabase() {
    const redisUrl = process.env.REDIS_URL || 'redis://default:NekSZswIGiFoekfVbXWQRkhuKKWFOorW@redis.railway.internal:6379';
    try {
        db = createClient({ url: redisUrl }); await db.connect(); logger('Connected to Redis successfully!');
    } catch (err) { logger(`DB Connection failed: ${err.message}`); db = null; }
}

function triggerReconnect() {
    if (reconnectTimeout || bot) return;
    logger('🔄 Waiting 15 seconds to safely retry...');
    reconnectTimeout = setTimeout(() => { reconnectTimeout = null; startBot(); }, 15000);
}

function startBot() {
    if (bot || isConnecting) return;
    logger('🚀 Connecting bot...'); isConnecting = true; 
    if (autoEatInterval) clearInterval(autoEatInterval);
    if (afkInterval) clearInterval(afkInterval);
    if (holdInterval) clearInterval(holdInterval);

    try { bot = mineflayer.createBot(botOptions); bot.loadPlugin(pathfinder); } 
    catch (err) { logger(`❌ Creation error: ${err.message}`); isConnecting = false; triggerReconnect(); return; }

    bot.once('spawn', () => {
        logger(`✅ Bot joined! Owner: ${OWNER_NAME}`); isConnecting = false; spawnTime = Date.now(); 
        if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
        bot.pathfinder.setMovements(new Movements(bot)); autoEatInterval = setInterval(checkAndEat, 5000);
        if (autoSleepMode) setTimeout(executeSleepRoutine, 3000);
    });

    bot.on('wake', () => { if (autoSleepMode) setTimeout(executeSleepRoutine, 5000); });
    bot.on('death', () => { if (holdInterval) { clearInterval(holdInterval); holdInterval = null; } setTimeout(() => { if (bot && !bot.isAlive) bot.respawn(); }, 1000); });
    bot.on('chat', (username, message) => { if (username === OWNER_NAME) handleBotCommands(message.toLowerCase()); });
    bot.on('kick', (r) => { logger(`❌ Kicked: ${r}`); stopBot(); triggerReconnect(); });
    bot.on('error', (e) => { logger(`❌ Error: ${e.message}`); stopBot(); triggerReconnect(); });
    bot.on('end', () => { logger('🔌 Disconnected.'); stopBot(); triggerReconnect(); });
}

function stopBot() {
    logger('扫 Clearing instances...'); spawnTime = null; isConnecting = false; 
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
    if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
    if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
    if (autoEatInterval) { clearInterval(autoEatInterval); autoEatInterval = null; }
    if (bot) { try { bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); } catch (e) {} bot.removeAllListeners(); bot = null; }
}

async function handleBotCommands(message) {
    const args = message.split(' '), command = args[0];
    if (!bot && !['stop', 'status'].includes(command)) return;

    switch (command) {
        case 'come':
            const p = bot.players[OWNER_NAME]?.entity;
            if (!p) return bot.chat("Can't see you.");
            bot.pathfinder.setGoal(new goals.GoalFollow(p, 1), true); break;
        case 'afk':
            if (afkInterval) return; autoSleepMode = false;
            afkInterval = setInterval(() => { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500); bot.look(bot.entity.yaw + 1.5, 0); }, 2000); break;
        case 'sleep':
            autoSleepMode = true; logger("🛌 Auto-Sleep Mode enabled."); executeSleepRoutine(); break;
        case 'stop':
            autoSleepMode = false; logger("🛑 Auto-Sleep Mode disabled.");
            if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
            if (holdInterval) { clearInterval(holdInterval); holdInterval = null; bot.deactivateItem(); }
            if (bot?.isSleeping) { try { await bot.wake(); bot.chat("Woke up!"); } catch(e){} }
            bot?.pathfinder.setGoal(null); bot?.clearControlStates(); break;
        case 'status':
            bot.chat(`HP: ${Math.round(bot.health)} | Food: ${bot.food} | AutoSleep: ${autoSleepMode}`); break;
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
                if (rawCmd) await handleBotCommands(rawCmd.toLowerCase());
            }
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderPanel({ bot, panelLogs, spawnTime }));
    } catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(`Server Error: ${e.message}`); }
});

startDatabase().then(() => {
    startBot();
    webServer.listen(process.env.PORT || 8080, '0.0.0.0', () => { logger(`Server running on port ${process.env.PORT || 8080}`); });
});
