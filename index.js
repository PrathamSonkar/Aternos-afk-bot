const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { createClient } = require('redis');
const http = require('http');

// CONFIGURATION: Set to your exact username
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
let db = null;
let panelLogs = []; // Stores the latest 20 log lines for your web page interface

// Unified system logger for both Railway terminal and your web panel
function logger(msg) {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMsg = `[${timestamp}] ${msg}`;
    console.log(formattedMsg);
    panelLogs.push(formattedMsg);
    if (panelLogs.length > 20) panelLogs.shift(); // Bound log memory limit
}

// ==========================================
// 1. CONNECT TO RAILWAY DATABASE (REDIS)
// ==========================================
async function startDatabase() {
    const redisUrl = process.env.REDIS_URL || 'redis://default:NekSZswIGiFoekfVbXWQRkhuKKWFOorW@redis.railway.internal:6379';
    try {
        db = createClient({ url: redisUrl });
        db.on('error', (err) => logger(`[Database Error] ${err.message}`));
        await db.connect();
        logger('Connected to Railway Redis successfully!');
    } catch (err) {
        logger(`Database connection failed, using fallback memory: ${err.message}`);
        db = null;
    }
}

// ==========================================
// 2. MINECRAFT BOT LIFE CYCLE & LOGIC
// ==========================================
function startBot() {
    if (bot) {
        logger('Bot is already running or trying to connect.');
        return;
    }
    
    logger('Starting Minecraft Bot instance...');
    bot = mineflayer.createBot(botOptions);
    bot.loadPlugin(pathfinder);

    bot.once('spawn', () => {
        logger(`CommanderBot successfully spawned in game! Listening for: ${OWNER_NAME}`);
        const defaultMovements = new Movements(bot);
        bot.pathfinder.setMovements(defaultMovements);
    });

    // AUTO-RESPAWN ENGINE (Triggers instantly upon death)
    bot.on('death', () => {
        logger('⚠️ CommanderBot died! Triggering auto-respawn system...');
        
        // Safely clear out active holding configurations to avoid post-death glitch loops
        if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
        
        try {
            bot.respawn();
            logger('✅ Respawn package sent. Bot successfully respawned at its spawn anchor.');
        } catch (err) {
            logger(`❌ Failed to auto-respawn: ${err.message}`);
        }
    });

    // CHAT COMMAND ENGINE
    bot.on('chat', async (username, message) => {
        if (username !== OWNER_NAME) return;
        handleBotCommands(message.toLowerCase());
    });

    // Auto-Reconnect Connection Fail Safe Listeners
    bot.on('kick', (reason) => {
        logger(`Kicked from server: ${reason}`);
        stopBot();
        setTimeout(startBot, 15000); // Reconnect loop check
    });
    bot.on('error', (err) => {
        logger(`Connection error: ${err.message}`);
        stopBot();
        setTimeout(startBot, 15000);
    });
    bot.on('end', () => {
        logger('Connection lost with Minecraft server.');
        stopBot();
        setTimeout(startBot, 15000);
    });
}

function stopBot() {
    logger('Stopping Minecraft Bot instance...');
    if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
    if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
    
    if (bot) {
        try {
            bot.pathfinder.setGoal(null);
            bot.clearControlStates();
            bot.quit();
        } catch (e) {}
        bot.removeAllListeners();
        bot = null;
    }
    logger('Bot is now fully offline.');
}

