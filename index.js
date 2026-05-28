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
let db = null;
let panelLogs = []; 

function logger(msg) {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMsg = `[${timestamp}] ${msg}`;
    console.log(formattedMsg);
    panelLogs.push(formattedMsg);
    if (panelLogs.length > 20) panelLogs.shift(); 
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
        const defaultMovements = new Movements(bot);
        bot.pathfinder.setMovements(defaultMovements);
    });

    bot.on('death', () => {
        logger('⚠️ Bot died! Respawning...');
        if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
        try { bot.respawn(); logger('✅ Respawn successful.'); } catch (e) { logger(`❌ Respawn error: ${e.message}`); }
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
    if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
    if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
    if (bot) {
        try { bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); } catch (e) {}
        bot.removeAllListeners();
        bot = null;
    }
}

async function handleBotCommands(message) {
    const args = message.split(' ');
    const command = args[0];
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
            const bName = args[1];
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

const webServer = http.createServer((req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
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
    const statusText = bot ? '<span style="color:#2ecc71;">ONLINE</span>' : '<span style="color:#e74c3c;">OFFLINE</span>';
    const logItems = panelLogs.map(l => `<div style="padding:4px 0;border-bottom:1px solid #2d3748;">${l}</div>`).reverse().join('');
    res.end(`
        <!DOCTYPE html><html><head><title>Console</title><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
            body{font-family:sans-serif;background:#1a202c;color:#e2e8f0;padding:20px;}
            .box{max-width:600px;margin:0 auto;background:#2d3748;padding:20px;border-radius:8px;}
            .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0;}
            .btn{padding:12px;color:#fff;text-align:center;text-decoration:none;border-radius:4px;font-weight:bold;}
            .console{background:#0f172a;height:200px;overflow-y:auto;padding:10px;font-family:monospace;color:#38bdf8;font-size:12px;border-radius:4px;}
        </style>
        <script>setTimeout(()=>{window.location.reload();},5000);</script></head><body><div class="box">
        <h3>🤖 Bot Panel (${statusText})</h3><div class="grid">
        <a href="/action?cmd=start" class="btn" style="background:#2ecc71;">Start</a>
        <a href="/action?cmd=stop" class="btn" style="background:#e74c3c;">Stop</a>
        <a href="/action?cmd=afk" class="btn" style="background:#f1c40f;color:#000;">AFK Loop</a>
        <a href="/action?cmd=clear_stop" class="btn" style="background:#9b59b6;">Clear</a>
        </div><div class="console">${logItems || 'No logs yet.'}</div></div></body></html>
    `);
});

async function bootSystem() {
    await startDatabase();
    webServer.listen(process.env.PORT || 3000, () => {
        logger(`Web panel active on port ${process.env.PORT || 3000}`);
    });
    startBot();
}
bootSystem();
