const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const http = require('http');
const { renderPanel } = require('./panel');

const OWNER_NAME = 'NinjaWarrior'; 
const botOptions = { host: 'SurvivalSeries125.aternos.me', port: 24606, username: 'CommanderBot', version: '1.21.1' };

let bot = null, afkInterval = null, autoEatInterval = null, panelLogs = [], spawnTime = null, reconnectTimeout = null, isConnecting = false, autoSleepMode = false; 
const FOODS = ['cooked_beef', 'cooked_chicken', 'cooked_porkchop', 'cooked_mutton', 'cooked_cod', 'cooked_salmon', 'bread', 'baked_potato', 'golden_carrot', 'apple', 'carrot', 'melon_slice', 'sweet_berries'];

function logger(msg) {
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] ${msg}`;
    console.log(formatted); panelLogs.push(formatted);
    if (panelLogs.length > 20) panelLogs.shift(); 
}

function checkAndCalculateMath(msg) {
    if (!/^([0-9\s.+\-*/()]+)$/.test(msg)) return null;
    try {
        const clean = msg.replace(/[^0-9.+\-*/()]/g, '');
        const res = Function(`"use strict"; return (${clean})`)();
        if (typeof res === 'number' && !isNaN(res) && isFinite(res)) return res;
    } catch (e) {}
    return null;
}

async function checkAndEat() {
    if (!bot?.inventory || bot.food >= 15 || bot.isSleeping) return;
    const food = bot.inventory.items().find(i => FOODS.includes(i.name));
    if (!food) return; 
    try { await bot.equip(food, 'hand'); await bot.consume(); } catch (err) { logger(`❌ Eat failed: ${err.message}`); }
}

async function executeSleepRoutine() {
    if (!bot || bot.isSleeping || !autoSleepMode) return;
    const bed = bot.findBlock({ matching: b => b.name.includes('bed'), maxDistance: 32 });
    if (!bed) return logger("⚠️ No beds nearby.");
    try {
        await bot.pathfinder.goto(new goals.GoalLookAtBlock(bed.position, bot.world));
        await bot.sleep(bed); logger("💤 Bot is sleeping.");
    } catch (err) { logger(`❌ Sleep error: ${err.message}`); }
}

function triggerReconnect() {
    if (reconnectTimeout) return;
    logger('🔄 Scheduling hard reconnect sequence in 15 seconds...');
    reconnectTimeout = setTimeout(() => { 
        reconnectTimeout = null; 
        startBot(); 
    }, 15000);
}

function startBot() {
    if (bot || isConnecting) return logger('⚠️ Bot block: Startup already in progress.');
    logger('🚀 Connecting bot directly to server...'); 
    isConnecting = true; 
    
    if (autoEatInterval) clearInterval(autoEatInterval);
    if (afkInterval) clearInterval(afkInterval);

    try { 
        bot = mineflayer.createBot(botOptions); 
        bot.loadPlugin(pathfinder); 
    } catch (err) { 
        logger(`❌ Critical setup error: ${err.message}`); 
        isConnecting = false; 
        triggerReconnect(); 
        return; 
    }

    bot.once('spawn', () => {
        logger(`✅ Bot fully spawned inside server!`); 
        isConnecting = false; 
        spawnTime = Date.now(); 
        if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
        bot.pathfinder.setMovements(new Movements(bot)); 
        autoEatInterval = setInterval(checkAndEat, 5000);
        if (autoSleepMode) setTimeout(executeSleepRoutine, 3000);
    });

    bot.on('wake', () => { if (autoSleepMode) setTimeout(executeSleepRoutine, 5000); });
    bot.on('death', () => { if (bot && !bot.isAlive) bot.respawn(); });
    
    bot.on('chat', (user, msg) => {
        const clean = msg.trim();
        const calc = checkAndCalculateMath(clean);
        if (calc !== null) return bot.chat(`📊 Math Answer: ${clean} = ${calc}`);
        if (user === OWNER_NAME) handleBotCommands(clean.toLowerCase());
    });

    bot.on('kick', (r) => { logger(`❌ Kicked from world: ${r}`); stopBot(); triggerReconnect(); });
    bot.on('error', (e) => { logger(`❌ Stream connection error: ${e.message}`); stopBot(); triggerReconnect(); });
    bot.on('end', () => { logger('🔌 Server disconnected the pipeline.'); stopBot(); triggerReconnect(); });
}

function stopBot() {
    logger('🧹 Executing absolute connection instance cleanup...'); 
    spawnTime = null; 
    isConnecting = false; 
    if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
    if (autoEatInterval) { clearInterval(autoEatInterval); autoEatInterval = null; }
    if (bot) { 
        try { bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); } catch (e) {} 
        bot.removeAllListeners(); 
        bot = null; 
    }
}

async function handleBotCommands(msg) {
    const args = msg.split(' '), cmd = args[0];
    if (!bot && cmd !== 'stop') return;
    if (cmd === 'come') {
        const p = bot.players[OWNER_NAME]?.entity;
        if (p) bot.pathfinder.setGoal(new goals.GoalFollow(p, 1), true);
    } else if (cmd === 'afk') {
        if (afkInterval) return; autoSleepMode = false;
        afkInterval = setInterval(() => { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500); bot.look(bot.entity.yaw + 1.5, 0); }, 2000);
    } else if (cmd === 'sleep') { autoSleepMode = true; logger("A-Sleep enabled."); executeSleepRoutine(); 
    } else if (cmd === 'stop') {
        autoSleepMode = false; if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
        if (bot?.isSleeping) { try { await bot.wake(); } catch(e){} }
        bot?.pathfinder.setGoal(null); bot?.clearControlStates();
    } else if (cmd === 'status') { bot.chat(`HP: ${Math.round(bot.health)} | Food: ${bot.food} | SleepMode: ${autoSleepMode}`); }
}

const webServer = http.createServer(async (req, res) => {
    try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        if (urlObj.pathname === '/action') {
            const act = urlObj.searchParams.get('cmd');
            if (act === 'start') startBot();
            if (act === 'stop') stopBot();
            if (act === 'afk') await handleBotCommands('afk');
            if (act === 'clear_stop') await handleBotCommands('stop');
            if (action === 'console' && urlObj.searchParams.has('text')) {
                const raw = urlObj.searchParams.get('text').trim();
                if (raw) await handleBotCommands(raw.toLowerCase());
            }
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderPanel({ bot, panelLogs, spawnTime }));
    } catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(`Server Error: ${e.message}`); }
});

startBot();
webServer.listen(process.env.PORT || 8080, '0.0.0.0', () => { logger(`Server running on port ${process.env.PORT || 8080}`); });
