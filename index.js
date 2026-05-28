const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { createClient } = require('redis');
const http = require('http');

const OWNER_NAME = 'NinjaWarrior'; 
const botOptions = {
    host: 'SurvivalSeries125.aternos.me', 
    port: 24606, 
    username: 'CommanderBot',
    version: false     
};

let bot = null;
let afkInterval = null;
let holdInterval = null;
let autoEatInterval = null; 
let db = null;
let panelLogs = []; 
let spawnTime = null; 

const EDIBLE_FOODS = [
    'cooked_beef', 'cooked_chicken', 'cooked_porkchop', 'cooked_mutton', 'cooked_cod', 'cooked_salmon', 
    'bread', 'baked_potato', 'golden_carrot', 'apple', 'carrot', 'melon_slice', 'sweet_berries'
];

function logger(msg) {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMsg = `[${timestamp}] ${msg}`;
    console.log(formattedMsg);
    panelLogs.push(formattedMsg);
    if (panelLogs.length > 20) panelLogs.shift(); 
}

function getDuration() {
    if (!bot || !spawnTime) return '<span style="color:#ef4444;">0h 0m 0s (Bot Disconnected)</span>';
    const diff = Date.now() - spawnTime;
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `<span style="color:#a855f7; font-weight:bold;">${hrs}h ${mins}m ${secs}s</span>`;
}

async function checkAndEat() {
    if (!bot || !bot.inventory || bot.food >= 15) return;
    
    const foodItem = bot.inventory.items().find(item => EDIBLE_FOODS.includes(item.name));
    if (!foodItem) return; 

    logger(`🍖 Bot hunger low (${bot.food}/20). Eating ${foodItem.name}...`);
    try {
        await bot.equip(foodItem, 'hand');
        await bot.consume();
        logger(`✅ Successfully ate ${foodItem.name}.`);
    } catch (err) {
        logger(`❌ Failed to eat food: ${err.message}`);
    }
}

async function startDatabase() {
    const redisUrl = process.env.REDIS_URL || 'redis://default:NekSZswIGiFoekfVbXWQRkhuKKWFOorW@redis.railway.internal:6379';
    try {
        db = createClient({ url: redisUrl });
        db.on('error', (err) => logger(`[DB Error] ${err.message}`));
        await db.connect();
        logger('Connected to Railway Redis successfully!');
    } catch (err) {
        logger(`DB Connection failed: ${err.message}`);
        db = null;
    }
}

function startBot() {
    if (bot) return logger('Bot is already running.');
    logger('Starting Minecraft Bot...');
    bot = mineflayer.createBot(botOptions);
    bot.loadPlugin(pathfinder);

    bot.once('spawn', () => {
        logger(`Bot joined! Listening for: ${OWNER_NAME}`);
        spawnTime = Date.now(); 
        const defaultMovements = new Movements(bot);
        bot.pathfinder.setMovements(defaultMovements);

        if (autoEatInterval) clearInterval(autoEatInterval);
        autoEatInterval = setInterval(checkAndEat, 5000);
    });

    bot.on('death', () => {
        logger('⚠️ Bot died! Preparing to auto-respawn...');
        if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
        
        setTimeout(() => {
            try { 
                if (bot && bot.isAlive === false) {
                    bot.respawn(); 
                    logger('✅ Auto-respawn executed successfully.'); 
                }
            } catch (e) { 
                logger(`❌ Auto-respawn failed: ${e.message}`); 
            }
        }, 1000);
    });

    bot.on('chat', async (username, message) => {
        if (username !== OWNER_NAME) return;
        handleBotCommands(message.toLowerCase());
    });

    bot.on('kick', (r) => { logger(`Kicked: ${r}`); stopBot(); setTimeout(startBot, 15000); });
    bot.on('error', (e) => { logger(`Error: ${e.message}`); stopBot(); setTimeout(startBot, 15000); });
    bot.on('end', () => { logger('Disconnected.'); stopBot(); setTimeout(startBot, 15000); });
}

function stopBot() {
    logger('Stopping bot...');
    spawnTime = null; 
    if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
    if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
    if (autoEatInterval) { clearInterval(autoEatInterval); autoEatInterval = null; }
    if (bot) {
        try { bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); } catch (e) {}
        bot.removeAllListeners();
        bot = null;
    }
}