// Core Action Engine Router
async function handleBotCommands(message) {
    const args = message.split(' ');
    const command = args[0];

    if (!bot && ['stop', 'status'].includes(command) === false) {
        logger('Command rejected: Bot is offline. Start it via the panel first.');
        return;
    }

    switch (command) {
        case 'setpos':
            const currentPos = bot.entity.position;
            const posData = { x: Math.floor(currentPos.x), y: Math.floor(currentPos.y), z: Math.floor(currentPos.z) };
            if (db) {
                await db.set('saved_bot_position', JSON.stringify(posData));
                bot.chat(`Saved PERMANENTLY to database at X: ${posData.x}, Y: ${posData.y}, Z: ${posData.z}`);
            } else {
                bot.chat("Saved temporarily in short-term instance memory.");
                global.tempPos = posData;
            }
            logger(`Saved location coordinates: ${JSON.stringify(posData)}`);
            break;

        case 'gopos':
            let targetPos = null;
            if (db) {
                const stored = await db.get('saved_bot_position');
                if (stored) targetPos = JSON.parse(stored);
            } else {
                targetPos = global.tempPos;
            }
            if (!targetPos) {
                bot.chat("No position found! Type 'setpos' first.");
                return;
            }
            bot.chat(`Walking to saved coordinates...`);
            bot.pathfinder.setGoal(new goals.GoalBlock(targetPos.x, targetPos.y, targetPos.z), false);
            break;

        case 'come':
            const player = bot.players[OWNER_NAME];
            if (!player || !player.entity) {
                bot.chat("I can't see you! Get closer.");
                return;
            }
            bot.chat("On my way!");
            bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 1), true);
            break;

        case 'mine':
            const blockName = args[1];
            if (!blockName) { bot.chat("Specify a block name!"); return; }
            const blockType = bot.registry.blocksByName[blockName];
            if (!blockType) { bot.chat(`Unknown block: ${blockName}`); return; }
            const block = bot.findBlock({ matching: blockType.id, maxDistance: 32 });
            if (!block) { bot.chat(`No ${blockName} found nearby.`); return; }
            try {
                await bot.pathfinder.goto(new goals.GoalLookAtBlock(block.position, bot.world));
                await bot.dig(block);
                bot.chat("Block broken!");
            } catch (err) { bot.chat(`Mining error: ${err.message}`); }
            break;

        case 'bed':
            const bedBlock = bot.findBlock({ matching: (b) => b.name.includes('bed'), maxDistance: 5 });
            if (!bedBlock) { bot.chat("No bed found within 5 blocks."); return; }
            try {
                await bot.lookAt(bedBlock.position.offset(0.5, 0.5, 0.5));
                await bot.activateBlock(bedBlock);
                bot.chat("Right-clicked the bed!");
            } catch (err) { bot.chat(`Error: ${err.message}`); }
            break;

        case 'hold':
            if (holdInterval) {
                clearInterval(holdInterval); holdInterval = null; bot.deactivateItem();
                bot.chat("Hold toggle OFF.");
            } else {
                bot.chat("Hold toggle ON.");
                holdInterval = setInterval(() => { bot.activateItem(); }, 200);
            }
            break;

        case 'afk':
            if (afkInterval) { bot.chat("Already in AFK mode."); return; }
            bot.chat("Starting AFK routine.");
            afkInterval = setInterval(() => {
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 500);
                bot.look(bot.entity.yaw + 1.5, 0);
            }, 2000);
            break;

        case 'stop':
            if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
            if (holdInterval) { clearInterval(holdInterval); holdInterval = null; if (bot) bot.deactivateItem(); }
            if (bot) {
                bot.pathfinder.setGoal(null);
                bot.clearControlStates();
                bot.chat("Stopped current tasks.");
            }
            logger("All active automated routines cleared.");
            break;

        case 'status':
            if (bot) {
                bot.chat(`Health: ${Math.round(bot.health)}/20 | Food: ${bot.food}/20`);
            } else {
                logger("Status check: Bot is currently completely OFFLINE.");
            }
            break;

        case 'drop':
            bot.chat("Dumping inventory items...");
            for (const item of bot.inventory.items()) {
                try { await bot.dropItem(item); } catch (err) {}
            }
            break;
    }
}

// ==========================================
// 3. INTERACTIVE CONSOLE WEB PANEL
// ==========================================
const webServer = http.createServer((req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    
    // Core Panel Form Button routing handles
    if (urlObj.pathname === '/action') {
        const action = urlObj.searchParams.get('cmd');
        if (action === 'start') startBot();
        if (action === 'stop') stopBot();
        if (action === 'afk') handleBotCommands('afk');
        if (action === 'clear_stop') handleBotCommands('stop');
        
        res.writeHead(302, { 'Location': '/' });
        return res.end();
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    
    const botStatusHtml = bot ? '<span style="color:#2ecc71; font-weight:bold;">● ONLINE</span>' : '<span style="color:#e74c3c; font-weight:bold;">● OFFLINE</span>';
    const logItemsHtml = panelLogs.map(l => `<div style="padding:4px 0; border-bottom:1px solid #2d3748;">${l}</div>`).reverse().join('');

    res.end(`
