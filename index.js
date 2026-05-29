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

function checkAndCalculateMath(message) {
    if (!/^([0-9\s.+\-*/()]+)$/.test(message)) return null;
    try {
        const cleanExpression = message.replace(/[^0-9.+\-*/()]/g, '');
        const result = Function(`"use strict"; return (${cleanExpression})`)();
        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) return result;
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
    if (reconnectTimeout || bot) return;
    logger('🔄 Retrying connection in 15 seconds...');
    reconnectTimeout = setTimeout(() => { reconnectTimeout = null; startBot(); }, 15000);
}

function startBot() {
    if (bot || isConnecting) return;
    logger('🚀 Connecting bot...'); isConnecting = true; 
    if (autoEatInterval) clearInterval(autoEatInterval);
    if (afkInterval) clearInterval(afkInterval);

    try { bot = mineflayer.createBot(botOptions); bot.loadPlugin(pathfinder); } 
    catch (err) { logger(`❌ Error: ${err.message}`); isConnecting = false; triggerReconnect(); return; }

    bot.once('spawn', () => {
        logger(`✅ Bot joined!`); isConnecting = false; spawnTime = Date.now(); 
        if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
        bot.pathfinder.setMovements(new Movements(bot)); autoEatInterval = setInterval(checkAndEat, 5000);
        if (autoSleepMode) setTimeout(executeSleepRoutine, 3000);
    });

    bot.on('wake', () => { if (autoSleepMode) setTimeout(executeSleepRoutine, 5000); });
    bot.on('death', () => { if (bot && !bot.isAlive) bot.respawn(); });
    
    bot.on('chat', (username, message) => {
        const cleanMessage = message.trim();
        const mathResult = checkAndCalculateMath(cleanMessage);
        if (mathResult !== null) return bot.chat(`📊 Math Answer: ${cleanMessage} = ${mathResult}`);
        if (username === OWNER_NAME) handleBotCommands(cleanMessage.toLowerCase());
    });

    bot.on('kick', (r) => { logger(`❌ Kicked: ${r}`); stopBot(); triggerReconnect(); });
    bot.on('error', (e) => { logger(`❌ Error: ${e.message}`); stopBot(); triggerReconnect(); });
    bot.on('end', () => { logger('🔌 Disconnected.'); stopBot(); triggerReconnect(); });
}

function stopBot() {
    logger('🧹 Clearing instances...'); spawnTime = null; isConnecting = false; 
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
    if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
    if (autoEatInterval) { clearInterval(autoEatInterval); autoEatInterval = null; }
    if (bot) { try { bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); } catch (e) {} bot.removeAllListeners(); bot = null; }
}

async function handleBotCommands(message) {
    const args = message.split(' '), command = args[0]; // FIXED: Corrected token string variable tracking
    if (!bot && command !== 'stop') return;

    switch (command) {
        case 'come':
            const p = bot.players[OWNER_NAME]?.entity;
            if (!p) return bot.chat("Can't see you.");
            bot.pathfinder.setGoal(new goals.GoalFollow(p, 1), true); break;
        case 'afk':
            if (afkInterval) return; autoSleepMode = false;
            afkInterval = setInterval(() => { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500); bot.look(bot.entity.yaw + 1.5, 0); }, 2000); break;
        case 'sleep':
            autoSleepMode = true; logger("🛌 Auto-Sleep enabled."); executeSleepRoutine(); break;
        case 'stop':
            autoSleepMode = false; logger("🛑 Loop stopped.");
            if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
            if (bot?.isSleeping) { try { await bot.wake(); } catch(e){} }
            bot?.pathfinder.setGoal(null); bot?.clearControlStates(); break;
        case 'status':
            bot.chat(`HP: ${Math.round(bot.health)} | Food: ${bot.food} | Sleeping: ${bot.isSleeping}`); break;
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

startBot();
webServer.listen(process.env.PORT || 8080, '0.0.0.0', () => { logger(`Server active on port ${process.env.PORT || 8080}`); });