async function handleBotCommands(message) {
    const args = message.split(' ');
    const command = args[0]; // Fixed: Changed from args to args[0]
    if (!bot && ['stop', 'status'].includes(command) === false) return;

    switch (command) {
        case 'setpos':
            const currentPos = bot.entity.position;
            const posData = { x: Math.floor(currentPos.x), y: Math.floor(currentPos.y), z: Math.floor(currentPos.z) };
            if (db) {
                await db.set('saved_bot_position', JSON.stringify(posData));
                bot.chat(`Permanent save: X:${posData.x} Y:${posData.y} Z:${posData.z}`);
            } else {
                bot.chat("Temporary memory save complete.");
                global.tempPos = posData;
            }
            break;
        case 'gopos':
            let targetPos = null;
            if (db) {
                const stored = await db.get('saved_bot_position');
                if (stored) targetPos = JSON.parse(stored);
            } else { targetPos = global.tempPos; }
            if (!targetPos) return bot.chat("Type 'setpos' first.");
            bot.pathfinder.setGoal(new goals.GoalBlock(targetPos.x, targetPos.y, targetPos.z), false);
            break;
        case 'come':
            const p = bot.players[OWNER_NAME];
            if (!p || !p.entity) return bot.chat("Can't see you.");
            bot.pathfinder.setGoal(new goals.GoalFollow(p.entity, 1), true);
            break;
        case 'mine':
            const bName = args[1]; // Fixed: Changed from args to args[1]
            if (!bName) return bot.chat("Specify a block!");
            const bType = bot.registry.blocksByName[bName];
            if (!bType) return bot.chat("Unknown block.");
            const block = bot.findBlock({ matching: bType.id, maxDistance: 32 });
            if (!block) return bot.chat("None found nearby.");
            try {
                await bot.pathfinder.goto(new goals.GoalLookAtBlock(block.position, bot.world));
                await bot.dig(block);
            } catch (err) { bot.chat(`Error: ${err.message}`); }
            break;
        case 'bed':
            const bed = bot.findBlock({ matching: (b) => b.name.includes('bed'), maxDistance: 5 });
            if (!bed) return bot.chat("No bed found.");
            try { await bot.lookAt(bed.position); await bot.activateBlock(bed); } catch (e) {}
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
            if (holdInterval) { clearInterval(holdInterval); holdInterval = null; if (bot) bot.deactivateItem(); }
            if (bot) { bot.pathfinder.setGoal(null); bot.clearControlStates(); }
            break;
        case 'status':
            if (bot) bot.chat(`HP: ${Math.round(bot.health)} | Food: ${bot.food}`);
            break;
        case 'drop':
            for (const item of bot.inventory.items()) { try { await bot.dropItem(item); } catch (e) {} }
            break;
    }
}

const webServer = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    
    if (urlObj.pathname === '/action') {
        const action = urlObj.searchParams.get('cmd');
        if (action === 'start') startBot();
        if (action === 'stop') stopBot();
        if (action === 'afk') await handleBotCommands('afk');
        if (action === 'clear_stop') await handleBotCommands('stop');
        
        if (action === 'console' && urlObj.searchParams.has('text')) {
            const rawCmd = urlObj.searchParams.get('text').trim();
            if (rawCmd) {
                logger(`[Console Input] executing: ${rawCmd}`);
                await handleBotCommands(rawCmd.toLowerCase());
            }
        }
        res.writeHead(302, { 'Location': '/' });
        return res.end();
    }
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const statusText = bot ? '<span style="color:#2ecc71;">ONLINE</span>' : '<span style="color:#e74c3c;">OFFLINE</span>';
    const logItems = panelLogs.map(l => `<div style="padding:4px 0;border-bottom:1px solid #2d3748;">${l}</div>`).reverse().join('');
    
    let invHtml = '<span style="color:#718096; font-style: italic;">Inventory hidden or bot offline</span>';
    if (bot && bot.inventory) {
        const items = bot.inventory.items();
        if (items.length > 0) {
            invHtml = items.map(i => `
                <div style="background:#1a202c; padding:8px 12px; border-radius:6px; border:1px solid #4a5568; display:inline-block; margin:4px; font-family:monospace; font-size:13px; color:#edf2f7;">
                    📦 <span style="color:#38bdf8; font-weight:bold;">${i.name}</span> × ${i.count}
                </div>
            `).join('');
        } else {
            invHtml = '<span style="color:#a0aec0; font-style: italic;">Inventory is completely empty</span>';
        }
    }

    res.end(`
